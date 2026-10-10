-- a_week_copy_replaces_the_week_it_read — "Copy last week" deletes and
-- inserts in one transaction that holds the week, and only over the week it
-- read (F-1030).
--
-- WHAT WAS WRONG
-- --------------
-- ScheduleService.copyWeek read the target week's shifts, then deleted the
-- ones in the way, then inserted the copy: three PostgREST calls, no lock,
-- and nothing unique on shifts. Two copies at once (two managers, or two
-- tabs) both read the same week, both deleted the same ids and both
-- inserted, so every shift landed twice. A copy that failed after its delete
-- left the week empty.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- replace_week_shifts(house, schedule, week_start, seen, delete, rows):
--   1. locks the week's schedules row FOR UPDATE (it must be this house's,
--      for this Monday), so a second copy of the same week waits here;
--   2. re-reads the ids of every shift in that house's week (Monday to
--      Sunday, kept shifts of removed people included) and raises 40001
--      unless they are exactly `seen`, the ids the gateway read. The second
--      copy, let through after the first commits, sees the first one's rows
--      and is refused, so it cannot double them;
--   3. deletes `delete` by id (every one must go, or it raises), and inserts
--      `rows` with this house and this schedule forced on each.
-- All of it or none of it. The gateway answers 40001 with a 409 in words.
--
-- What it does NOT cover: a single shift added by hand in the same instant
-- (createShift takes no lock). That shift is neither deleted nor doubled; it
-- stays beside the copy.
--
-- SECURITY INVOKER (not DEFINER), like hand_over_leaving_shifts: the gateway
-- calls it with the service role; anon and authenticated may not call it.
--
-- ADDITIVE AND IDEMPOTENT. One function; no row is written by this file.
-- NOT APPLIED BY HAND. The Supabase GitHub integration applies migrations on
-- merge, keyed by this filename.

CREATE OR REPLACE FUNCTION public.replace_week_shifts(
  p_restaurant_id uuid,
  p_schedule_id   uuid,
  p_week_start    date,
  p_seen          jsonb,
  p_delete        jsonb,
  p_rows          jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seen    uuid[];
  v_now     uuid[];
  v_delete  uuid[];
  v_deleted integer := 0;
  v_copied  integer := 0;
BEGIN
  IF p_restaurant_id IS NULL OR p_schedule_id IS NULL OR p_week_start IS NULL THEN
    RAISE EXCEPTION 'replace_week_shifts: a house, a schedule and a week are all required; nothing was changed';
  END IF;
  IF jsonb_typeof(coalesce(p_seen, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_delete, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'replace_week_shifts: seen, delete and rows must be arrays; nothing was changed';
  END IF;

  -- 1. The week, held until this transaction ends.
  PERFORM 1 FROM public.schedules
   WHERE id = p_schedule_id
     AND restaurant_id = p_restaurant_id
     AND week_start = p_week_start
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'replace_week_shifts: no such week for this house; nothing was changed';
  END IF;

  -- 2. The week as it is now must be the week the caller read.
  SELECT coalesce(array_agg(x::uuid ORDER BY x::uuid), '{}')
    INTO v_seen
    FROM jsonb_array_elements_text(coalesce(p_seen, '[]'::jsonb)) AS x;
  SELECT coalesce(array_agg(id ORDER BY id), '{}')
    INTO v_now
    FROM public.shifts
   WHERE restaurant_id = p_restaurant_id
     AND shift_date BETWEEN p_week_start AND p_week_start + 6;
  IF v_now IS DISTINCT FROM v_seen THEN
    RAISE EXCEPTION 'replace_week_shifts: the week of % changed after it was read; nothing was changed', p_week_start
      USING ERRCODE = '40001';
  END IF;

  -- 3. Out with what was in the way, in with the copy.
  SELECT coalesce(array_agg(DISTINCT x::uuid), '{}')
    INTO v_delete
    FROM jsonb_array_elements_text(coalesce(p_delete, '[]'::jsonb)) AS x;
  IF NOT v_delete <@ v_seen THEN
    RAISE EXCEPTION 'replace_week_shifts: a shift to delete is not in the week; nothing was changed';
  END IF;
  DELETE FROM public.shifts
   WHERE restaurant_id = p_restaurant_id
     AND id = ANY (v_delete);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> coalesce(array_length(v_delete, 1), 0) THEN
    RAISE EXCEPTION 'replace_week_shifts: % of % shifts could be deleted; nothing was changed',
      v_deleted, coalesce(array_length(v_delete, 1), 0)
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.shifts (
    restaurant_id, schedule_id, member_id, shift_date, start_time, end_time,
    role, shift_type, state, note, recorded_break_min, labor_cost
  )
  SELECT p_restaurant_id, p_schedule_id, r.member_id, r.shift_date,
         r.start_time, r.end_time, r.role,
         coalesce(r.shift_type, 'pm'), coalesce(r.state, 'scheduled'),
         r.note, r.recorded_break_min, r.labor_cost
    FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS r(
      member_id uuid, shift_date date, start_time text, end_time text,
      role text, shift_type text, state text, note text,
      recorded_break_min integer, labor_cost numeric
    );
  GET DIAGNOSTICS v_copied = ROW_COUNT;

  UPDATE public.schedules SET updated_at = now() WHERE id = p_schedule_id;

  RETURN jsonb_build_object('deleted', v_deleted, 'copied', v_copied);
END
$$;

COMMENT ON FUNCTION public.replace_week_shifts(uuid, uuid, date, jsonb, jsonb, jsonb) IS
  'F-1030: "Copy last week" in one transaction. Locks the week''s schedules row, raises 40001 unless the week''s shift ids are exactly the ones the caller read (so two copies at once cannot both land), then deletes the given ids and inserts the copy with this house and schedule. All or nothing.';

REVOKE ALL ON FUNCTION public.replace_week_shifts(uuid, uuid, date, jsonb, jsonb, jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.replace_week_shifts(uuid, uuid, date, jsonb, jsonb, jsonb) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.replace_week_shifts(uuid, uuid, date, jsonb, jsonb, jsonb) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.replace_week_shifts(uuid, uuid, date, jsonb, jsonb, jsonb) TO service_role';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'replace_week_shifts'
  ) THEN
    RAISE EXCEPTION 'replace_week_shifts was not created';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'replace_week_shifts' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'replace_week_shifts is SECURITY DEFINER; it must not be';
  END IF;
  RAISE NOTICE 'replace_week_shifts (invoker) in place; zero rows written';
END
$$;
