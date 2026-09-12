-- weather_readings — a published forecast, kept with whose it is and when it
-- was issued.
--
-- WHY THIS TABLE, AND WHY IT KEEPS EVERYTHING
-- -------------------------------------------
-- DESIGN-FOUNDATION.md §6 forbids "weather-driven forecasting on the grid — a
-- guess on a page whose virtue is that everything is a fact". ADR 0111 §2 keeps
-- that veto and answers it with one distinction: a published meteorological
-- forecast, ATTRIBUTED TO ITS ISSUER AND ITS ISSUE TIME, is a citable
-- observation about the future; our covers number derived from it and drawn
-- without its error is the guess. Every column here exists to hold up the first
-- half of that sentence.
--
-- So the table does not cache. A cache keeps the newest answer and forgets the
-- rest, and forgetting the rest is exactly what makes a forecast unscoreable.
-- Each distinct issuance is its own row: `(restaurant_id, business_date,
-- issued_at)` is the key, so re-reading the same issuance is idempotent and a
-- NEW issuance for the same day is a NEW row sitting beside the old one. That
-- is what lets slice 3 ask the only question that matters — "what was said
-- BEFORE the day, and how did it land" — and it is the first thing in this
-- product that would ever fill `prediction_outcomes` (ADR 0048 Lane A, a table
-- migrated long ago and written by nothing).
--
-- THE UNIT IS THE ISSUER'S OWN
-- ----------------------------
-- `temperature_unit` is stored, not normalised away. NWS publishes Fahrenheit
-- for US locations; a European issuer publishes Celsius. Converting on write
-- would mean the number in the row is ours rather than the meteorologist's, and
-- the whole design rests on the row holding a number somebody else published.
-- The gateway offers the conversion on read; the column keeps the original.
--
-- WHAT IS NULLABLE, AND WHY THAT IS LOAD-BEARING
-- ----------------------------------------------
-- `precipitation_probability` and `precipitation_amount_mm` are nullable and
-- are NOT defaulted to zero. NWS's `/gridpoints/.../forecast` carries a
-- probability of precipitation on most periods and no quantitative amount at
-- all, so a `DEFAULT 0` here would publish "no rain expected" for every day of
-- every forecast — the absence-reported-as-health fault in a numeric column,
-- drawn on a grid as a flat bar. NULL means "the issuer did not publish this",
-- and the page renders that difference.
--
-- `latitude` / `longitude` are stored ON THE READING rather than joined from
-- `restaurants`, because a house that corrects its address must not silently
-- re-attribute forecasts that were made for the old point.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.weather_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- Who published it. Free text on purpose: the provider interface admits NWS,
  -- Open-Meteo and OpenWeather, and a CHECK constraint here would have to be
  -- migrated every time a house appears outside the current issuer's coverage.
  issuer VARCHAR(80) NOT NULL CHECK (btrim(issuer) <> ''),

  -- Which office/grid, station or model answered — the issuer's own sub-identity,
  -- e.g. NWS "MTR/91,127". NULL when the issuer publishes no such handle.
  issuer_detail VARCHAR(120),

  -- When the ISSUER says the forecast was made. Not when we fetched it: those
  -- are different facts and conflating them is how a four-hour-old forecast
  -- reads as fresh.
  issued_at TIMESTAMPTZ NOT NULL,

  -- When we asked. Kept separately so a stale reading can state its own age.
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The window this row describes, and the local calendar day it belongs to.
  -- `business_date` is what the calendar grid joins on; the timestamps are what
  -- a finer magnification would need.
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to   TIMESTAMPTZ NOT NULL,
  business_date DATE NOT NULL,

  -- The point the reading was ASKED FOR. See the header.
  latitude  DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,

  -- The issuer's own numbers, in the issuer's own unit.
  temperature_high NUMERIC(6, 2),
  temperature_low  NUMERIC(6, 2),
  temperature_unit CHAR(1) NOT NULL CHECK (temperature_unit IN ('C', 'F')),

  -- Percent. NULL where the issuer published none — never 0.
  precipitation_probability SMALLINT
    CHECK (precipitation_probability BETWEEN 0 AND 100),

  -- Millimetres. NULL where the issuer published no quantitative amount, which
  -- is every NWS period today.
  precipitation_amount_mm NUMERIC(6, 2),

  -- The issuer's own wind phrasing ("10 to 15 mph"), kept verbatim rather than
  -- parsed into a number we would then have to defend.
  wind_summary VARCHAR(120),

  -- The issuer's own words for the day ("Partly Sunny then Slight Chance
  -- Rain Showers"). The page's icon is chosen from this, and the words stay
  -- available so the choice can be checked.
  short_forecast VARCHAR(200),

  -- sha256 of the issuer's raw payload for this period. Two purposes: an
  -- unchanged re-issue is detectable without diffing every column, and a row
  -- can be traced back to the exact bytes that produced it.
  raw_hash CHAR(64) NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT weather_readings_window_ordered CHECK (valid_to > valid_from)
);

-- The grid's read: this house, this window of days, newest issuance first.
CREATE INDEX IF NOT EXISTS idx_weather_readings_restaurant_date
  ON public.weather_readings (restaurant_id, business_date, issued_at DESC);

-- One row per issuance per day. An upsert binds ON CONFLICT to this, so it is
-- deliberately NOT partial.
CREATE UNIQUE INDEX IF NOT EXISTS uq_weather_readings_issuance
  ON public.weather_readings (restaurant_id, business_date, issued_at);

-- ---------------------------------------------------------------------------
-- 2. Lock it down in the SAME migration that creates it (OD-72 / OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.weather_readings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS weather_readings_service_role ON public.weather_readings;
CREATE POLICY weather_readings_service_role
  ON public.weather_readings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.weather_readings FROM anon, authenticated;

COMMENT ON TABLE public.weather_readings IS
  'Published weather forecasts for one restaurant''s coordinate, kept per issuance rather than cached. Every row names its issuer and the time the issuer made it, so a passed day can state what was forecast and how far out it was. RLS on, service_role only, anon/authenticated revoked.';

COMMENT ON COLUMN public.weather_readings.issued_at IS
  'When the ISSUER made this forecast. Distinct from fetched_at, which is when we asked; a reading can be hours old and correct, and only these two together can say so.';

COMMENT ON COLUMN public.weather_readings.precipitation_probability IS
  'Percent, or NULL when the issuer published none. Deliberately not defaulted to 0 — "no rain expected" and "the issuer said nothing" must not render as the same flat bar.';

COMMENT ON COLUMN public.weather_readings.temperature_unit IS
  'The unit the ISSUER published in, kept unconverted. NWS publishes F for US locations. Normalising on write would replace the meteorologist''s number with ours.';

-- ---------------------------------------------------------------------------
-- 3. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  absent_cols text;
  c           text;
  required    text[] := ARRAY[
    'id', 'restaurant_id', 'issuer', 'issuer_detail', 'issued_at', 'fetched_at',
    'valid_from', 'valid_to', 'business_date', 'latitude', 'longitude',
    'temperature_high', 'temperature_low', 'temperature_unit',
    'precipitation_probability', 'precipitation_amount_mm', 'wind_summary',
    'short_forecast', 'raw_hash', 'created_at'
  ];
  nullable_by_design text[] := ARRAY[
    'temperature_high', 'temperature_low',
    'precipitation_probability', 'precipitation_amount_mm'
  ];
BEGIN
  IF to_regclass('public.weather_readings') IS NULL THEN
    RAISE EXCEPTION 'weather_readings was not created';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = to_regclass('public.weather_readings')) THEN
    RAISE EXCEPTION 'weather_readings has RLS off';
  END IF;

  IF has_table_privilege('anon', 'public.weather_readings', 'SELECT')
     OR has_table_privilege('anon', 'public.weather_readings', 'INSERT')
     OR has_table_privilege('anon', 'public.weather_readings', 'UPDATE')
     OR has_table_privilege('anon', 'public.weather_readings', 'DELETE')
     OR has_table_privilege('authenticated', 'public.weather_readings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.weather_readings', 'INSERT')
     OR has_table_privilege('authenticated', 'public.weather_readings', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.weather_readings', 'DELETE')
  THEN
    RAISE EXCEPTION 'weather_readings is still reachable by anon/authenticated';
  END IF;

  FOREACH c IN ARRAY required LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'weather_readings'
        AND column_name = c
    ) THEN
      absent_cols := concat_ws(', ', absent_cols, c);
    END IF;
  END LOOP;

  IF absent_cols IS NOT NULL THEN
    RAISE EXCEPTION 'weather_readings is missing columns the gateway reads: %', absent_cols;
  END IF;

  -- The nullability that carries the honesty. A NOT NULL here would force every
  -- insert to invent a reading the issuer never published.
  FOREACH c IN ARRAY nullable_by_design LOOP
    IF (SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'weather_readings'
           AND column_name = c) <> 'YES' THEN
      RAISE EXCEPTION
        '% must be nullable — a value the issuer did not publish has no number', c;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'weather_readings'
      AND indexname = 'uq_weather_readings_issuance'
  ) THEN
    RAISE EXCEPTION 'the issuance uniqueness the upsert binds to is missing';
  END IF;

  RAISE NOTICE 'weather_readings created, RLS on, anon/authenticated revoked, column contract satisfied.';
END
$$;
