-- A leaving person's shifts can go to someone named, in one transaction.
--
-- ADR 0215 item 27. The founder, 2026-09-28, verbatim:
--   Replacement: "'Replace with' picker"
--   Picker checks: "refuse overlap warn rest but owner has a say to change it
--   into warn all four to allow double booking"
--
-- When a person is removed from /team (`TeamService.deleteMember`), the
-- remover may name someone on the same roster to take their upcoming shifts
-- instead of the open pool. The gateway plans it (`planLeavingShifts`), runs
-- the four checks (`handoverChecks`: overlap, approved time off, role, the
-- 45-hour week) and prices each handed-over shift at the new person's wage;
-- this file only APPLIES that plan, all of it or none of it.
--
-- 1. `team_settings.allow_double_booking` (boolean, default false). The
--    owner's switch: off, a hand-over onto someone who already has a shift at
--    that time is REFUSED; on, it is only a warning. Put on `team_settings`
--    because that is where this house's team rules already live, one column
--    each (`labor_tracking_enabled`, `labor_target_pct`), owner-gated in the
--    gateway (`labourSettingsRefusal`, now `doubleBookingRefusal` too).
--
-- 2. `hand_over_leaving_shifts(...)`. In one transaction:
--    * the chosen person (`p_to`) must be on THIS house's roster and must not
--      be the person leaving, or it raises — the database's own check, not
--      only the gateway's;
--    * it applies `release_leaving_shifts` (migration 20261201130000) for the
--      shifts that open and the ones cut now, with every re-check it makes;
--    * each unstarted shift in `p_give` moves to `p_to` whole, re-checked
--      against what was read (the leaving person's, same date and start, not
--      open, not a call-out), keeping its state and type, at its new cost;
--    * the rest of each cut shift in `p_give_rests` (inserted open by step 2)
--      goes to `p_to`, with the cut shift's state and type, at its new cost;
--    * an overlap with another shift of `p_to` (theirs, not open, not a
--      call-out, wall-clock spans, overnight wrapping) raises unless the
--      house allows double booking AND the caller accepted it
--      (`p_accept_overlap`). Read here, in the transaction that writes, so a
--      shift added to them after the gateway's check is still caught.
--    Any raise rolls everything back: nothing is opened, cut, moved or added,
--    and the gateway refuses the removal before its first membership write.
--
-- SECURITY INVOKER (not DEFINER): the gateway calls it with the service role;
-- anon and authenticated may not call it at all.
--
-- ADDITIVE AND IDEMPOTENT. One column (default false, so every house keeps
-- refusing overlap), one function; no row is written by this file.

ALTER TABLE public.team_settings
  ADD COLUMN IF NOT EXISTS allow_double_booking boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.team_settings.allow_double_booking IS
  'ADR 0215 item 27 (founder 2026-09-28): owner only. false (default) = a "Replace with" hand-over onto someone who already has a shift at that time is refused; true = it is a warning the remover must accept (double booking allowed).';

CREATE OR REPLACE FUNCTION public.hand_over_leaving_shifts(
  p_restaurant_id    uuid,
  p_member_id        uuid,
  p_to               uuid,
  p_open             jsonb,
  p_split            jsonb,
  p_give             jsonb,
  p_give_rests       jsonb,
  p_accept_overlap   boolean
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  s          jsonb;
  r          jsonb;
  v_row      public.shifts%ROWTYPE;
  v_n        integer;
  v_given    integer := 0;
  v_rests_to integer := 0;
  v_rest_id  uuid;
  v_moved    uuid[] := '{}';
  v_allow    boolean;
  v_clash    uuid;
BEGIN
  IF p_restaurant_id IS NULL OR p_member_id IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'hand_over_leaving_shifts: a house, the person leaving and the person taking over are all required; nothing was changed';
  END IF;
  IF p_to = p_member_id THEN
    RAISE EXCEPTION 'hand_over_leaving_shifts: the person taking over is the person leaving; nothing was changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.team_members
     WHERE id = p_to AND restaurant_id = p_restaurant_id
  ) THEN
    RAISE EXCEPTION 'hand_over_leaving_shifts: the person taking over is not on this house''s roster; nothing was changed';
  END IF;
  IF jsonb_typeof(coalesce(p_give, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_give_rests, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'hand_over_leaving_shifts: the hand-over must be two arrays; nothing was changed';
  END IF;

  -- 1. Open and cut, exactly as a removal without a hand-over does.
  r := public.release_leaving_shifts(p_restaurant_id, p_member_id, p_open, p_split);

  -- 2. Unstarted shifts named for them move whole.
  FOR s IN SELECT value FROM jsonb_array_elements(coalesce(p_give, '[]'::jsonb)) LOOP
    UPDATE public.shifts
       SET member_id  = p_to,
           labor_cost = (s->>'labor_cost')::numeric,
           updated_at = now()
     WHERE id            = (s->>'id')::uuid
       AND restaurant_id = p_restaurant_id
       AND member_id     = p_member_id
       AND shift_date    = (s->>'shift_date')::date
       AND start_time    = s->>'start_time'
       AND state NOT IN ('open', 'callout');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'hand_over_leaving_shifts: shift % is not as it was read; nothing was changed', s->>'id';
    END IF;
    v_given := v_given + 1;
    v_moved := v_moved || (s->>'id')::uuid;
  END LOOP;

  -- 3. The rest of a shift cut now goes to them, as the shift it came from was.
  FOR s IN SELECT value FROM jsonb_array_elements(coalesce(p_give_rests, '[]'::jsonb)) LOOP
    SELECT (e->>'rest_id')::uuid INTO v_rest_id
      FROM jsonb_array_elements(r->'rests') e
     WHERE e->>'id' = s->>'id';
    IF v_rest_id IS NULL THEN
      RAISE EXCEPTION 'hand_over_leaving_shifts: shift % was not cut now; nothing was changed', s->>'id';
    END IF;
    SELECT * INTO v_row FROM public.shifts
     WHERE id = (s->>'id')::uuid AND restaurant_id = p_restaurant_id;
    UPDATE public.shifts
       SET member_id  = p_to,
           state      = v_row.state,
           shift_type = v_row.shift_type,
           labor_cost = (s->>'labor_cost')::numeric,
           updated_at = now()
     WHERE id = v_rest_id AND member_id IS NULL AND state = 'open';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'hand_over_leaving_shifts: the rest of shift % is not open; nothing was changed', s->>'id';
    END IF;
    v_rests_to := v_rests_to + 1;
    v_moved := v_moved || v_rest_id;
    v_rest_id := NULL;
  END LOOP;

  -- 4. Double booking: every moved row against every other shift of theirs.
  SELECT coalesce(ts.allow_double_booking, false) INTO v_allow
    FROM public.team_settings ts WHERE ts.restaurant_id = p_restaurant_id;
  v_allow := coalesce(v_allow, false);
  IF NOT (v_allow AND coalesce(p_accept_overlap, false)) THEN
    SELECT a.id INTO v_clash
      FROM public.shifts a
      JOIN public.shifts b
        ON b.restaurant_id = a.restaurant_id
       AND b.member_id     = p_to
       AND b.id           <> a.id
       AND b.state NOT IN ('open', 'callout')
     WHERE a.id = ANY (v_moved)
       AND (a.shift_date + a.start_time::time) <
           (b.shift_date + b.start_time::time)
             + CASE WHEN b.end_time::time < b.start_time::time
                    THEN interval '1 day' ELSE interval '0' END
             + (b.end_time::time - b.start_time::time)
       AND (b.shift_date + b.start_time::time) <
           (a.shift_date + a.start_time::time)
             + CASE WHEN a.end_time::time < a.start_time::time
                    THEN interval '1 day' ELSE interval '0' END
             + (a.end_time::time - a.start_time::time)
     LIMIT 1;
    IF v_clash IS NOT NULL THEN
      RAISE EXCEPTION 'hand_over_leaving_shifts: shift % overlaps another shift of the person taking over, and double booking is not allowed and accepted; nothing was changed', v_clash;
    END IF;
  END IF;

  RETURN r || jsonb_build_object('given', v_given, 'given_rests', v_rests_to);
END
$$;

COMMENT ON FUNCTION public.hand_over_leaving_shifts(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, boolean) IS
  'ADR 0215 item 27: a removal''s "Replace with" in one transaction — release_leaving_shifts for what opens and what is cut, then the named unstarted shifts and cut rests moved to a person on the same roster at their new cost. Raises (and changes nothing) on a stale row, a person not on the roster, or an overlap the owner has not allowed and the remover has not accepted.';

REVOKE ALL ON FUNCTION public.hand_over_leaving_shifts(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, boolean) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.hand_over_leaving_shifts(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, boolean) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.hand_over_leaving_shifts(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, boolean) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.hand_over_leaving_shifts(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, boolean) TO service_role';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'team_settings'
       AND column_name = 'allow_double_booking' AND is_nullable = 'NO'
       AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION 'team_settings.allow_double_booking is not in place (boolean, not null, default false)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'hand_over_leaving_shifts'
  ) THEN
    RAISE EXCEPTION 'hand_over_leaving_shifts was not created';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'hand_over_leaving_shifts' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'hand_over_leaving_shifts is SECURITY DEFINER; it must not be';
  END IF;
  RAISE NOTICE 'team_settings.allow_double_booking (default false) and hand_over_leaving_shifts (invoker) in place; zero rows written';
END
$$;
