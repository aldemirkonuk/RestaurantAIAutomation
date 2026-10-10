-- a_day_off_ends_on_or_after_it_starts — time_off_requests refuses a last day
-- before the first (F-923, database half).
--
-- WHAT WAS WRONG
-- --------------
-- time_off_requests has start_date and end_date, both date NOT NULL, and no
-- check between them (20260805000000_baseline_from_production.sql, the
-- table's CREATE). The gateway now refuses a reversed range
-- (TeamService.createTimeOff, F-923), but any writer that goes straight to
-- the database stored one as sent: a request no manager can approve and no
-- schedule can read.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Adds CHECK (start_date <= end_date). A one-day request (start = end) is
-- allowed. A first day in the past is allowed: sick leave is often filed
-- after the day (coordinator call 2026-10-10, see
-- .planning/tech-debt.d/2026-10-10-fix-sim-w66-timeoff-rule.md).
--
-- WHY NOT VALID, THEN VALIDATE ONLY WHEN CLEAN
-- --------------------------------------------
-- Reversed rows may already exist: until the gateway rule landed, createTimeOff
-- inserted whatever dates it was sent. Nobody has counted production (no
-- production read was made for this change). So the constraint is added NOT
-- VALID, which refuses every new or updated reversed row at once, and is
-- VALIDATEd only when no reversed row exists. If some do, they are left as
-- they are and counted in a NOTICE: swapping the two dates would guess which
-- one was mistyped, and that is the house's to say, not this migration's.
-- A later VALIDATE, once those rows are put right, needs no new code.
--
-- Additive and idempotent: no row is written, no policy or grant changes.
SET local statement_timeout = '120s';

DO $$
DECLARE
  reversed bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'time_off_requests_ends_on_or_after_start'
       AND conrelid = 'public.time_off_requests'::regclass
  ) THEN
    ALTER TABLE public.time_off_requests
      ADD CONSTRAINT time_off_requests_ends_on_or_after_start
      CHECK (start_date <= end_date) NOT VALID;
  END IF;

  SELECT count(*) INTO reversed
    FROM public.time_off_requests
   WHERE end_date < start_date;

  IF reversed = 0 THEN
    ALTER TABLE public.time_off_requests
      VALIDATE CONSTRAINT time_off_requests_ends_on_or_after_start;
  ELSE
    RAISE NOTICE 'time_off_requests: % row(s) end before they start; kept as they are, constraint left NOT VALID (new writes are still refused)', reversed;
  END IF;
END $$;

COMMENT ON CONSTRAINT time_off_requests_ends_on_or_after_start ON public.time_off_requests IS
  'A day off ends on or after the day it starts (F-923). Past first days are allowed (sick leave filed after the day). Added NOT VALID and validated only when no reversed row existed; reversed rows from before it are kept, never swapped.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'time_off_requests_ends_on_or_after_start'
       AND conrelid = 'public.time_off_requests'::regclass
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'time_off_requests_ends_on_or_after_start is missing';
  END IF;
END $$;
