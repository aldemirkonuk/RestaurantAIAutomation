-- A calendar entry keeps what it was told: a cleared time stays cleared, and a
-- moved entry is reminded again for its new date (F-196, F-606, F-605).
--
-- WHAT WAS WRONG
-- --------------
-- F-196 (reopened, wave 19). `sync_calendar_event_date_columns()` (baseline)
--   keeps two legacy twins in step: start_time/event_time and
--   end_date/event_date_end. When the gateway cleared `start_time` or
--   `end_date` (null, as the sheet now sends), the function saw the old twin
--   still set and copied it straight back. "Clear the start time" saved, the
--   sheet closed, and the 18:00 was still there. PGlite proof with the
--   baseline function: p4-scratch/pglite-probe/cal-trigger-probe-w19.mjs.
--
-- F-606. A reminder dispatch was unique on (calendar_event_id, user_id) for
--   ever, and nothing ever reset `reminder_sent`. A delivery reminded for
--   Tuesday and then moved to Friday was never reminded for Friday: the row was
--   no longer a candidate, and even if it had been, the claim would collide with
--   Tuesday's.
--
-- F-605. A repeating entry is one stored row, so the same key allowed it one
--   reminder in its life, on its first date.
--
-- WHAT THIS DOES
-- --------------
-- 1. The twin sync honours an explicit clear: on UPDATE, a column of a pair
--    that goes from a value to NULL while its twin is left as it was takes the
--    twin with it. Every other path (insert, a write of either column, a write
--    of both) behaves exactly as before, so the order-follows trigger
--    (20261218150000), which writes both of each pair, is unchanged.
-- 2. Moving an entry (its date, its start time, or all day) re-arms its
--    reminder: `reminder_sent` goes back to false. A BEFORE UPDATE trigger, so
--    it holds for the sheet, a drag on the grid and the order-follows trigger
--    alike, not only for the gateway's update route.
-- 3. The dispatch key becomes (calendar_event_id, user_id, due_at). A send is
--    still claimed before it is made and two sweeps still cannot both win it;
--    what changed is that a different due time is a different reminder. That
--    is what lets the moved entry, and each date of a repeating entry, be
--    reminded once each.
--
-- Additive in effect: no table, no column, no row rewritten. The new index is
-- created before the old one is dropped, so the table is never without a
-- uniqueness guard.

CREATE OR REPLACE FUNCTION public.sync_calendar_event_date_columns() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- start_date ↔ event_date (unchanged from the baseline)
  IF NEW.start_date IS NOT NULL AND (OLD IS NULL OR OLD.start_date IS DISTINCT FROM NEW.start_date) THEN
    NEW.event_date := NEW.start_date;
  ELSIF NEW.event_date IS NOT NULL AND (OLD IS NULL OR OLD.event_date IS DISTINCT FROM NEW.event_date) THEN
    NEW.start_date := NEW.event_date;
  END IF;

  -- end_date ↔ event_date_end. A clear of one twin, with the other left as it
  -- was, is a clear of both (F-196). Otherwise the set column wins.
  IF TG_OP = 'UPDATE' AND NEW.end_date IS NULL AND OLD.end_date IS NOT NULL
     AND NEW.event_date_end IS NOT DISTINCT FROM OLD.event_date_end THEN
    NEW.event_date_end := NULL;
  ELSIF TG_OP = 'UPDATE' AND NEW.event_date_end IS NULL AND OLD.event_date_end IS NOT NULL
     AND NEW.end_date IS NOT DISTINCT FROM OLD.end_date THEN
    NEW.end_date := NULL;
  ELSIF NEW.end_date IS NOT NULL THEN
    NEW.event_date_end := NEW.end_date;
  ELSIF NEW.event_date_end IS NOT NULL THEN
    NEW.end_date := NEW.event_date_end;
  END IF;

  -- start_time ↔ event_time, the same rule.
  IF TG_OP = 'UPDATE' AND NEW.start_time IS NULL AND OLD.start_time IS NOT NULL
     AND NEW.event_time IS NOT DISTINCT FROM OLD.event_time THEN
    NEW.event_time := NULL;
  ELSIF TG_OP = 'UPDATE' AND NEW.event_time IS NULL AND OLD.event_time IS NOT NULL
     AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time THEN
    NEW.start_time := NULL;
  ELSIF NEW.start_time IS NOT NULL THEN
    NEW.event_time := NEW.start_time;
  ELSIF NEW.event_time IS NOT NULL THEN
    NEW.start_time := NEW.event_time;
  END IF;

  RETURN NEW;
END;
$$;

-- A moved entry is reminded again (F-606). Compared column by column, both
-- twins, so the result does not depend on which trigger fires first. The
-- sweep's own stamp writes only reminder_sent / reminder_sent_at and never
-- moves a date, so it cannot undo itself here.
CREATE OR REPLACE FUNCTION public.calendar_event_move_rearms_reminder() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.reminder_sent IS TRUE
     AND (NEW.start_date IS DISTINCT FROM OLD.start_date
       OR NEW.event_date IS DISTINCT FROM OLD.event_date
       OR NEW.start_time IS DISTINCT FROM OLD.start_time
       OR NEW.event_time IS DISTINCT FROM OLD.event_time
       OR NEW.all_day IS DISTINCT FROM OLD.all_day) THEN
    NEW.reminder_sent := false;
    NEW.reminder_sent_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calendar_event_move_rearms_reminder ON public.calendar_events;
CREATE TRIGGER calendar_event_move_rearms_reminder
  BEFORE UPDATE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.calendar_event_move_rearms_reminder();

-- One reminder per person per due time (F-606, F-605).
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_reminder_dispatch_event_user_due
  ON public.calendar_reminder_dispatches (calendar_event_id, user_id, due_at);
DROP INDEX IF EXISTS public.uq_calendar_reminder_dispatch_event_user;

COMMENT ON TABLE public.calendar_reminder_dispatches IS
  'One calendar reminder, one person, one due time. The UNIQUE index on (calendar_event_id, user_id, due_at) is the idempotency key: the sweep claims the row before it sends, so two gateway instances cannot both send. A moved entry, or another date of a repeating entry, has a different due_at and is a different reminder. sent_at NULL with outcome NULL means claimed-but-unconfirmed (a crash), and is reported as such rather than counted as delivered. RLS on, service_role only.';

-- Assert the outcome rather than reporting success.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'calendar_reminder_dispatches'
      AND indexname = 'uq_calendar_reminder_dispatch_event_user_due'
  ) THEN
    RAISE EXCEPTION 'the (calendar_event_id, user_id, due_at) unique index is missing — nothing prevents a double send';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_calendar_reminder_dispatch_event_user'
  ) THEN
    RAISE EXCEPTION 'the old (calendar_event_id, user_id) key is still there — a moved entry would never be reminded again';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.calendar_events'::regclass
      AND tgname = 'calendar_event_move_rearms_reminder'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'calendar_event_move_rearms_reminder is not attached to calendar_events';
  END IF;
END
$$;
