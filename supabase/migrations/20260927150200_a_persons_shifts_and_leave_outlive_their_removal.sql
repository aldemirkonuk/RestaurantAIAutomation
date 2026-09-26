-- A removed person's shifts and leave requests are kept, not deleted the same
-- second, and end with the wage record: five years after removal, the same
-- nightly job. ADR 0215.
--
-- THE FOUNDER, 2026-09-22 (round 6y), on the question ADR 0215 returned after
-- round 2 (residual (j), question 5) -- "removing a person deletes their
-- shifts and leave requests at once... Should [they] be kept for the same
-- five years, or is the wage record alone what the pick meant?" -- picked
-- "Keep them 5 years (Recommended)", verbatim:
--
--   "removing a person must no longer delete their shifts and leave requests
--   straight away; they are kept and end with the wage record (same
--   five-year clock, same deletion job)"
--
-- WHAT WAS WRONG (found at the round-2 last call, recorded and not fixed
-- there): `shifts.member_id` and `time_off_requests.member_id` reference
-- `team_members(id)` `ON DELETE CASCADE` (baseline
-- `20260805000000_baseline_from_production.sql:13502`, `:13654`). Removing a
-- roster row -- `TeamService.deleteMember`, `team.service.ts` -- deletes
-- `team_members`, and the cascade took every shift and leave request with it
-- in the same statement, so the wage record kept five years
-- (`20260925180110`) had no hours or leave beside it to show what it priced.
--
-- THE FIX, in two halves:
--
-- 1. Both foreign keys are dropped. `shifts.member_id` and
--    `time_off_requests.member_id` keep their column and their value; they
--    stop referencing `team_members` at all, on purpose -- the SAME reason
--    `team_member_wage_changes.member_id` (20260925180000) already carries no
--    such key: a row that must outlive its person's removal cannot be
--    pinned to a row the removal deletes. New writes are still checked
--    against the live roster in the gateway (`assertMemberInRestaurant` in
--    `createShift`/`updateShift`/`assignCover`/`createTimeOff`; `copyWeek`
--    copies only shifts whose person is on the roster, `onTheRoster`), which
--    is where every other actor reference in this schema is checked too (ADR:
--    permissions and referential checks live in code, audited).
--
-- 2. The SAME clock, the SAME job. `team_member_departure_recorded()`
--    (20260925180110) stamped a `team_member_departures` row only when the
--    removed person had a wage record; it now also stamps one when they have
--    a shift or a leave request, so a person who worked but was never paid
--    through this table is still timed. `purge_expired_shift_and_leave_records()`
--    deletes shifts and leave requests whose person's departure is more than
--    `wage_record_retention()` (5 years) old, the same function the wage
--    purge reads; `WageRecordRetentionService`'s nightly call now runs this
--    purge FIRST, then the wage purge, so a departure is not cleared out
--    from under rows this migration's purge has not reached yet.
--    `purge_expired_wage_records()`'s own departure cleanup (unchanged
--    return shape: `wage_rows_deleted`, `departures_deleted`) now also checks
--    that no shift and no leave request are left, so a departure row is
--    removed only once wage, shifts AND leave are all gone -- never while any
--    of the three still needs it to time its own five years. The departures
--    table's DELETE guard (`tmd_guard`) gains the identical check, so a
--    direct DELETE outside the purge is refused on the same terms.
--
-- RLS is unchanged: `shifts` and `time_off_requests` have RLS on and no
-- policy, and no grant to `anon`/`authenticated` since
-- `20260825210000_od72_revoke_client_grants.sql` revoked client grants
-- schema-wide (the baseline dump carries no grants at all, so it cannot show
-- this; the DO block below asserts it). Every read and write goes through the
-- gateway's service-role client, gated by role in code -- `getWeek` and
-- `listTimeOff`'s full list manager+, `getMyWeek` and a staff caller's
-- `listTimeOff` their own rows only. A staff reply is scoped to the CALLER's
-- own member id, never a departed person's. And the gateway leaves a removed
-- person's kept rows out of the working week altogether (`onTheRoster`,
-- `pay-rules.ts`): `getWeek`, `copyWeek` and the leave list read as they did
-- before this migration, when a removal deleted those rows, so the kept rows
-- are a record, like the wage record, which no page reads.
--
-- ADDITIVE AND IDEMPOTENT: two constraints dropped (guarded `IF EXISTS`, and
-- re-dropping is a no-op), two functions replaced (`CREATE OR REPLACE`), one
-- function added, one trigger function replaced. No row written, no row
-- deleted.
SET local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. The two foreign keys, dropped. The columns and their values stay.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shifts
  DROP CONSTRAINT IF EXISTS shifts_member_id_fkey;

COMMENT ON COLUMN public.shifts.member_id IS
  'The person this shift is scheduled for; NULL is an open shift. No foreign key to team_members, on purpose (ADR 0215, 2026-09-22 round 6y): a roster removal must not take the shift with it. Checked against the live roster by the gateway at write time (assertMemberInRestaurant), not by this column.';

ALTER TABLE public.time_off_requests
  DROP CONSTRAINT IF EXISTS time_off_requests_member_id_fkey;

COMMENT ON COLUMN public.time_off_requests.member_id IS
  'The person this leave request is for. No foreign key to team_members, on purpose (ADR 0215, 2026-09-22 round 6y): a roster removal must not take the request with it. Checked against the live roster by the gateway at write time (assertMemberInRestaurant), not by this column.';

-- ---------------------------------------------------------------------------
-- 2. The departure is stamped for a shift or a leave request too, not only a
--    wage record.
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
  'Writes the team_member_departures row when a person with a wage record, a shift or a leave request is removed from the roster, so the five years those records are kept can be timed (ADR 0215; broadened 2026-09-22 round 6y from wage records only).';

-- ---------------------------------------------------------------------------
-- 3. The purge for shifts and leave: same clock, its own function, called by
--    the same nightly job.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_expired_shift_and_leave_records()
RETURNS TABLE (shifts_deleted BIGINT, leave_rows_deleted BIGINT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_shifts BIGINT;
  v_leave BIGINT;
BEGIN
  DELETE FROM public.shifts s
   USING public.team_member_departures d
   WHERE d.restaurant_id = s.restaurant_id
     AND d.member_id = s.member_id
     AND d.left_at <= now() - public.wage_record_retention()
     AND NOT EXISTS (
       SELECT 1 FROM public.team_members m WHERE m.id = s.member_id);
  GET DIAGNOSTICS v_shifts = ROW_COUNT;

  DELETE FROM public.time_off_requests t
   USING public.team_member_departures d
   WHERE d.restaurant_id = t.restaurant_id
     AND d.member_id = t.member_id
     AND d.left_at <= now() - public.wage_record_retention()
     AND NOT EXISTS (
       SELECT 1 FROM public.team_members m WHERE m.id = t.member_id);
  GET DIAGNOSTICS v_leave = ROW_COUNT;

  RETURN QUERY SELECT v_shifts, v_leave;
END
$function$;

COMMENT ON FUNCTION public.purge_expired_shift_and_leave_records() IS
  'Deletes every shift and leave request whose person''s departure (team_member_departures) is more than wage_record_retention() (5 years) old (ADR 0215, 2026-09-22 round 6y): the same clock as the wage record, called by the same nightly job (WageRecordRetentionService), before purge_expired_wage_records() so that function''s departure cleanup sees these rows already gone.';

REVOKE ALL ON FUNCTION public.purge_expired_shift_and_leave_records() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_expired_shift_and_leave_records() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_shift_and_leave_records() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. A departure is cleared out only once NOTHING of the person's is left to
--    time: wage changes, shifts AND leave requests, not wage changes alone.
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

  -- A departure is cleared only once its wage record, its shifts AND its
  -- leave requests are ALL gone (ADR 0215, 2026-09-22 round 6y): while any of
  -- the three still exists for this person, the departure row is what times
  -- its own five years, so it must outlive them, not the other way round.
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
        WHERE t.restaurant_id = d.restaurant_id AND t.member_id = d.member_id);
  GET DIAGNOSTICS v_departures = ROW_COUNT;

  RETURN QUERY SELECT v_rows, v_departures;
END
$function$;

COMMENT ON FUNCTION public.purge_expired_wage_records() IS
  'Deletes every wage change row whose person left the roster more than wage_record_retention() (5 years) ago, then the departure rows with nothing left to time -- wage changes, shifts AND leave requests all gone (ADR 0215; broadened 2026-09-22 round 6y, was wage changes alone) -- and returns both counts. Called nightly by the gateway, after purge_expired_shift_and_leave_records(). Cannot delete early: the append-only guard refuses any wage row whose five years have not run.';

-- ---------------------------------------------------------------------------
-- 5. The departures table's own DELETE guard learns the same broadened check
--    (defence in depth: refuses a direct DELETE outside the purge on the same
--    terms the purge itself applies).
-- ---------------------------------------------------------------------------
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
    THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION
    'team_member_departures: % is not permitted. A departure is deleted only after its five years have run and its wage record, shifts and leave requests are all gone.',
    TG_OP;
END
$function$;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'shifts_member_id_fkey'
       AND conrelid = 'public.shifts'::regclass
  ) THEN
    RAISE EXCEPTION 'shifts_member_id_fkey was not dropped';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'time_off_requests_member_id_fkey'
       AND conrelid = 'public.time_off_requests'::regclass
  ) THEN
    RAISE EXCEPTION 'time_off_requests_member_id_fkey was not dropped';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid = 'public.purge_expired_shift_and_leave_records()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'purge_expired_shift_and_leave_records() was not created';
  END IF;
  IF has_function_privilege('anon', 'public.purge_expired_shift_and_leave_records()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.purge_expired_shift_and_leave_records()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon/authenticated can still execute purge_expired_shift_and_leave_records()';
  END IF;
  IF (SELECT prosecdef FROM pg_proc
       WHERE oid = 'public.purge_expired_shift_and_leave_records()'::regprocedure) THEN
    RAISE EXCEPTION 'purge_expired_shift_and_leave_records() is SECURITY DEFINER, not INVOKER';
  END IF;
  -- shifts and time_off_requests carry no grant to anon/authenticated (RLS
  -- unchanged: no policy on either; the client grants every public table had
  -- were revoked schema-wide by 20260825210000, OD-72).
  IF (SELECT count(*) FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name IN ('shifts', 'time_off_requests')
         AND grantee IN ('anon', 'authenticated')) > 0 THEN
    RAISE EXCEPTION 'anon/authenticated hold a grant on shifts or time_off_requests';
  END IF;
  RAISE NOTICE 'shifts and time_off_requests no longer cascade-delete on a roster removal; purge_expired_shift_and_leave_records() is in place, service_role only.';
END
$$;
