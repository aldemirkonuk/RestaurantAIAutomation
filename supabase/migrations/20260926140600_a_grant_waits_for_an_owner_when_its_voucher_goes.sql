-- A grant waits for an owner when the owner who vouched for it goes — the
-- founder's answers of 2026-09-21 on the ADR 0175 amendment's grant forks.
--
-- WHAT HE DECIDED
-- ---------------
-- (1) A send grant whose issuing owner is demoted or removed STOPS AT ONCE,
--     but the row STAYS, as "awaiting an owner's re-approval". Only a CURRENT
--     owner's approval re-activates it (under the seal), or an owner deletes
--     it. Nothing re-activates by itself — his words: *"no owner grant, no
--     activation, or no going back once grant author gone"*.
-- (2) Managers see the register by default; an owner may mark a grant
--     owner-only (hidden from managers); staff see only grants naming them.
-- (4) Issue, revoke and re-approve are sealed on the server, and every grant
--     event is written to the one security ledger (20260926140500), with the
--     owners told.
--
-- WHY "NOTHING RE-ACTIVATES BY ITSELF" IS A DATABASE FACT HERE
-- -----------------------------------------------------------
-- The gate already refused a grant whose grantor was no longer an owner, by
-- reading the grantor's role at send time. That reading has a hole: an owner
-- demoted on Monday and promoted again on Wednesday makes Monday's grant count
-- again on Wednesday, with nobody having approved it. So the grant now carries
-- WHO IT RESTS ON (`vouched_by_user_id`, the grantor at issue, the re-approving
-- owner after a re-approval) and a latch (`suspended_at`). The latch is set by
-- triggers on the two tables a role is read from — `user_restaurant_access`
-- and the legacy `users` row, exactly the two `readRestaurantRole`
-- (organizations.service.ts) reads, in the same order — the moment the voucher
-- stops being an owner of that house, by whichever door that happens (a role
-- change, a removal, leaving, a deleted account). Once latched, only
-- `authority_grant_reapprove` clears it, and that function refuses an actor who
-- is not an owner now. The gate reads the latch AND the voucher's role, so a
-- write that ever got past both triggers still cannot send.
--
-- EVERY GRANT WRITE GOES THROUGH A FUNCTION THAT ALSO WRITES THE LEDGER
-- --------------------------------------------------------------------
-- `authority_grant_issue`, `_revoke`, `_reapprove`, `_delete` and
-- `_set_owner_only` change the grant row AND append the security event in one
-- transaction: there is no state in which a grant changed and the ledger does
-- not say so. `scripts/check_grant_writes_are_ledgered.py` fails the build if
-- the gateway ever writes `authority_grants` any other way. The suspension
-- trigger appends its own event and puts a notice on every owner's bell (and
-- the grantee's) directly, because a trigger cannot reach the gateway's
-- notifier and the founder asked for the owners to be told of every grant
-- event.
--
-- SECURITY INVOKER THROUGHOUT
-- ---------------------------
-- The gateway calls these as service_role. The triggers run as whoever wrote
-- the role row — service_role through the gateway, the migration owner in a
-- migration — and a client role that could write a role row but not the grants
-- table would have its write refused, which fails closed. Nothing here is a
-- definer; EXECUTE is still revoked from PUBLIC, anon and authenticated.
--
-- Additive and idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE,
-- DROP ... IF EXISTS; the seal-kind CHECK is extended by reading the existing
-- definition, never from a literal; assertions at the bottom.

-- ---------------------------------------------------------------------------
-- 1. The grant row learns who it rests on, its latch, its visibility and its
--    deletion.
-- ---------------------------------------------------------------------------
ALTER TABLE public.authority_grants
  ADD COLUMN IF NOT EXISTS vouched_by_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vouched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT,
  ADD COLUMN IF NOT EXISTS owner_only BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL;

-- A grant issued before this file rests on its grantor, from its issue.
UPDATE public.authority_grants
   SET vouched_by_user_id = grantor_user_id,
       vouched_at = created_at
 WHERE vouched_at IS NULL;

ALTER TABLE public.authority_grants DROP CONSTRAINT IF EXISTS authority_grants_vouched_whole;
ALTER TABLE public.authority_grants
  ADD CONSTRAINT authority_grants_vouched_whole CHECK (vouched_at IS NOT NULL);

ALTER TABLE public.authority_grants DROP CONSTRAINT IF EXISTS authority_grants_suspension_says_why;
ALTER TABLE public.authority_grants
  ADD CONSTRAINT authority_grants_suspension_says_why CHECK (
    (suspended_at IS NULL) = (suspended_reason IS NULL)
  );

ALTER TABLE public.authority_grants DROP CONSTRAINT IF EXISTS authority_grants_deleter_needs_deletion;
ALTER TABLE public.authority_grants
  ADD CONSTRAINT authority_grants_deleter_needs_deletion CHECK (
    deleted_by_user_id IS NULL OR deleted_at IS NOT NULL
  );

COMMENT ON COLUMN public.authority_grants.vouched_by_user_id IS
  'The owner this grant rests on NOW: the grantor at issue, the re-approving owner after a re-approval. The gate counts the grant only while this person is an owner of the house.';
COMMENT ON COLUMN public.authority_grants.suspended_at IS
  'Set by trigger the moment the voucher stops being an owner of the house. Cleared only by authority_grant_reapprove, by a current owner, under the seal (founder, 2026-09-21: "no going back once grant author gone").';
COMMENT ON COLUMN public.authority_grants.owner_only IS
  'An owner marked this grant owner-only: managers do not see it in the register. Staff only ever see grants that name them (founder, 2026-09-21).';

-- ---------------------------------------------------------------------------
-- 2. Is this person an owner of this house NOW — the rule readRestaurantRole
--    applies: an active access row's role first, the legacy users row only
--    when there is none (or it names no role).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authority_is_house_owner(p_user UUID, p_house UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    (SELECT nullif(lower(btrim(role)), '') = 'owner'
       FROM public.user_restaurant_access
      WHERE user_id = p_user AND restaurant_id = p_house AND is_active
        AND nullif(btrim(role), '') IS NOT NULL
      LIMIT 1),
    (SELECT lower(btrim(role)) = 'owner'
       FROM public.users
      WHERE user_id = p_user AND restaurant_id = p_house),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Tell the owners (and a grantee) on the web bell, from the database.
--    The same row shape NotificationsService.persistForRestaurant writes,
--    priority low (the bell only; ADR 0175 D3 keeps names off a lock screen).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authority_tell_owners(
  p_house UUID,
  p_type TEXT,
  p_title TEXT,
  p_message TEXT,
  p_grant UUID,
  p_also UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  told INTEGER := 0;
BEGIN
  INSERT INTO public.notifications (
    user_id, recipient_id, notification_type, channels, restaurant_id, type,
    title, message, priority, status, action_url, action_label, metadata, created_at
  )
  SELECT who, who, p_type, ARRAY['in_app'], p_house, p_type,
         left(p_title, 255), p_message, 'low', 'unread', '/team', 'See who may send',
         jsonb_build_object('grantId', p_grant, 'change', p_type), now()
    FROM (
      SELECT DISTINCT who FROM (
        SELECT ura.user_id AS who
          FROM public.user_restaurant_access ura
         WHERE ura.restaurant_id = p_house AND ura.is_active
           AND lower(btrim(coalesce(ura.role, ''))) = 'owner'
        UNION
        SELECT u.user_id
          FROM public.users u
         WHERE u.restaurant_id = p_house
           AND lower(btrim(u.role)) = 'owner'
           AND NOT EXISTS (
             SELECT 1 FROM public.user_restaurant_access a
              WHERE a.user_id = u.user_id AND a.restaurant_id = p_house AND a.is_active
                AND nullif(btrim(a.role), '') IS NOT NULL
           )
        UNION
        SELECT p_also WHERE p_also IS NOT NULL
      ) audience
      WHERE who IS NOT NULL
    ) people;
  GET DIAGNOSTICS told = ROW_COUNT;
  RETURN told;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. The latch. Every live grant resting on a person who is no longer an owner
--    of the house is suspended, written to the ledger, and told.
-- ---------------------------------------------------------------------------
-- One grant: latch it, write it to the ledger, tell the owners and the grantee.
CREATE OR REPLACE FUNCTION public.authority_grant_latch(
  p_grant UUID,
  p_house UUID,
  p_voucher UUID,
  p_reason TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  grantee UUID;
  grantee_name TEXT;
  voucher_name TEXT;
BEGIN
  UPDATE public.authority_grants
     SET suspended_at = now(), suspended_reason = p_reason
   WHERE id = p_grant AND restaurant_id = p_house
     AND suspended_at IS NULL AND revoked_at IS NULL AND deleted_at IS NULL
  RETURNING grantee_user_id INTO grantee;
  IF grantee IS NULL THEN
    RETURN false;
  END IF;
  PERFORM public.append_security_event(
    p_house, 'grant_suspended', NULL, 'authority_grant', p_grant,
    jsonb_build_object('voucher', p_voucher, 'reason', p_reason)
  );
  SELECT name INTO voucher_name FROM public.users WHERE user_id = p_voucher;
  SELECT name INTO grantee_name FROM public.users WHERE user_id = grantee;
  PERFORM public.authority_tell_owners(
    p_house,
    'authority_grant_suspended',
    coalesce(grantee_name, 'A member') || ' may no longer send to vendors',
    'The owner who vouched for ' || coalesce(grantee_name, 'this person') || ' ('
      || coalesce(voucher_name, 'an owner') || ') is no longer an owner here, so the grant stopped at once. '
      || 'It stays in the register awaiting an owner''s re-approval, or an owner can delete it. A security change: every owner is told.',
    p_grant,
    grantee
  );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.authority_grants_suspend_if_voucher_gone(
  p_voucher UUID,
  p_house UUID,
  p_reason TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  g RECORD;
  n INTEGER := 0;
BEGIN
  IF p_voucher IS NULL OR p_house IS NULL THEN
    RETURN 0;
  END IF;
  IF public.authority_is_house_owner(p_voucher, p_house) THEN
    RETURN 0;
  END IF;
  FOR g IN
    SELECT id
      FROM public.authority_grants
     WHERE restaurant_id = p_house
       AND vouched_by_user_id = p_voucher
       AND suspended_at IS NULL
       AND revoked_at IS NULL
       AND deleted_at IS NULL
     ORDER BY created_at
     FOR UPDATE
  LOOP
    IF public.authority_grant_latch(g.id, p_house, p_voucher, p_reason) THEN
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.authority_grants_on_access_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.authority_grants_suspend_if_voucher_gone(
      OLD.user_id, OLD.restaurant_id,
      CASE WHEN TG_OP = 'DELETE' THEN 'voucher_removed' ELSE 'voucher_no_longer_owner' END
    );
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    -- A new active access row can end a legacy owner's ownership (the access
    -- row's role is read first), and an UPDATE can move a row between houses.
    PERFORM public.authority_grants_suspend_if_voucher_gone(
      NEW.user_id, NEW.restaurant_id, 'voucher_no_longer_owner'
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_authority_grants_on_access_change ON public.user_restaurant_access;
CREATE TRIGGER trg_authority_grants_on_access_change
  AFTER INSERT OR UPDATE OR DELETE ON public.user_restaurant_access
  FOR EACH ROW EXECUTE FUNCTION public.authority_grants_on_access_change();

CREATE OR REPLACE FUNCTION public.authority_grants_on_legacy_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  g RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- BEFORE the delete, so the grants still name this person when they are
    -- latched (the ON DELETE SET NULL on vouched_by_user_id runs after).
    FOR g IN
      SELECT id, restaurant_id FROM public.authority_grants
       WHERE vouched_by_user_id = OLD.user_id
         AND suspended_at IS NULL AND revoked_at IS NULL AND deleted_at IS NULL
       ORDER BY created_at
       FOR UPDATE
    LOOP
      PERFORM public.authority_grant_latch(g.id, g.restaurant_id, OLD.user_id, 'voucher_removed');
    END LOOP;
    RETURN OLD;
  END IF;
  IF OLD.restaurant_id IS NOT NULL THEN
    PERFORM public.authority_grants_suspend_if_voucher_gone(
      OLD.user_id, OLD.restaurant_id, 'voucher_no_longer_owner'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_authority_grants_on_legacy_role_change ON public.users;
CREATE TRIGGER trg_authority_grants_on_legacy_role_change
  AFTER UPDATE OF role, restaurant_id ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.authority_grants_on_legacy_role_change();

DROP TRIGGER IF EXISTS trg_authority_grants_on_person_deleted ON public.users;
CREATE TRIGGER trg_authority_grants_on_person_deleted
  BEFORE DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.authority_grants_on_legacy_role_change();

-- ---------------------------------------------------------------------------
-- 5. The only writers of a grant. Each changes the row AND appends the event.
--    The gateway checks the owner and redeems the seal before it calls one;
--    each also re-checks the owner itself, so a caller that skipped the check
--    is still refused.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authority_grant_issue(
  p_house UUID,
  p_actor UUID,
  p_grantee UUID,
  p_limit_amount NUMERIC,
  p_limit_currency TEXT,
  p_expires_at TIMESTAMPTZ,
  p_owner_only BOOLEAN,
  p_seal_id UUID
) RETURNS public.authority_grants
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  g public.authority_grants;
BEGIN
  IF NOT public.authority_is_house_owner(p_actor, p_house) THEN
    RAISE EXCEPTION 'only an owner of this house may issue a grant' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.authority_grants (
    restaurant_id, grantor_user_id, grantee_user_id, scope, limit_amount,
    limit_currency, expires_at, owner_only, vouched_by_user_id, vouched_at
  ) VALUES (
    p_house, p_actor, p_grantee, 'vendor_send', p_limit_amount,
    p_limit_currency, p_expires_at, coalesce(p_owner_only, false), p_actor, now()
  )
  RETURNING * INTO g;
  PERFORM public.append_security_event(
    p_house, 'grant_issued', p_actor, 'authority_grant', g.id,
    jsonb_build_object(
      'grantee', p_grantee, 'limitAmount', p_limit_amount,
      'limitCurrency', p_limit_currency, 'expiresAt', p_expires_at,
      'ownerOnly', coalesce(p_owner_only, false), 'sealId', p_seal_id
    )
  );
  RETURN g;
END;
$$;

CREATE OR REPLACE FUNCTION public.authority_grant_revoke(
  p_house UUID,
  p_actor UUID,
  p_grant UUID,
  p_seal_id UUID
) RETURNS public.authority_grants
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  g public.authority_grants;
BEGIN
  IF NOT public.authority_is_house_owner(p_actor, p_house) THEN
    RAISE EXCEPTION 'only an owner of this house may revoke a grant' USING ERRCODE = '42501';
  END IF;
  UPDATE public.authority_grants
     SET revoked_at = now(), revoked_by_user_id = p_actor
   WHERE id = p_grant AND restaurant_id = p_house
     AND revoked_at IS NULL AND deleted_at IS NULL
  RETURNING * INTO g;
  IF g.id IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM public.append_security_event(
    p_house, 'grant_revoked', p_actor, 'authority_grant', g.id,
    jsonb_build_object('sealId', p_seal_id)
  );
  RETURN g;
END;
$$;

CREATE OR REPLACE FUNCTION public.authority_grant_reapprove(
  p_house UUID,
  p_actor UUID,
  p_grant UUID,
  p_seal_id UUID
) RETURNS public.authority_grants
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  g public.authority_grants;
  before public.authority_grants;
BEGIN
  IF NOT public.authority_is_house_owner(p_actor, p_house) THEN
    RAISE EXCEPTION 'only a current owner of this house may re-approve a grant' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO before FROM public.authority_grants
   WHERE id = p_grant AND restaurant_id = p_house
   FOR UPDATE;
  IF before.id IS NULL OR before.revoked_at IS NOT NULL OR before.deleted_at IS NOT NULL
     OR (before.expires_at IS NOT NULL AND before.expires_at <= now()) THEN
    RETURN NULL;
  END IF;
  -- Only a grant that is waiting: latched, or resting on nobody, or on a
  -- person who is not an owner now. A live grant is not re-approved.
  IF before.suspended_at IS NULL
     AND before.vouched_by_user_id IS NOT NULL
     AND public.authority_is_house_owner(before.vouched_by_user_id, p_house) THEN
    RETURN NULL;
  END IF;
  IF p_actor = before.grantee_user_id THEN
    RAISE EXCEPTION 'a person cannot re-approve their own grant' USING ERRCODE = '42501';
  END IF;
  UPDATE public.authority_grants
     SET vouched_by_user_id = p_actor, vouched_at = now(),
         suspended_at = NULL, suspended_reason = NULL
   WHERE id = p_grant
  RETURNING * INTO g;
  PERFORM public.append_security_event(
    p_house, 'grant_reapproved', p_actor, 'authority_grant', g.id,
    jsonb_build_object(
      'previousVoucher', before.vouched_by_user_id,
      'suspendedReason', before.suspended_reason,
      'sealId', p_seal_id
    )
  );
  RETURN g;
END;
$$;

CREATE OR REPLACE FUNCTION public.authority_grant_delete(
  p_house UUID,
  p_actor UUID,
  p_grant UUID,
  p_seal_id UUID
) RETURNS public.authority_grants
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  g public.authority_grants;
  before public.authority_grants;
BEGIN
  IF NOT public.authority_is_house_owner(p_actor, p_house) THEN
    RAISE EXCEPTION 'only an owner of this house may delete a grant' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO before FROM public.authority_grants
   WHERE id = p_grant AND restaurant_id = p_house
   FOR UPDATE;
  IF before.id IS NULL OR before.deleted_at IS NOT NULL OR before.revoked_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- Only a grant awaiting re-approval is deleted; a live grant is revoked.
  IF before.suspended_at IS NULL
     AND before.vouched_by_user_id IS NOT NULL
     AND public.authority_is_house_owner(before.vouched_by_user_id, p_house) THEN
    RETURN NULL;
  END IF;
  UPDATE public.authority_grants
     SET deleted_at = now(), deleted_by_user_id = p_actor
   WHERE id = p_grant
  RETURNING * INTO g;
  PERFORM public.append_security_event(
    p_house, 'grant_deleted', p_actor, 'authority_grant', g.id,
    jsonb_build_object('suspendedReason', before.suspended_reason, 'sealId', p_seal_id)
  );
  RETURN g;
END;
$$;

CREATE OR REPLACE FUNCTION public.authority_grant_set_owner_only(
  p_house UUID,
  p_actor UUID,
  p_grant UUID,
  p_owner_only BOOLEAN
) RETURNS public.authority_grants
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  g public.authority_grants;
BEGIN
  IF NOT public.authority_is_house_owner(p_actor, p_house) THEN
    RAISE EXCEPTION 'only an owner of this house may change who sees a grant' USING ERRCODE = '42501';
  END IF;
  IF p_owner_only IS NULL THEN
    RAISE EXCEPTION 'say whether the grant is owner-only';
  END IF;
  UPDATE public.authority_grants
     SET owner_only = p_owner_only
   WHERE id = p_grant AND restaurant_id = p_house AND deleted_at IS NULL
     AND owner_only IS DISTINCT FROM p_owner_only
  RETURNING * INTO g;
  IF g.id IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM public.append_security_event(
    p_house, 'grant_visibility_changed', p_actor, 'authority_grant', g.id,
    jsonb_build_object('ownerOnly', p_owner_only)
  );
  RETURN g;
END;
$$;

-- A send made under a grant: the grant check F12 asks the ledger to hold.
CREATE OR REPLACE FUNCTION public.authority_grant_relied_on(
  p_house UUID,
  p_actor UUID,
  p_grant UUID,
  p_act TEXT,
  p_subject TEXT
) RETURNS public.security_events
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.authority_grants
     WHERE id = p_grant AND restaurant_id = p_house AND grantee_user_id = p_actor
  ) THEN
    RAISE EXCEPTION 'that grant does not name this person in this house';
  END IF;
  RETURN public.append_security_event(
    p_house, 'grant_relied_on', p_actor, 'authority_grant', p_grant,
    jsonb_build_object('act', p_act, 'subject', p_subject)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.authority_is_house_owner(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authority_tell_owners(UUID, TEXT, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authority_grant_latch(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authority_grants_suspend_if_voucher_gone(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authority_grants_on_access_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authority_grants_on_legacy_role_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authority_grant_issue(UUID, UUID, UUID, NUMERIC, TEXT, TIMESTAMPTZ, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authority_grant_revoke(UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authority_grant_reapprove(UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authority_grant_delete(UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authority_grant_set_owner_only(UUID, UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authority_grant_relied_on(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authority_is_house_owner(UUID, UUID) TO service_role;
-- The three the latch triggers call. A SECURITY INVOKER trigger calls them as
-- whoever wrote the role row — the gateway, as service_role — so without
-- EXECUTE every role change and member removal would be refused. Granted here
-- rather than left to the platform's default privileges (the precedent of
-- 20260917010400); asserted in section 7. [Last call, 2026-09-21: a PGlite
-- build with no default privileges showed service_role without EXECUTE on
-- all three.]
GRANT EXECUTE ON FUNCTION public.authority_tell_owners(UUID, TEXT, TEXT, TEXT, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.authority_grant_latch(UUID, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.authority_grants_suspend_if_voucher_gone(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.authority_grant_issue(UUID, UUID, UUID, NUMERIC, TEXT, TIMESTAMPTZ, BOOLEAN, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.authority_grant_revoke(UUID, UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.authority_grant_reapprove(UUID, UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.authority_grant_delete(UUID, UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.authority_grant_set_owner_only(UUID, UUID, UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.authority_grant_relied_on(UUID, UUID, UUID, TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. The seal learns the grant (read-and-append, never a literal).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  existing_def TEXT;
  kinds TEXT[];
  rebuilt TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO existing_def
  FROM pg_constraint
  WHERE conrelid = 'public.mcp_seal_challenges'::regclass
    AND conname = 'chk_mcp_seal_challenges_subject_kind';
  IF existing_def IS NULL THEN
    RAISE EXCEPTION 'chk_mcp_seal_challenges_subject_kind is absent: this migration extends a constraint that must already exist';
  END IF;
  SELECT array_agg(DISTINCT m[1]) INTO kinds
  FROM regexp_matches(existing_def, '''([a-z_]+)''', 'g') AS m;
  IF kinds IS NULL OR array_length(kinds, 1) < 4 THEN
    RAISE EXCEPTION 'could not read the admitted seal kinds out of "%" - refusing to rewrite a constraint this migration cannot read', existing_def;
  END IF;
  IF 'authority_grant' = ANY(kinds) THEN
    RETURN;
  END IF;
  kinds := kinds || 'authority_grant'::text;
  SELECT string_agg(quote_literal(k), ', ' ORDER BY k) INTO rebuilt FROM unnest(kinds) AS k;
  EXECUTE 'ALTER TABLE public.mcp_seal_challenges DROP CONSTRAINT chk_mcp_seal_challenges_subject_kind';
  EXECUTE 'ALTER TABLE public.mcp_seal_challenges ADD CONSTRAINT chk_mcp_seal_challenges_subject_kind '
       || format('CHECK (subject_kind IN (%s))', rebuilt);
END $$;

-- ---------------------------------------------------------------------------
-- 7. Assertions. A partial apply must fail here, not pass quietly.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c TEXT;
  absent TEXT;
  def TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY['vouched_by_user_id', 'vouched_at', 'suspended_at', 'suspended_reason', 'owner_only', 'deleted_at', 'deleted_by_user_id'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'authority_grants' AND column_name = c
    ) THEN
      absent := concat_ws(', ', absent, c);
    END IF;
  END LOOP;
  IF absent IS NOT NULL THEN
    RAISE EXCEPTION 'authority_grants is missing columns the gateway reads: %', absent;
  END IF;
  IF EXISTS (SELECT 1 FROM public.authority_grants WHERE vouched_at IS NULL) THEN
    RAISE EXCEPTION 'a grant rests on nobody: the backfill did not run';
  END IF;
  FOREACH c IN ARRAY ARRAY['trg_authority_grants_on_access_change'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = c AND tgrelid = 'public.user_restaurant_access'::regclass) THEN
      RAISE EXCEPTION 'the % latch is missing', c;
    END IF;
  END LOOP;
  FOREACH c IN ARRAY ARRAY['trg_authority_grants_on_legacy_role_change', 'trg_authority_grants_on_person_deleted'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = c AND tgrelid = 'public.users'::regclass) THEN
      RAISE EXCEPTION 'the % latch is missing', c;
    END IF;
  END LOOP;
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.mcp_seal_challenges'::regclass AND conname = 'chk_mcp_seal_challenges_subject_kind';
  IF def IS NULL OR position('''authority_grant''' IN def) = 0 THEN
    RAISE EXCEPTION 'the seal CHECK does not admit authority_grant; the code declares a kind the database refuses';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
       AND p.proname IN (
         'authority_is_house_owner', 'authority_tell_owners', 'authority_grant_latch', 'authority_grants_suspend_if_voucher_gone',
         'authority_grants_on_access_change', 'authority_grants_on_legacy_role_change',
         'authority_grant_issue', 'authority_grant_revoke', 'authority_grant_reapprove',
         'authority_grant_delete', 'authority_grant_set_owner_only', 'authority_grant_relied_on')
  ) THEN
    RAISE EXCEPTION 'a grant function is SECURITY DEFINER; every one must run with its caller''s rights';
  END IF;
  -- The gateway writes role rows as service_role, and the latch triggers run
  -- as the writer: service_role must be able to run everything they call.
  FOREACH c IN ARRAY ARRAY[
    'public.authority_is_house_owner(uuid,uuid)',
    'public.authority_tell_owners(uuid,text,text,text,uuid,uuid)',
    'public.authority_grant_latch(uuid,uuid,uuid,text)',
    'public.authority_grants_suspend_if_voucher_gone(uuid,uuid,text)',
    'public.append_security_event(uuid,text,uuid,text,uuid,jsonb)'
  ] LOOP
    IF NOT has_function_privilege('service_role', c, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot run %, which a latch trigger calls: every role change through the gateway would be refused', c;
    END IF;
  END LOOP;
  RAISE NOTICE 'authority_grants: vouched, latched on ownership loss, ledgered, sealed.';
END
$$;
