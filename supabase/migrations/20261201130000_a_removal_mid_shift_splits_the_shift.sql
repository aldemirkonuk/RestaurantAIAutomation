-- A removal mid-shift splits the shift, in one transaction.
--
-- ADR 0215 item 26. The founder, 2026-09-28, verbatim: "handle it sota, it
-- also has to take care of yhat exact edge case where it opens midahift then
-- everything changes accordingly".
--
-- When a person is removed from /team (`TeamService.deleteMember`), their
-- shifts not started yet go back to the open pool whole (founder item 93),
-- and a shift IN PROGRESS is cut at the removal minute: the worked part keeps
-- the row, with a new end, break and cost; the rest becomes a NEW open shift
-- with the same role and note and nobody on it. The gateway decides which
-- row gets what (`pay-rules.ts` `planLeavingShifts`, unit-tested); this
-- function only APPLIES that plan, all of it or none of it:
--
--   * every row is re-checked against what the gateway read (same person,
--     same date and times, not open, not a call-out). A row that changed
--     since, or is gone, raises, and the whole call rolls back — no shift is
--     opened, cut or added, and the gateway refuses the removal ("nobody was
--     removed"), before its first membership write;
--   * a cut must be internally consistent (the rest starts where the worked
--     part ends and ends where the shift ended), or it raises;
--   * the rest takes the week row of its own date: the shift's own when the
--     cut stays in the same Monday-week, else that week's `schedules` row if
--     there is one, else none (an overnight Sunday shift cut after midnight).
--
-- Before this the gateway wrote with one PostgREST UPDATE, which is atomic
-- for "open" alone but cannot also cut one row and insert another. Two or
-- three separate writes would let a failure land half a removal.
--
-- SECURITY INVOKER (not DEFINER): the gateway calls it with the service role;
-- anon and authenticated may not call it at all.
--
-- ADDITIVE. One function; no table, column or row is written by this file.

CREATE OR REPLACE FUNCTION public.release_leaving_shifts(
  p_restaurant_id uuid,
  p_member_id     uuid,
  p_open          jsonb,
  p_split         jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  s          jsonb;
  v_row      public.shifts%ROWTYPE;
  v_n        integer;
  v_opened   integer := 0;
  v_split    integer := 0;
  v_rests    jsonb := '[]'::jsonb;
  v_rest_id  uuid;
  v_rest_day date;
  v_schedule uuid;
BEGIN
  IF p_restaurant_id IS NULL OR p_member_id IS NULL THEN
    RAISE EXCEPTION 'release_leaving_shifts: a house and a person are both required; nothing was changed';
  END IF;
  IF jsonb_typeof(coalesce(p_open, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_split, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'release_leaving_shifts: the plan must be two arrays; nothing was changed';
  END IF;

  -- 1. Not started: open, whole.
  FOR s IN SELECT value FROM jsonb_array_elements(coalesce(p_open, '[]'::jsonb)) LOOP
    UPDATE public.shifts
       SET member_id  = NULL,
           state      = 'open',
           shift_type = 'open',
           labor_cost = NULL,
           updated_at = now()
     WHERE id            = (s->>'id')::uuid
       AND restaurant_id = p_restaurant_id
       AND member_id     = p_member_id
       AND shift_date    = (s->>'shift_date')::date
       AND start_time    = s->>'start_time'
       AND state NOT IN ('open', 'callout');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'release_leaving_shifts: shift % is not as it was read; nothing was changed', s->>'id';
    END IF;
    v_opened := v_opened + 1;
  END LOOP;

  -- 2. In progress: cut at the removal minute; the rest is a new open shift.
  FOR s IN SELECT value FROM jsonb_array_elements(coalesce(p_split, '[]'::jsonb)) LOOP
    IF s#>>'{rest,start_time}' IS DISTINCT FROM s#>>'{worked,end_time}'
       OR s#>>'{rest,end_time}' IS DISTINCT FROM s#>>'{was,end_time}' THEN
      RAISE EXCEPTION 'release_leaving_shifts: the cut of shift % does not add up; nothing was changed', s->>'id';
    END IF;

    SELECT * INTO v_row
      FROM public.shifts
     WHERE id            = (s->>'id')::uuid
       AND restaurant_id = p_restaurant_id
       AND member_id     = p_member_id
       AND shift_date    = (s#>>'{was,shift_date}')::date
       AND start_time    = s#>>'{was,start_time}'
       AND end_time      = s#>>'{was,end_time}'
       AND state NOT IN ('open', 'callout')
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'release_leaving_shifts: shift % is not as it was read; nothing was changed', s->>'id';
    END IF;

    UPDATE public.shifts
       SET end_time           = s#>>'{worked,end_time}',
           recorded_break_min = (s#>>'{worked,recorded_break_min}')::integer,
           labor_cost         = (s#>>'{worked,labor_cost}')::numeric,
           updated_at         = now()
     WHERE id = v_row.id;

    v_rest_day := (s#>>'{rest,shift_date}')::date;
    IF date_trunc('week', v_rest_day) = date_trunc('week', v_row.shift_date) THEN
      v_schedule := v_row.schedule_id;
    ELSE
      SELECT id INTO v_schedule
        FROM public.schedules
       WHERE restaurant_id = p_restaurant_id
         AND week_start    = date_trunc('week', v_rest_day)::date
       LIMIT 1;
      IF NOT FOUND THEN v_schedule := NULL; END IF;
    END IF;

    INSERT INTO public.shifts
      (restaurant_id, schedule_id, member_id, shift_date, start_time, end_time,
       role, shift_type, state, note, labor_cost, recorded_break_min)
    VALUES
      (p_restaurant_id, v_schedule, NULL, v_rest_day,
       s#>>'{rest,start_time}', s#>>'{rest,end_time}',
       v_row.role, 'open', 'open', v_row.note, NULL,
       (s#>>'{rest,recorded_break_min}')::integer)
    RETURNING id INTO v_rest_id;

    v_split := v_split + 1;
    v_rests := v_rests || jsonb_build_array(
      jsonb_build_object('id', v_row.id, 'rest_id', v_rest_id));
  END LOOP;

  RETURN jsonb_build_object('opened', v_opened, 'split', v_split, 'rests', v_rests);
END
$$;

COMMENT ON FUNCTION public.release_leaving_shifts(uuid, uuid, jsonb, jsonb) IS
  'ADR 0215 item 26: applies TeamService.deleteMember''s plan for a leaving person''s shifts in one transaction — unstarted ones opened whole, an in-progress one cut at the removal minute with the rest inserted as a new open shift. Every row is re-checked against what was read; any mismatch raises and nothing is changed.';

REVOKE ALL ON FUNCTION public.release_leaving_shifts(uuid, uuid, jsonb, jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.release_leaving_shifts(uuid, uuid, jsonb, jsonb) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.release_leaving_shifts(uuid, uuid, jsonb, jsonb) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.release_leaving_shifts(uuid, uuid, jsonb, jsonb) TO service_role';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'release_leaving_shifts'
  ) THEN
    RAISE EXCEPTION 'release_leaving_shifts was not created';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'release_leaving_shifts' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'release_leaving_shifts is SECURITY DEFINER; it must not be';
  END IF;
  RAISE NOTICE 'release_leaving_shifts (invoker) in place; zero rows written';
END
$$;
