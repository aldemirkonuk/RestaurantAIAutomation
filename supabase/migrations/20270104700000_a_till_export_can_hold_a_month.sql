-- a_till_export_can_hold_a_month — report_exports keeps a calendar month for
-- the till, so a month of the till can be written up (F-1013, export half).
--
-- WHAT WAS WRONG
-- --------------
-- The till reads one calendar month (GoalsService.getPosRevenueWindow, its
-- `month` branch, F-128), and the /reports sheet offers it. The export shelf
-- refused it in words, because report_exports keeps the till's window as
-- window_days only (20260917010200_a_report_export_is_written_or_says_why_not
-- .sql, the table's CREATE). An export re-reads its register later (a retry,
-- the queue), so the window has to live on the row, and a month is not a
-- number of days: "the last 31 days" read on 3 August is not July.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Adds window_month: the month as YYYY-MM on the house's own calendar (the
-- same house days the till files each check on, ADR 0296). NULL for every
-- export that is not a month of the till. Two checks:
--   - the shape: a year and a month 01-12, nothing else;
--   - one window or the other: a row never holds both a day count and a
--     month, so an export cannot be read two ways.
-- Which cutting may hold a month is the gateway's to say, as it is for
-- window_days (the catalogue lives in source; see the table's cutting note).
--
-- Additive and idempotent: no row is written, every existing row has a NULL
-- month and so passes both checks, no policy or grant changes (the table is
-- already gateway-only, OD-72 / OD-73).
SET local statement_timeout = '120s';

ALTER TABLE public.report_exports
  ADD COLUMN IF NOT EXISTS window_month text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'report_exports_window_month_is_a_month'
       AND conrelid = 'public.report_exports'::regclass
  ) THEN
    ALTER TABLE public.report_exports
      ADD CONSTRAINT report_exports_window_month_is_a_month
      CHECK (window_month IS NULL OR window_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'report_exports_one_window'
       AND conrelid = 'public.report_exports'::regclass
  ) THEN
    ALTER TABLE public.report_exports
      ADD CONSTRAINT report_exports_one_window
      CHECK (window_days IS NULL OR window_month IS NULL);
  END IF;
END $$;

COMMENT ON COLUMN public.report_exports.window_month IS
  'The calendar month the till export reads, YYYY-MM on the house''s own calendar (its house days, ADR 0296): the first house day to the last, or to the house''s today while the month runs. NULL for every other export. Never set together with window_days (F-1013).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'report_exports'
       AND column_name = 'window_month'
  ) THEN
    RAISE EXCEPTION 'report_exports.window_month is missing';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.report_exports'::regclass
         AND contype = 'c'
         AND conname IN ('report_exports_window_month_is_a_month', 'report_exports_one_window')) <> 2 THEN
    RAISE EXCEPTION 'report_exports is missing its window_month checks';
  END IF;
END $$;
