-- Adds start_date / end_date / start_time / end_time columns to calendar_events
-- so that calendar.service.ts (which uses these names) can work alongside older
-- services that still reference event_date / event_date_end / event_time.
-- A BEFORE INSERT OR UPDATE trigger keeps both sets of columns in sync.

ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date   DATE,
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS end_time   TIME;

-- Back-fill new columns from existing ones
UPDATE calendar_events
SET
  start_date = event_date,
  end_date   = event_date_end,
  start_time = event_time
WHERE start_date IS NULL;

-- Trigger function: keep old ↔ new column pairs in sync
CREATE OR REPLACE FUNCTION sync_calendar_event_date_columns()
RETURNS TRIGGER AS $$
BEGIN
  -- start_date ↔ event_date
  IF NEW.start_date IS NOT NULL AND (OLD IS NULL OR OLD.start_date IS DISTINCT FROM NEW.start_date) THEN
    NEW.event_date := NEW.start_date;
  ELSIF NEW.event_date IS NOT NULL AND (OLD IS NULL OR OLD.event_date IS DISTINCT FROM NEW.event_date) THEN
    NEW.start_date := NEW.event_date;
  END IF;

  -- end_date ↔ event_date_end
  IF NEW.end_date IS NOT NULL THEN
    NEW.event_date_end := NEW.end_date;
  ELSIF NEW.event_date_end IS NOT NULL AND NEW.end_date IS NULL THEN
    NEW.end_date := NEW.event_date_end;
  END IF;

  -- start_time ↔ event_time
  IF NEW.start_time IS NOT NULL THEN
    NEW.event_time := NEW.start_time;
  ELSIF NEW.event_time IS NOT NULL AND NEW.start_time IS NULL THEN
    NEW.start_time := NEW.event_time;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_calendar_dates_trigger ON calendar_events;
CREATE TRIGGER sync_calendar_dates_trigger
  BEFORE INSERT OR UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION sync_calendar_event_date_columns();
