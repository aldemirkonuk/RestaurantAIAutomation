-- Phase 30: Calendar schema fix
-- Fixes 3 calendar tables to match service CalendarEventRow + RecurrenceRuleRow interfaces
-- Uses IF EXISTS guards so the migration is safe to re-apply

BEGIN;

-- ============================================================================
-- TABLE: calendar_events
-- ============================================================================

-- Step 1: Rename notification_enabled → reminder_enabled (service uses reminder_enabled)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendar_events' AND column_name = 'notification_enabled'
  ) THEN
    ALTER TABLE calendar_events RENAME COLUMN notification_enabled TO reminder_enabled;
  END IF;
END $$;

-- Step 2: Add missing columns expected by CalendarEventRow interface
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS reminder_days_before INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_event_id UUID REFERENCES calendar_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS occurrence_date DATE,
  ADD COLUMN IF NOT EXISTS recurrence_rule_id UUID,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS color VARCHAR(7) DEFAULT NULL;

-- ============================================================================
-- TABLE: calendar_recurrence_rules
-- ============================================================================

-- Step 3: Rename event_id → calendar_event_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendar_recurrence_rules' AND column_name = 'event_id'
  ) THEN
    ALTER TABLE calendar_recurrence_rules RENAME COLUMN event_id TO calendar_event_id;
  END IF;
END $$;

-- Step 4: Rename end_date → end_on_date
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendar_recurrence_rules' AND column_name = 'end_date'
  ) THEN
    ALTER TABLE calendar_recurrence_rules RENAME COLUMN end_date TO end_on_date;
  END IF;
END $$;

-- Step 5: Rename max_occurrences → end_after_count
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendar_recurrence_rules' AND column_name = 'max_occurrences'
  ) THEN
    ALTER TABLE calendar_recurrence_rules RENAME COLUMN max_occurrences TO end_after_count;
  END IF;
END $$;

-- Step 6: Add missing columns to calendar_recurrence_rules
ALTER TABLE calendar_recurrence_rules
  ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS day_of_month INTEGER,
  ADD COLUMN IF NOT EXISTS week_of_month INTEGER,
  ADD COLUMN IF NOT EXISTS month_of_year INTEGER,
  ADD COLUMN IF NOT EXISTS end_type VARCHAR(20) DEFAULT 'never',
  ADD COLUMN IF NOT EXISTS last_generated_date DATE,
  ADD COLUMN IF NOT EXISTS next_generation_date DATE,
  ADD COLUMN IF NOT EXISTS generation_horizon_days INTEGER DEFAULT 90,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ============================================================================
-- TABLE: calendar_recurrence_exceptions
-- ============================================================================

-- Step 7: Rename recurrence_id → recurrence_rule_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendar_recurrence_exceptions' AND column_name = 'recurrence_id'
  ) THEN
    ALTER TABLE calendar_recurrence_exceptions RENAME COLUMN recurrence_id TO recurrence_rule_id;
  END IF;
END $$;

-- Step 8: Rename exception_date → original_date
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendar_recurrence_exceptions' AND column_name = 'exception_date'
  ) THEN
    ALTER TABLE calendar_recurrence_exceptions RENAME COLUMN exception_date TO original_date;
  END IF;
END $$;

-- ============================================================================
-- FUNCTION: generate_recurring_events
-- Called by calendar.service.ts generateOccurrences() — must exist to prevent 500 errors.
-- Stub implementation: returns 0 (frontend does client-side recurrence expansion).
-- Full implementation is in Plan 30-07 (this_and_future scope).
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_recurring_events(
  p_rule_id UUID,
  p_horizon_date DATE DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Phase 30 stub: returns 0.
  -- Frontend performs client-side recurrence expansion via expandAllRecurringEvents().
  -- Plan 30-07 implements full server-side generation for this_and_future scope.
  RETURN 0;
END;
$$;

COMMIT;
