-- Calendar Event Types table
-- Allows restaurants to create custom event type definitions with colors and icons

CREATE TABLE IF NOT EXISTS calendar_event_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  icon TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_types_restaurant
  ON calendar_event_types(restaurant_id);

ALTER TABLE calendar_event_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their restaurant event types"
  ON calendar_event_types
  FOR ALL
  USING (true)
  WITH CHECK (true);
