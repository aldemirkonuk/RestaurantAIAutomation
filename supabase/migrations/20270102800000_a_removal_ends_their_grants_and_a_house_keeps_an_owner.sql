-- Two guards on leaving a house, both in the database so no door skips them.
-- Owner-quarter sim, wave 17, team-and-roles-lifecycle findings 2 and 7.
--
-- 1. F-577: a removal ends the grants the removed person HELD.
--
--    WHAT WAS WRONG: no removal path touched `authority_grants` for the
--    grantee (`MembersService.removeMember`, `TeamService.removeFromHouse`,
--    `AuthService.leaveRestaurant` and `deleteAccount`, which all end in
--    those two). The only latch was on the VOUCHER leaving (20261116100600).
--    The register kept listing a removed person's grant as live, and when
--    the same account was invited back months later the vendor-send gate
--    (`VendorSendAuthorityService.standing` -> `grantsHeldBy`, which reads by
--    grantee and house only) counted the old grant again: they could send to
--    vendors, up to the old limit, without any owner deciding it again.
--
--    THE FIX: when a person stops being a member of a house -- their access
--    row there is deleted or deactivated, or their `users` row stops naming
--    the house -- and they are no longer a member there by the other one,
--    every grant they hold in that house that is not already revoked or
--    deleted is REVOKED, and each revocation is written to the house's
--    security ledger (`grant_revoked`, actor none, detail reason
--    `grantee_left`). Revoked, not latched: a revoked grant cannot be brought
--    back (`authority_grant_reapprove` refuses one), so a re-invite starts
--    with no grant and an owner issues a new one if they want it. Membership
--    is read the way the gateway reads it (`assertMembership`): an active
--    access row here, or a `users` row naming this house. The removal clears
--    the `users` row first and deletes the access row second; the first
--    write finds them still a member by the access row and does nothing, the
--    second one ends the grants.
--
--    Skipped when the house or the account itself is being deleted: their
--    grants go with it by the existing ON DELETE CASCADE, and an UPDATE of a
--    row the same statement is deleting would fail the delete.
--
-- 2. F-582: a house keeps at least one owner, under concurrent changes too.
--
--    WHAT WAS WRONG: the last-owner count ran in the gateway, and in
--    `updateMemberRole` only for a change to oneself. Two co-owners demoting
--    each other at the same moment both passed the owner check before either
--    write, and the house was left with no owner. No constraint or trigger
--    stood behind the gateway.
--
--    THE FIX: after an access row stops being an active owner's (demoted,
--    deactivated, deleted, or moved to another house), the house's owners are
--    counted under a per-house transaction lock, and the change is refused
--    when none would be left. The lock is what closes the race: the second of
--    two concurrent demotions waits for the first to commit, then counts with
--    a fresh snapshot and sees it. Owners are counted the way
--    `authority_tell_owners` counts them: active access rows at owner, and a
--    `users` row at owner naming the house for a person with no active access
--    row there. Skipped when the house or the account is being deleted: the
--    gateway already refuses the last owner's account deletion, and a house
--    deletion takes every row with it. The refusal is SQLSTATE 23514 with
--    the marker `house_keeps_an_owner`, which the gateway answers in plain
--    words.
--
--    NOT COVERED: a demotion written ONLY to `users.role` (a member known
--    only by their legacy `users` row) is not guarded here; the gateway's
--    own count still runs for that shape.
--
-- Additive and idempotent: functions CREATE OR REPLACE, triggers dropped IF
-- EXISTS and created. No row written, no row deleted.
SET local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- Shared reads.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.house_member_is_here(p_user UUID, p_house UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.user_restaurant_access
            WHERE user_id = p_user AND restaurant_id = p_house AND is_active)
      OR EXISTS (
           SELECT 1 FROM public.users
            WHERE user_id = p_user AND restaurant_id = p_house);
$$;

COMMENT ON FUNCTION public.house_member_is_here(UUID, UUID) IS
  'Whether a person is a member of a house, read the way the gateway''s assertMembership reads it: an active access row there, or a users row naming the house.';

CREATE OR REPLACE FUNCTION public.house_owner_count(p_house UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT count(DISTINCT who)::INTEGER FROM (
    SELECT ura.user_id AS who
      FROM public.user_restaurant_access ura
     WHERE ura.restaurant_id = p_house AND ura.is_active
       AND lower(btrim(coalesce(ura.role, ''))) = 'owner'
    UNION
    SELECT u.user_id
      FROM public.users u
     WHERE u.restaurant_id = p_house
       AND lower(btrim(coalesce(u.role, ''))) = 'owner'
       AND NOT EXISTS (
         SELECT 1 FROM public.user_restaurant_access a
          WHERE a.user_id = u.user_id AND a.restaurant_id = p_house AND a.is_active
            AND nullif(btrim(a.role), '') IS NOT NULL
       )
  ) owners;
$$;

COMMENT ON FUNCTION public.house_owner_count(UUID) IS
  'How many owners a house has: active access rows at owner, plus a users row at owner naming the house for a person with no active access row there (the authority_tell_owners audience).';

-- ---------------------------------------------------------------------------
-- 1. A person who leaves a house leaves the grants they held there.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authority_grants_end_for_leaver(
  p_grantee UUID,
  p_house UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  g RECORD;
  n INTEGER := 0;
BEGIN
  IF p_grantee IS NULL OR p_house IS NULL THEN
    RETURN 0;
  END IF;
  -- The house or the account is going: the grants go with it by cascade.
  IF NOT EXISTS (SELECT 1 FROM public.restaurants WHERE id = p_house)
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE user_id = p_grantee) THEN
    RETURN 0;
  END IF;
  IF public.house_member_is_here(p_grantee, p_house) THEN
    RETURN 0;
  END IF;
  FOR g IN
    UPDATE public.authority_grants
       SET revoked_at = now()
     WHERE restaurant_id = p_house
       AND grantee_user_id = p_grantee
       AND revoked_at IS NULL
       AND deleted_at IS NULL
    RETURNING id
  LOOP
    PERFORM public.append_security_event(
      p_house, 'grant_revoked', NULL, 'authority_grant', g.id,
      jsonb_build_object('reason', 'grantee_left')
    );
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

COMMENT ON FUNCTION public.authority_grants_end_for_leaver(UUID, UUID) IS
  'Revokes every grant a person holds in a house once they are no longer a member there, each one written to the security ledger (F-577). A re-invite starts with no grant.';

CREATE OR REPLACE FUNCTION public.authority_grants_on_grantee_access_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.authority_grants_end_for_leaver(OLD.user_id, OLD.restaurant_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_authority_grants_end_on_access_end ON public.user_restaurant_access;
CREATE TRIGGER trg_authority_grants_end_on_access_end
  AFTER UPDATE OF is_active, restaurant_id, user_id OR DELETE ON public.user_restaurant_access
  FOR EACH ROW EXECUTE FUNCTION public.authority_grants_on_grantee_access_change();

CREATE OR REPLACE FUNCTION public.authority_grants_on_grantee_house_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.restaurant_id IS NOT NULL
     AND OLD.restaurant_id IS DISTINCT FROM NEW.restaurant_id THEN
    PERFORM public.authority_grants_end_for_leaver(OLD.user_id, OLD.restaurant_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_authority_grants_end_on_house_cleared ON public.users;
CREATE TRIGGER trg_authority_grants_end_on_house_cleared
  AFTER UPDATE OF restaurant_id ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.authority_grants_on_grantee_house_change();

-- ---------------------------------------------------------------------------
-- 2. A house keeps an owner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_restaurant_access_keeps_an_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (OLD.is_active AND lower(btrim(coalesce(OLD.role, ''))) = 'owner') THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.is_active
     AND lower(btrim(coalesce(NEW.role, ''))) = 'owner'
     AND NEW.restaurant_id = OLD.restaurant_id
     AND NEW.user_id = OLD.user_id THEN
    RETURN NULL;
  END IF;
  -- The house or the account is going (see the header).
  IF NOT EXISTS (SELECT 1 FROM public.restaurants WHERE id = OLD.restaurant_id)
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE user_id = OLD.user_id) THEN
    RETURN NULL;
  END IF;
  -- One owner change per house at a time; the count below then sees every
  -- change committed before this one (READ COMMITTED: a fresh snapshot per
  -- statement).
  PERFORM pg_advisory_xact_lock(hashtextextended('house_owners:' || OLD.restaurant_id::text, 0));
  IF public.house_owner_count(OLD.restaurant_id) = 0 THEN
    RAISE EXCEPTION 'house_keeps_an_owner: this change would leave the house with no owner'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.user_restaurant_access_keeps_an_owner() IS
  'Refuses (23514, house_keeps_an_owner) a change to an active owner''s access row that would leave the house with no owner, under a per-house lock so two concurrent demotions cannot both pass (F-582).';

DROP TRIGGER IF EXISTS trg_user_restaurant_access_keeps_an_owner ON public.user_restaurant_access;
CREATE TRIGGER trg_user_restaurant_access_keeps_an_owner
  AFTER UPDATE OF role, is_active, restaurant_id, user_id OR DELETE ON public.user_restaurant_access
  FOR EACH ROW EXECUTE FUNCTION public.user_restaurant_access_keeps_an_owner();

-- ---------------------------------------------------------------------------
-- Assertions. A partial apply must fail here, not pass quietly.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'trg_authority_grants_end_on_access_end',
    'trg_user_restaurant_access_keeps_an_owner'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
       WHERE tgname = t AND tgrelid = 'public.user_restaurant_access'::regclass
         AND NOT tgisinternal
    ) THEN
      RAISE EXCEPTION 'trigger % is missing on user_restaurant_access', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_authority_grants_end_on_house_cleared'
       AND tgrelid = 'public.users'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trigger trg_authority_grants_end_on_house_cleared is missing on users';
  END IF;
END
$$;
