-- A removed person's credentials are kept on the same five-year clock as their
-- shifts, leave and wage record; their availability is not. ADR 0215.
--
-- THE FOUNDER, 2026-09-25 (round 4, item 19), asked "#440: should a removed
-- person's availability and credentials (certificates etc.) also be kept like
-- shifts and leave?", picked, verbatim:
--
--   "Credentials yes, availability no (Recommended)" -- "Certificates can
--   matter for audits; availability has no value once someone leaves."
--
-- WHAT WAS THERE: `team_certifications.member_id` and
-- `team_availability.member_id` reference `team_members(id)` `ON DELETE
-- CASCADE` (baseline `20260805000000_baseline_from_production.sql:13646`,
-- `:13638`). Removing a roster row deleted both the same second. Migration
-- `20260925180200` stopped that for shifts and leave only, and ADR 0215
-- residual (j) recorded credentials and availability as still cascading.
--
-- THE CHANGE:
--
-- 1. `team_certifications_member_id_fkey` is dropped, for the same reason
--    `20260925180200` dropped the shifts and leave keys: a row that must
--    outlive its person's removal cannot be pinned to the row the removal
--    deletes. New credentials are still checked against the live roster in
--    the gateway (`assertMemberInRestaurant` in `createCert`), and a removed
--    person's credentials are left out of every team view (`onTheRoster` in
--    `listCertifications`) -- they are shown only in the owner's former-staff
--    history (item 19's second answer).
-- 2. The departure is stamped when the removed person has a credential too,
--    so its five years can be timed; `purge_expired_credential_records()`
--    deletes a departed person's credentials once those five years have run,
--    called by the same nightly job BEFORE the wage purge; and the departure
--    row is cleared, and may be deleted, only once the credentials are gone
--    as well.
-- 3. AVAILABILITY IS UNCHANGED, on purpose: `team_availability_member_id_fkey`
--    keeps `ON DELETE CASCADE`, so a removal still deletes the person's
--    availability the same second, which is "availability no". Nothing here
--    deletes a row: no availability row of a removed person can exist today,
--    because the cascade has always taken it (ADR 0149's never-delete rule is
--    not engaged -- there are no retained rows to stop retaining).
--
-- A removed person's credential file may carry `doc_url`, a link to an
-- uploaded document. The row is kept; the stored object is not touched by
-- this migration (no path here ever deleted it either).
--
-- Additive and idempotent: one constraint dropped (IF EXISTS), four functions
-- created or replaced, no row written or deleted by the migration itself.

SET local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. Credentials no longer go with the removal.
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_certifications
  DROP CONSTRAINT IF EXISTS team_certifications_member_id_fkey;

COMMENT ON COLUMN public.team_certifications.member_id IS
  'The person this credential belongs to. No foreign key to team_members, on purpose (ADR 0215, founder 2026-09-25 round 4 item 19, "Credentials yes, availability no"): a roster removal must not take the credential with it. Checked against the live roster by the gateway at write time (assertMemberInRestaurant), not by this column; kept five years after the removal, then deleted by purge_expired_credential_records().';

COMMENT ON COLUMN public.team_availability.member_id IS
  'The person this availability belongs to. Still ON DELETE CASCADE, on purpose (ADR 0215, founder 2026-09-25 round 4 item 19, "Credentials yes, availability no"): a removed person''s availability is not kept.';

-- ---------------------------------------------------------------------------
-- 2. The departure is stamped for a person with a credential too.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_member_departure_recorded()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (
       SELECT 1 FROM public.restaurants r WHERE r.id = OLD.restaurant_id)
     AND (
       EXISTS (
         SELECT 1 FROM public.team_member_wage_changes w
          WHERE w.restaurant_id = OLD.restaurant_id AND w.member_id = OLD.id)
       OR EXISTS (
         SELECT 1 FROM public.shifts s
          WHERE s.restaurant_id = OLD.restaurant_id AND s.member_id = OLD.id)
       OR EXISTS (
         SELECT 1 FROM public.time_off_requests t
          WHERE t.restaurant_id = OLD.restaurant_id AND t.member_id = OLD.id)
       OR EXISTS (
         SELECT 1 FROM public.team_certifications c
          WHERE c.restaurant_id = OLD.restaurant_id AND c.member_id = OLD.id)
     )
  THEN
    INSERT INTO public.team_member_departures (restaurant_id, member_id)
    VALUES (OLD.restaurant_id, OLD.id)
    ON CONFLICT (restaurant_id, member_id) DO NOTHING;
  END IF;
  RETURN OLD;
END
$function$;

COMMENT ON FUNCTION public.team_member_departure_recorded() IS
  'Writes the team_member_departures row when a person with a wage record, a shift, a leave request or a credential is removed from the roster, so the five years those records are kept can be timed (ADR 0215; broadened 2026-09-22 round 6y to shifts and leave, 2026-09-25 round 4 to credentials).';

-- ---------------------------------------------------------------------------
-- 3. The credential purge: the same clock, the same job, run first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_expired_credential_records()
RETURNS TABLE (credentials_deleted BIGINT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_certs BIGINT;
BEGIN
  DELETE FROM public.team_certifications c
   USING public.team_member_departures d
   WHERE d.restaurant_id = c.restaurant_id
     AND d.member_id = c.member_id
     AND d.left_at <= now() - public.wage_record_retention()
     AND NOT EXISTS (
       SELECT 1 FROM public.team_members m WHERE m.id = c.member_id);
  GET DIAGNOSTICS v_certs = ROW_COUNT;
  RETURN QUERY SELECT v_certs;
END
$function$;

COMMENT ON FUNCTION public.purge_expired_credential_records() IS
  'Deletes every credential whose person''s departure (team_member_departures) is more than wage_record_retention() (5 years) old (ADR 0215, founder 2026-09-25 round 4 item 19): called by the same nightly job (WageRecordRetentionService) before purge_expired_wage_records(), so that function''s departure cleanup sees these rows already gone.';

REVOKE ALL ON FUNCTION public.purge_expired_credential_records() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_expired_credential_records() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_credential_records() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. A departure outlives its credentials too.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_expired_wage_records()
RETURNS TABLE (wage_rows_deleted BIGINT, departures_deleted BIGINT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_rows BIGINT;
  v_departures BIGINT;
BEGIN
  DELETE FROM public.team_member_wage_changes w
   USING public.team_member_departures d
   WHERE d.restaurant_id = w.restaurant_id
     AND d.member_id = w.member_id
     AND d.left_at <= now() - public.wage_record_retention()
     AND NOT EXISTS (
       SELECT 1 FROM public.team_members m WHERE m.id = w.member_id);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  -- A departure is cleared only once its wage record, its shifts, its leave
  -- requests AND its credentials are ALL gone (ADR 0215; credentials added
  -- 2026-09-25 round 4): while any of them still exists for this person, the
  -- departure row is what times its own five years.
  DELETE FROM public.team_member_departures d
   WHERE d.left_at <= now() - public.wage_record_retention()
     AND NOT EXISTS (
       SELECT 1 FROM public.team_member_wage_changes w
        WHERE w.restaurant_id = d.restaurant_id AND w.member_id = d.member_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.shifts s
        WHERE s.restaurant_id = d.restaurant_id AND s.member_id = d.member_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.time_off_requests t
        WHERE t.restaurant_id = d.restaurant_id AND t.member_id = d.member_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.team_certifications c
        WHERE c.restaurant_id = d.restaurant_id AND c.member_id = d.member_id);
  GET DIAGNOSTICS v_departures = ROW_COUNT;
  RETURN QUERY SELECT v_rows, v_departures;
END
$function$;

COMMENT ON FUNCTION public.purge_expired_wage_records() IS
  'Deletes every wage change row whose person left the roster more than wage_record_retention() (5 years) ago, then the departure rows with nothing left to time -- wage changes, shifts, leave requests AND credentials all gone (ADR 0215; broadened 2026-09-22 round 6y and 2026-09-25 round 4) -- and returns both counts. Called nightly by the gateway, after purge_expired_credential_records() and purge_expired_shift_and_leave_records(). Cannot delete early: the append-only guard refuses any wage row whose five years have not run.';

CREATE OR REPLACE FUNCTION public.tmd_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    IF OLD.left_at <= now() - public.wage_record_retention()
       AND NOT EXISTS (
         SELECT 1 FROM public.team_member_wage_changes w
          WHERE w.restaurant_id = OLD.restaurant_id
            AND w.member_id = OLD.member_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.shifts s
          WHERE s.restaurant_id = OLD.restaurant_id
            AND s.member_id = OLD.member_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.time_off_requests t
          WHERE t.restaurant_id = OLD.restaurant_id
            AND t.member_id = OLD.member_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.team_certifications c
          WHERE c.restaurant_id = OLD.restaurant_id
            AND c.member_id = OLD.member_id)
    THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION
    'team_member_departures: % is not permitted. A departure is deleted only after its five years have run and its wage record, shifts, leave requests and credentials are all gone.',
    TG_OP;
END
$function$;

-- ---------------------------------------------------------------------------
-- 5. Proof, in the migration: it fails loudly if any half did not land.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'team_certifications_member_id_fkey'
       AND conrelid = 'public.team_certifications'::regclass
  ) THEN
    RAISE EXCEPTION 'team_certifications_member_id_fkey was not dropped';
  END IF;
  -- "availability no": the cascade stays exactly as the baseline has it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'team_availability_member_id_fkey'
       AND conrelid = 'public.team_availability'::regclass
       AND confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'team_availability_member_id_fkey is no longer ON DELETE CASCADE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid = 'public.purge_expired_credential_records()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'purge_expired_credential_records() was not created';
  END IF;
  IF has_function_privilege('anon', 'public.purge_expired_credential_records()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.purge_expired_credential_records()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon/authenticated can still execute purge_expired_credential_records()';
  END IF;
  IF (SELECT prosecdef FROM pg_proc
       WHERE oid = 'public.purge_expired_credential_records()'::regprocedure) THEN
    RAISE EXCEPTION 'purge_expired_credential_records() is SECURITY DEFINER, not INVOKER';
  END IF;
  IF (SELECT count(*) FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = 'team_certifications'
         AND grantee IN ('anon', 'authenticated')) > 0 THEN
    RAISE EXCEPTION 'anon/authenticated hold a grant on team_certifications';
  END IF;
  RAISE NOTICE 'team_certifications no longer cascade-deletes on a roster removal; team_availability still does; purge_expired_credential_records() is in place, service_role only.';
END
$$;
