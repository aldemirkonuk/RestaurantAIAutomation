-- A shift over four hours has a break: recorded by whoever edits the shift, or
-- assumed at the Labour Law minimum and shown as assumed. ADR 0215.
--
-- THE FOUNDER, 2026-09-21, picked "Take all five" -- the options he picked, of
-- which this is the first: a shift over 4 h with no break recorded assumes the
-- Labour Law 4857 Art. 68 minimum, shown as "assumed break", editable by
-- whoever edits the shift.
--
-- Art. 68 (a)-(c), keyed on WORKING time (a break is not working time, Art. 68
-- last sentence): 4 hours or less, 15 minutes; over 4 hours up to and
-- including 7.5 hours, 30 minutes; over 7.5 hours, one hour. The assumption
-- itself is computed where every figure is made (`pay-rules.ts`, mirrored in
-- `tm-format.ts`); THIS file only gives the shift somewhere to hold the break
-- its editor records, so that the record and the re-priced cost are written in
-- one UPDATE and commit or fail together.
--
-- `recorded_break_min`:
--   NULL  nothing recorded: a shift over 4 hours is counted with the Art. 68
--         minimum and says "assumed break";
--   0     recorded as no break taken: the whole span is worked;
--   n     recorded as n minutes.
-- It is not `shift_breaks`: that baseline table holds planned breaks with a
-- start time and a cover, and no product path writes it. When both are
-- present, the editor's recorded minutes are the latest word and win.
--
-- ADDITIVE AND IDEMPOTENT. One nullable column, one CHECK. No row written.
SET local statement_timeout = '120s';

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS recorded_break_min INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'shifts_recorded_break_min_in_a_day'
       AND conrelid = 'public.shifts'::regclass
  ) THEN
    ALTER TABLE public.shifts
      ADD CONSTRAINT shifts_recorded_break_min_in_a_day
      CHECK (recorded_break_min IS NULL
             OR (recorded_break_min >= 0 AND recorded_break_min < 1440));
  END IF;
END
$$;

COMMENT ON COLUMN public.shifts.recorded_break_min IS
  'The break recorded for this shift by whoever edits it, in minutes (ADR 0215). NULL = nothing recorded: a shift over 4 hours is then counted with the Labour Law 4857 Art. 68 minimum and shown as an assumed break. 0 = recorded as no break taken. Wins over shift_breaks (planned breaks, not written by any product path) when both are present.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'shifts'
       AND column_name = 'recorded_break_min' AND is_nullable = 'YES'
       AND column_default IS NULL
  ) THEN
    RAISE EXCEPTION 'shifts.recorded_break_min is missing, NOT NULL, or defaulted; it must be NULL when nothing is recorded';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'shifts_recorded_break_min_in_a_day'
  ) THEN
    RAISE EXCEPTION 'shifts_recorded_break_min_in_a_day was not created';
  END IF;
  RAISE NOTICE 'shifts.recorded_break_min is in place, NULL on every existing row; 0 rows written.';
END
$$;
