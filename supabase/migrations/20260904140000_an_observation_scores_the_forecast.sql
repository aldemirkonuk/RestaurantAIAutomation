-- weather_observations — what the weather actually WAS, so a forecast can
-- finally be scored.
--
-- WHY A SIBLING TABLE AND NOT A `kind` COLUMN
-- -------------------------------------------
-- `weather_readings` (20260903162000) keeps FORECASTS: each row is something an
-- issuer PREDICTED, keyed on `(restaurant_id, business_date, issued_at)` because
-- a new issuance for the same day is a new row beside the old one. An
-- observation is a different kind of fact with a different key — it is a
-- MEASUREMENT taken at a named station, it has no issue time, and re-reading a
-- day should UPDATE it rather than accumulate a second copy, because a day's
-- observed high is one fact that gets more complete as the day runs, not a
-- sequence of competing claims.
--
-- Putting both in one table behind a `kind` column would mean a uniqueness rule
-- that is right for neither: forecasts need many rows per day, observations need
-- exactly one per station per day. So: a sibling, additive, and the forecast
-- table shipped yesterday is not touched.
--
-- THE UNIT DISAGREEMENT IS THE WHOLE REASON `temperature_unit` IS HERE
-- -------------------------------------------------------------------
-- Measured 2026-09-04: NWS publishes its gridpoint FORECAST in Fahrenheit
-- (`MTR/91,89`) and its station OBSERVATIONS in Celsius (`KPAO`,
-- `wmoUnit:degC`). The two halves of every comparison this table exists to
-- enable are therefore in different units. Each side stores the unit its own
-- issuer published, nothing is converted on write, and the scorer converts and
-- says in words which unit it compared in.
--
-- WHAT IS NULLABLE, AND WHY THAT IS LOAD-BEARING
-- ----------------------------------------------
-- `precipitation_total_mm` is nullable and is NOT defaulted to zero. All 42
-- observations recorded from KPAO on 2026-09-04 carried
-- `precipitationLastHour.value = null` — that station does not report rainfall
-- at all. A `DEFAULT 0` would publish "a dry day" for every day at every such
-- station, which is the absence-reported-as-health fault in the one column a
-- rain model would eventually be built on.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.weather_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- Who measured it. Free text for the same reason weather_readings.issuer is.
  issuer VARCHAR(80) NOT NULL CHECK (btrim(issuer) <> ''),

  -- The station, by the issuer's own identifier, and its human name. The
  -- station is part of the fact: two stations in one grid square disagree, and
  -- a row that did not say which one measured it could not be checked.
  station_id VARCHAR(32) NOT NULL CHECK (btrim(station_id) <> ''),
  station_name VARCHAR(160),

  -- The local calendar day, resolved in the forecast point's own IANA zone.
  -- NWS timestamps observations in UTC, so this is a derived date and the zone
  -- that derived it is recorded beside it.
  business_date DATE NOT NULL,
  time_zone VARCHAR(64) NOT NULL,

  -- The span of readings actually used, and how many there were. A day backed
  -- by two observations and a day backed by twenty-four are different evidence
  -- and the count says which this is.
  first_observed_at TIMESTAMPTZ NOT NULL,
  last_observed_at  TIMESTAMPTZ NOT NULL,
  observation_count SMALLINT NOT NULL CHECK (observation_count > 0),

  -- When we asked, kept separately so a stale row can state its own age.
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The point the station was chosen FOR, so a corrected address cannot
  -- silently re-attribute measurements taken for the old one.
  latitude  DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,

  -- The station's own numbers, in the station's own unit. See the header.
  temperature_high NUMERIC(6, 2),
  temperature_low  NUMERIC(6, 2),
  temperature_unit CHAR(1) NOT NULL CHECK (temperature_unit IN ('C', 'F')),

  -- Summed over the hours that published a number. NULL when none did.
  precipitation_total_mm NUMERIC(6, 2),

  -- sha256 of the raw observations behind this row.
  raw_hash CHAR(64) NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT weather_observations_window_ordered
    CHECK (last_observed_at >= first_observed_at)
);

-- The reconciliation's read: this house, this window of days.
CREATE INDEX IF NOT EXISTS idx_weather_observations_restaurant_date
  ON public.weather_observations (restaurant_id, business_date DESC);

-- One row per station per day. An upsert binds ON CONFLICT to this, so it is
-- deliberately NOT partial.
CREATE UNIQUE INDEX IF NOT EXISTS uq_weather_observations_day_station
  ON public.weather_observations (restaurant_id, business_date, station_id);

-- ---------------------------------------------------------------------------
-- 2. Lock it down in the SAME migration that creates it (OD-72 / OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.weather_observations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS weather_observations_service_role
  ON public.weather_observations;
CREATE POLICY weather_observations_service_role
  ON public.weather_observations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.weather_observations FROM anon, authenticated;

COMMENT ON TABLE public.weather_observations IS
  'What the weather actually was at one restaurant''s coordinate, per local day, measured by a named station. The counterpart to weather_readings (forecasts): together they let a passed day state how far out its forecast was. RLS on, service_role only, anon/authenticated revoked.';

COMMENT ON COLUMN public.weather_observations.temperature_unit IS
  'The unit the STATION published in, kept unconverted. NWS observations are Celsius while its forecasts are Fahrenheit, so the two sides of a comparison genuinely disagree and the scorer converts explicitly.';

COMMENT ON COLUMN public.weather_observations.precipitation_total_mm IS
  'Millimetres summed over the hours that published a number, or NULL when not one did. Deliberately not defaulted to 0 — many stations never report rainfall, and a 0 would publish a dry day at every one of them.';

COMMENT ON COLUMN public.weather_observations.observation_count IS
  'How many station readings backed this day. A day backed by 2 readings and one backed by 24 are different evidence; a consumer that ignores this is treating them as equal.';

-- ---------------------------------------------------------------------------
-- 3. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  absent_cols text;
  c           text;
  required    text[] := ARRAY[
    'id', 'restaurant_id', 'issuer', 'station_id', 'station_name',
    'business_date', 'time_zone', 'first_observed_at', 'last_observed_at',
    'observation_count', 'fetched_at', 'latitude', 'longitude',
    'temperature_high', 'temperature_low', 'temperature_unit',
    'precipitation_total_mm', 'raw_hash', 'created_at'
  ];
  nullable_by_design text[] := ARRAY[
    'temperature_high', 'temperature_low', 'precipitation_total_mm'
  ];
BEGIN
  IF to_regclass('public.weather_observations') IS NULL THEN
    RAISE EXCEPTION 'weather_observations was not created';
  END IF;

  -- The forecast table must still be there and must NOT have been altered by
  -- this file: the pairing is only meaningful if both halves exist.
  IF to_regclass('public.weather_readings') IS NULL THEN
    RAISE EXCEPTION 'weather_readings is missing; the pairing has only one half';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = to_regclass('public.weather_observations')) THEN
    RAISE EXCEPTION 'weather_observations has RLS off';
  END IF;

  IF has_table_privilege('anon', 'public.weather_observations', 'SELECT')
     OR has_table_privilege('anon', 'public.weather_observations', 'INSERT')
     OR has_table_privilege('anon', 'public.weather_observations', 'UPDATE')
     OR has_table_privilege('anon', 'public.weather_observations', 'DELETE')
     OR has_table_privilege('authenticated', 'public.weather_observations', 'SELECT')
     OR has_table_privilege('authenticated', 'public.weather_observations', 'INSERT')
     OR has_table_privilege('authenticated', 'public.weather_observations', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.weather_observations', 'DELETE')
  THEN
    RAISE EXCEPTION 'weather_observations is still reachable by anon/authenticated';
  END IF;

  FOREACH c IN ARRAY required LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'weather_observations'
        AND column_name = c
    ) THEN
      absent_cols := concat_ws(', ', absent_cols, c);
    END IF;
  END LOOP;

  IF absent_cols IS NOT NULL THEN
    RAISE EXCEPTION 'weather_observations is missing columns the gateway reads: %', absent_cols;
  END IF;

  FOREACH c IN ARRAY nullable_by_design LOOP
    IF (SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'weather_observations'
           AND column_name = c) <> 'YES' THEN
      RAISE EXCEPTION
        '% must be nullable — a measurement the station did not publish has no number', c;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'weather_observations'
      AND indexname = 'uq_weather_observations_day_station'
  ) THEN
    RAISE EXCEPTION 'the day/station uniqueness the upsert binds to is missing';
  END IF;

  RAISE NOTICE 'weather_observations created, RLS on, anon/authenticated revoked, column contract satisfied.';
END
$$;
