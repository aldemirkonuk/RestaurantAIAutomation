-- F-1544 lane 5: a count files in its session's period.
--
-- The founder's pick, 2026-10-12 (sim-ledger S224), F1 (b): a count session
-- states its period, and the month close files the session's counts by it,
-- only for counts made within 6 hours after the period ends. The moment each
-- count was made stays honest: stock_counts.counted_at is never moved. Only
-- the month the close files the count in follows the session.
--
-- What this migration adds, and nothing else:
--   1. stock_count_sessions.attributed_period (text, YYYY-MM): the month the
--      session's counts are filed in. NULL for an opening count (it starts
--      the books and is never a month's variance, ADR 0335 §2) and for every
--      session opened before this migration -- their counts keep being filed
--      by their own moment, exactly as before. No back-fill.
--   2. Checks: a real month; none on an opening count; within a day of the
--      moment it was opened (any house's clock, plus the 6 hours, is inside
--      a day of UTC -- the gateway holds the exact rule: this month, or last
--      month only within 6 hours after it ended, on the house's clock).
--   3. The period is kept: stock_count_sessions_ended_stays_ended (lane 1)
--      also refuses a change to it. Moving a session's period after its
--      counts were filed would move them between months behind the close.
--
-- Who files by it: the gateway's month close (month-close.service.ts, via
-- count-period.ts `filedMonth`). record_stock_count is NOT touched: the one
-- count writer (ADR 0078) records the counted moment as it always has.
--
-- The table is already locked down (lane 1: RLS on, service role only,
-- anon/authenticated revoked); a new column inherits that.
--
-- NOT APPLIED BY HAND. The Supabase GitHub integration applies migrations on
-- merge, keyed by this filename.

BEGIN;

SET LOCAL statement_timeout = '120s';

ALTER TABLE public.stock_count_sessions
  ADD COLUMN IF NOT EXISTS attributed_period text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'stock_count_sessions_period_is_a_month'
       AND conrelid = to_regclass('public.stock_count_sessions')
  ) THEN
    ALTER TABLE public.stock_count_sessions
      ADD CONSTRAINT stock_count_sessions_period_is_a_month
      CHECK (attributed_period IS NULL OR attributed_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'stock_count_sessions_opening_has_no_period'
       AND conrelid = to_regclass('public.stock_count_sessions')
  ) THEN
    ALTER TABLE public.stock_count_sessions
      ADD CONSTRAINT stock_count_sessions_opening_has_no_period
      CHECK (kind <> 'opening' OR attributed_period IS NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'stock_count_sessions_period_near_its_opening'
       AND conrelid = to_regclass('public.stock_count_sessions')
  ) THEN
    ALTER TABLE public.stock_count_sessions
      ADD CONSTRAINT stock_count_sessions_period_near_its_opening
      CHECK (
        attributed_period IS NULL
        OR attributed_period BETWEEN
             to_char((opened_at AT TIME ZONE 'UTC') - interval '1 day', 'YYYY-MM')
         AND to_char((opened_at AT TIME ZONE 'UTC') + interval '1 day', 'YYYY-MM')
      );
  END IF;
END
$$;

-- Lane 1's guard, with the period added to what a session keeps.
CREATE OR REPLACE FUNCTION public.stock_count_sessions_ended_stays_ended()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status <> 'open' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'This count has ended (%), so it cannot become %.', OLD.status, NEW.status
      USING ERRCODE = '22023';
  END IF;
  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
    RAISE EXCEPTION 'A count keeps its house, its kind and the moment it was opened.'
      USING ERRCODE = '22023';
  END IF;
  -- F-1544 lane 5: the month its counts are filed in is set when it opens.
  IF NEW.attributed_period IS DISTINCT FROM OLD.attributed_period THEN
    RAISE EXCEPTION 'A count keeps the month it was opened for.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.stock_count_sessions.attributed_period IS
  'F-1544 lane 5 (founder 2026-10-12 S224, F1 b): the month (YYYY-MM) this count''s lines are filed in by the month close, for lines made from the start of that month until 6 hours after it ends on the house''s clock; any other line is filed by its own counted_at. NULL for an opening count and for sessions opened before 20270113300000 (filed by counted_at, as before). Set when opened; never changed.';

-- ---------------------------------------------------------------------------
-- In-file assertions (structural only; catalog, never a live table).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'record_stock_count') <> 1 THEN
    RAISE EXCEPTION 'filing a count by its session must not add a second count writer (ADR 0078)';
  END IF;
  IF position('attributed_period' in pg_get_functiondef(
       'public.stock_count_sessions_ended_stays_ended()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'a count session must keep the month it was opened for';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'stock_count_sessions') THEN
    RAISE EXCEPTION 'stock_count_sessions must keep RLS on';
  END IF;
END;
$$;

COMMIT;
