-- Phase 30: Add calendar iCal token to restaurants
-- Token is 64-char hex (32 random bytes), used as auth for the public iCal feed endpoint.
-- Null by default — generated on first request to GET /calendar/ical-token.

BEGIN;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS calendar_ical_token VARCHAR(64) DEFAULT NULL;

-- Index for fast token lookup in the public feed endpoint
CREATE INDEX IF NOT EXISTS idx_restaurants_calendar_ical_token
  ON restaurants (calendar_ical_token)
  WHERE calendar_ical_token IS NOT NULL;

COMMIT;
