-- A calendar entry that moves is reminded again (QA round 4 B4).
--
-- WHAT WENT WRONG
-- ---------------
-- The reminder job keeps one dispatch row per (entry, person) and stamps
-- `calendar_events.reminder_sent = true` once everyone was served
-- (20260903101500_calendar_reminders_have_a_ledger.sql). Nothing cleared
-- either when the entry moved. A delivery on the 20th was reminded on the
-- 19th; the vendor moved it to the 28th, the manager dragged the entry, and
-- the 28th was never reminded: the row was no longer a candidate
-- (`reminder_sent = true`), and even with the flag cleared the unique
-- (entry, person) index ignored the new claim as a duplicate.
--
-- WHAT THIS DOES
-- --------------
-- 1. A reminder is one per (entry, person, instant). `due_at` joins the unique
--    key, so the claim for the new instant is a new row, and the claim for the
--    old instant still blocks a second send of the old one. The ledger keeps
--    its history: nothing is deleted, the old row still says what was sent.
-- 2. A BEFORE UPDATE trigger puts `reminder_sent` back to false whenever a
--    column that decides the reminder's instant changes: the start day, the
--    start time, all-day, or the days-before lead. It sits in the database so
--    every writer re-arms the same way (the API's PATCH, a drag on the month,
--    an agent moving a delivery date).
--
-- WHAT IT DOES NOT DO
-- -------------------
-- * A change to the title, the note, the status or the end day does not
--   re-arm: the instant did not move, and a second "tomorrow" ping for the
--   same instant is noise.
-- * Moving an entry back to an instant already reminded does not remind it
--   again: that (entry, person, instant) row already exists.
-- * Turning reminders off and on again does not re-arm a reminder that was
--   already sent for the same instant.
--
-- Idempotent. No explicit BEGIN/COMMIT: the Supabase CLI wraps each file.

-- ---------------------------------------------------------------------------
-- 1. One reminder per entry, per person, per instant.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_reminder_dispatch_event_user_due
  ON public.calendar_reminder_dispatches (calendar_event_id, user_id, due_at);

-- The old key is strictly narrower, so every existing row already satisfies
-- the new one. Dropped after the new one exists, so there is no instant with
-- no unique key at all.
DROP INDEX IF EXISTS public.uq_calendar_reminder_dispatch_event_user;

-- ---------------------------------------------------------------------------
-- 2. A moved instant puts the reminder back on the list.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rearm_calendar_reminder_on_move()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Both copies of each date and time are compared: a writer may set either
  -- one, and the date-sync trigger (sync_calendar_dates_trigger) may run
  -- before or after this one.
  IF NEW.start_date IS DISTINCT FROM OLD.start_date
     OR NEW.event_date IS DISTINCT FROM OLD.event_date
     OR NEW.start_time IS DISTINCT FROM OLD.start_time
     OR NEW.event_time IS DISTINCT FROM OLD.event_time
     OR NEW.all_day IS DISTINCT FROM OLD.all_day
     OR NEW.reminder_days_before IS DISTINCT FROM OLD.reminder_days_before
  THEN
    NEW.reminder_sent := false;
    NEW.reminder_sent_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.rearm_calendar_reminder_on_move() IS
  'Puts calendar_events.reminder_sent back to false when the reminder''s instant moves (start day or time, all-day, or the days-before lead). QA round 4 B4.';

DROP TRIGGER IF EXISTS rearm_calendar_reminder_on_move ON public.calendar_events;
CREATE TRIGGER rearm_calendar_reminder_on_move
  BEFORE UPDATE ON public.calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION public.rearm_calendar_reminder_on_move();
