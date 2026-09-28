-- A vendor has at most one primary branch in a house, and the mark moves in
-- one transaction — ADR 0221 (founder 2026-09-26, round 8, items 51 and 57:
-- branches edited on the Mudavym vendor sheet; "last branch removable;
-- primary passes to oldest remaining").
--
-- WHY THIS EXISTS
-- ---------------
-- Audit of PR #484 at d44056b42 (2026-09-27, R4, both reviewers): the
-- gateway moved the primary mark in separate PostgREST calls, each its own
-- transaction, and nothing in the schema said "one primary":
--
--   * PATCH isPrimary — "demote the others" then "set this one". Two
--     requests promoting two different branches can interleave (A demotes
--     all but B, C's request demotes all but C, A sets B, C's request sets C)
--     and leave TWO primaries.
--   * DELETE of the primary — delete, then read the oldest remaining, then
--     promote it. A create-as-primary landing between the read and the
--     promote leaves two primaries; a failed promote leaves none.
--
-- `provider_locations.is_primary` is a plain boolean (baseline) with no
-- partial unique index, so both outcomes were storable.
--
-- WHAT THIS ADDS
-- --------------
--   1. `provider_locations_one_primary`: a partial UNIQUE index on
--      (provider_id, restaurant_id) WHERE is_primary. Two primaries for one
--      vendor in one house can no longer be stored, whatever the caller.
--      Safe to build: production held 2 provider_locations rows and 0
--      (provider_id, restaurant_id) groups with more than one primary
--      (read-only count, 2026-09-28).
--   2. `provider_location_make_primary(house, vendor, branch)`: takes a
--      transaction-scoped advisory lock keyed on the vendor+house, then
--      demotes every other primary and marks this branch, in one
--      transaction. Returns false (writes nothing) when the branch is not
--      this vendor's in this house.
--   3. `provider_location_remove(house, vendor, branch)`: same lock; deletes
--      the branch and, if it held the mark and no other branch now does,
--      hands the mark to the oldest remaining branch (created_at, then id) —
--      all in one transaction, so a failed hand-off rolls the delete back
--      instead of leaving a vendor with branches and no primary. Returns
--      {"removed": bool, "promotedId": uuid|null}.
--
-- The lock serialises every primary move for one vendor in one house (the
-- only writers are these two functions; the gateway inserts new branches as
-- non-primary and then calls make_primary). The index is the backstop if a
-- future writer skips the functions.
--
-- WHO MAY CALL THEM
-- -----------------
-- SECURITY INVOKER, EXECUTE revoked from PUBLIC/anon/authenticated and
-- granted to service_role only: the gateway calls them with the service role
-- after `getProvider(providerId, houseOf(user))` has proved the vendor is the
-- caller's house's, and passes that house as p_restaurant_id. Every
-- statement inside filters on p_restaurant_id AND p_provider_id.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

CREATE UNIQUE INDEX IF NOT EXISTS provider_locations_one_primary
  ON public.provider_locations (provider_id, restaurant_id)
  WHERE is_primary;

COMMENT ON INDEX public.provider_locations_one_primary IS
  'At most one primary branch per vendor per house (ADR 0221; audit of PR #484, 2026-09-28). The mark moves only through provider_location_make_primary / provider_location_remove, which serialise on an advisory lock; this index is the backstop.';

CREATE OR REPLACE FUNCTION public.provider_location_make_primary(
  p_restaurant_id uuid,
  p_provider_id uuid,
  p_location_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'provider_locations.primary:' || p_provider_id::text || ':' || p_restaurant_id::text,
      0
    )
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.provider_locations
     WHERE id = p_location_id
       AND provider_id = p_provider_id
       AND restaurant_id = p_restaurant_id
  ) THEN
    RETURN false;
  END IF;

  -- Demote first: the unique index is checked row by row, so marking the new
  -- branch before the old one is cleared would refuse the move.
  UPDATE public.provider_locations
     SET is_primary = false
   WHERE provider_id = p_provider_id
     AND restaurant_id = p_restaurant_id
     AND is_primary
     AND id <> p_location_id;

  UPDATE public.provider_locations
     SET is_primary = true
   WHERE id = p_location_id
     AND provider_id = p_provider_id
     AND restaurant_id = p_restaurant_id
     AND NOT is_primary;

  RETURN true;
END
$$;

COMMENT ON FUNCTION public.provider_location_make_primary(uuid, uuid, uuid) IS
  'Mark one branch primary and clear the mark on the vendor''s other branches in this house, in one transaction under a per-vendor-per-house advisory lock. False (nothing written) when the branch is not this vendor''s in this house. Called by ProvidersService.createProviderLocation / updateProviderLocation (apps/api-gateway/src/providers/providers.service.ts). ADR 0221; audit of PR #484.';

CREATE OR REPLACE FUNCTION public.provider_location_remove(
  p_restaurant_id uuid,
  p_provider_id uuid,
  p_location_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_was_primary boolean;
  v_next uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'provider_locations.primary:' || p_provider_id::text || ':' || p_restaurant_id::text,
      0
    )
  );

  DELETE FROM public.provider_locations
   WHERE id = p_location_id
     AND provider_id = p_provider_id
     AND restaurant_id = p_restaurant_id
  RETURNING is_primary INTO v_was_primary;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('removed', false, 'promotedId', null);
  END IF;

  IF v_was_primary AND NOT EXISTS (
    SELECT 1 FROM public.provider_locations
     WHERE provider_id = p_provider_id
       AND restaurant_id = p_restaurant_id
       AND is_primary
  ) THEN
    SELECT id INTO v_next
      FROM public.provider_locations
     WHERE provider_id = p_provider_id
       AND restaurant_id = p_restaurant_id
     ORDER BY created_at ASC NULLS LAST, id ASC
     LIMIT 1;

    IF v_next IS NOT NULL THEN
      UPDATE public.provider_locations
         SET is_primary = true
       WHERE id = v_next;
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object('removed', true, 'promotedId', v_next);
END
$$;

COMMENT ON FUNCTION public.provider_location_remove(uuid, uuid, uuid) IS
  'Delete one branch; if it held the primary mark and no other branch does, hand the mark to the oldest remaining branch (created_at, then id) — one transaction under the same advisory lock as provider_location_make_primary, so the hand-off cannot half-happen. Returns {"removed": bool, "promotedId": uuid|null}. Called by ProvidersService.deleteProviderLocation. ADR 0221 (founder item 57: primary passes to the oldest remaining); audit of PR #484.';

REVOKE ALL ON FUNCTION public.provider_location_make_primary(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.provider_location_remove(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_location_make_primary(uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.provider_location_remove(uuid, uuid, uuid)
  TO service_role;
