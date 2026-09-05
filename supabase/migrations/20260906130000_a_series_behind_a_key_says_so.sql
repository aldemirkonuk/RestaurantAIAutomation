-- A series behind a credential says so, names the variable, and states its budget.
--
-- WHY THIS EXISTS (the founder, 2026-09-05, batch 58: he minted a personal API
-- key in TUIK's Veri Portali, put it in the repo root .env as
-- TUIK_SDMX_API_KEY, and said "act safely and healthy, and check if it works")
-- ---------------------------------------------------------------------------
-- Every series in this register until now was keyless. FAO and ONS are read by
-- anybody; USDA AMS and the three rate schedules are brought by a person. TUIK
-- is the first source that is READ BY US, ON A SCHEDULE, WITH A CREDENTIAL --
-- and that is a different kind of fact about a source, so it gets columns
-- rather than a sentence in a comment somewhere.
--
-- What the register could not say before this migration, and now must:
--
--   access_key_required    whether reading this source needs a credential at
--                          all. A boolean here is honest because the question
--                          genuinely has two answers -- unlike `redistribution`,
--                          where a boolean would collapse "prohibited" and
--                          "unstated".
--   key_env_var            WHICH environment variable holds it. Named, never
--                          the key: a register that stored a credential would
--                          be a register that leaks one. This is the column a
--                          deployment checklist reads, and it is why a series
--                          can say "I am configured here and not there".
--   robots_reading         what the host said when asked for its crawl rules.
--                          `nsiws.tuik.gov.tr/robots.txt` answers **HTTP 401**
--                          -- the host will not tell an unauthenticated client
--                          its rules at all. That is neither the 200 FAO gives
--                          nor the 404 ONS gives nor the 403 that closed USDA
--                          AMS, and flattening it into any of them would be a
--                          different claim about a different publisher.
--   user_agent             the string we identify as. Recorded on the row so
--                          the identity we present is a property of the source
--                          rather than a constant somebody can quietly change.
--   request_budget_per_day OURS, not the publisher's. TUIK states no rate limit
--                          anywhere -- measured, the manual has none -- so this
--                          number is a self-imposed ceiling and the column name
--                          says whose it is. A source with no stated limit is
--                          exactly where a runaway loop does its damage.
--   licence_url            where the licence text was read. TUIK's re-use
--                          sentence lives in a site-wide legal notice, in
--                          Turkish, on a page the English site does not link
--                          to; the `licence` column holds the words and this
--                          holds where they were found.
--
-- WHY A KEY DOES NOT MAKE A SERIES "PERMITTED"
-- ---------------------------------------------------------------------------
-- `access_key_required` and `redistribution` are independent and both are kept.
-- Holding a credential says a publisher let us READ; it says nothing about
-- whether we may SHOW. TUIK's own legal notice answers the second question and
-- the answer is `attribution_required` -- the same slot ONS sits in -- so the
-- attribution travels with the number whether or not a key was used to fetch
-- it. Collapsing the two would let any keyed source onto a screen.
--
-- Additive. No existing column is altered, no existing CHECK is narrowed, no
-- existing row is rewritten. The Supabase CLI wraps each migration file in a
-- transaction, so no explicit BEGIN/COMMIT.

ALTER TABLE public.commodity_index_series
  ADD COLUMN IF NOT EXISTS access_key_required BOOLEAN NOT NULL DEFAULT false,
  -- The NAME of the variable. NEVER the value: this table is read by every
  -- endpoint in the module and a credential in it would be a credential in
  -- every log line that ever dumps a row.
  ADD COLUMN IF NOT EXISTS key_env_var TEXT,
  ADD COLUMN IF NOT EXISTS robots_reading TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS request_budget_per_day INTEGER,
  ADD COLUMN IF NOT EXISTS licence_url TEXT;

COMMENT ON COLUMN public.commodity_index_series.access_key_required IS
  'Whether reading this source needs a credential. TRUE says nothing about whether the numbers may be SHOWN - that is `redistribution`, and the two are deliberately independent: holding a key means a publisher let us read, never that it let us publish.';
COMMENT ON COLUMN public.commodity_index_series.key_env_var IS
  'The NAME of the environment variable holding the credential, never the credential. A register that stored a key would be a register that leaks one. This is the column a deployment checklist reads.';
COMMENT ON COLUMN public.commodity_index_series.robots_reading IS
  'What the host answered when asked for its crawl rules, in words. Four distinct answers exist across this register - 200 with rules (FAO), 404 absent (ONS), 403 refused (USDA AMS) and 401 unauthenticated (TUIK nsiws) - and flattening any into another is a different claim about a different publisher.';
COMMENT ON COLUMN public.commodity_index_series.request_budget_per_day IS
  'OUR self-imposed ceiling, not the publisher''s limit. TUIK states no rate limit anywhere, and a source with no stated limit is exactly where a runaway loop does its damage.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'commodity_index_series_key_names_its_variable'
       AND conrelid = to_regclass('public.commodity_index_series')
  ) THEN
    -- A series that needs a credential names WHERE the credential lives, or
    -- nobody can tell a missing key from a broken source. And a series that
    -- needs none may not name one, or a checklist would go looking for a
    -- variable nothing reads.
    ALTER TABLE public.commodity_index_series
      ADD CONSTRAINT commodity_index_series_key_names_its_variable
      CHECK (
        (access_key_required = false AND key_env_var IS NULL)
        OR (access_key_required = true
            AND key_env_var IS NOT NULL
            AND btrim(key_env_var) <> ''
            -- A shell-shaped name. This is also the shape that makes the value
            -- impossible to paste in by accident: a real key is not
            -- SCREAMING_SNAKE and would be refused here.
            AND key_env_var ~ '^[A-Z][A-Z0-9_]*$')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'commodity_index_series_budget_is_positive'
       AND conrelid = to_regclass('public.commodity_index_series')
  ) THEN
    -- A budget of zero is not a budget, it is a source that may not be read,
    -- and that is what `admission` and `withheld_reason` are for.
    ALTER TABLE public.commodity_index_series
      ADD CONSTRAINT commodity_index_series_budget_is_positive
      CHECK (request_budget_per_day IS NULL OR request_budget_per_day > 0);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  admitted BOOLEAN;
  probe UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'commodity_index_series'
       AND column_name = 'access_key_required'
  ) THEN
    RAISE EXCEPTION 'access_key_required was not added';
  END IF;

  -- `access_key_required` is the ONE column here that may carry a default, and
  -- it must be FALSE: every series already in the register is keyless, and a
  -- default of true would claim a credential requirement nobody measured.
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'commodity_index_series'
         AND column_name = 'access_key_required') NOT LIKE '%false%' THEN
    RAISE EXCEPTION
      'access_key_required does not default to false; every series already registered is keyless';
  END IF;

  -- The other five must carry NO default. A defaulted user agent or budget is
  -- a claim about a publisher nobody made.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'commodity_index_series'
       AND column_name IN ('key_env_var', 'robots_reading', 'user_agent',
                           'request_budget_per_day', 'licence_url')
       AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'a credential-provenance column carries a DEFAULT';
  END IF;

  -- PROBE: a keyed series must name its variable.
  BEGIN
    INSERT INTO public.commodity_index_series
      (series_key, issuer, issuer_jurisdiction, series_title, source_url,
       value_kind, unit, base_period, cadence, max_age_days, licence,
       redistribution, access_key_required)
    VALUES
      ('probe.key.no.var', 'probe', 'TR', 'probe', 'https://example.invalid',
       'index_number', 'Index, base year = 100', '2025=100', 'monthly', 70,
       'unstated', 'unstated', true);
    admitted := true;
  EXCEPTION WHEN check_violation THEN
    admitted := false;
  END;
  IF admitted THEN
    DELETE FROM public.commodity_index_series WHERE series_key = 'probe.key.no.var';
    RAISE EXCEPTION 'a series that needs a credential was admitted without naming where it lives';
  END IF;

  -- PROBE: the variable must LOOK like a variable name. A pasted credential
  -- would not, which is the point.
  BEGIN
    INSERT INTO public.commodity_index_series
      (series_key, issuer, issuer_jurisdiction, series_title, source_url,
       value_kind, unit, base_period, cadence, max_age_days, licence,
       redistribution, access_key_required, key_env_var)
    VALUES
      ('probe.key.pasted', 'probe', 'TR', 'probe', 'https://example.invalid',
       'index_number', 'Index, base year = 100', '2025=100', 'monthly', 70,
       'unstated', 'unstated', true, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    admitted := true;
  EXCEPTION WHEN check_violation THEN
    admitted := false;
  END;
  IF admitted THEN
    DELETE FROM public.commodity_index_series WHERE series_key = 'probe.key.pasted';
    RAISE EXCEPTION 'something that is not an environment variable name was admitted as one';
  END IF;

  -- PROBE: a keyless series may not name a variable either.
  BEGIN
    INSERT INTO public.commodity_index_series
      (series_key, issuer, issuer_jurisdiction, series_title, source_url,
       value_kind, unit, base_period, cadence, max_age_days, licence,
       redistribution, access_key_required, key_env_var)
    VALUES
      ('probe.keyless.with.var', 'probe', 'WORLD', 'probe',
       'https://example.invalid', 'index_number', 'Index, base year = 100',
       '2014-2016=100', 'monthly', 70, 'unstated', 'unstated', false, 'SOME_VAR');
    admitted := true;
  EXCEPTION WHEN check_violation THEN
    admitted := false;
  END;
  IF admitted THEN
    DELETE FROM public.commodity_index_series WHERE series_key = 'probe.keyless.with.var';
    RAISE EXCEPTION 'a keyless series named a credential variable nothing reads';
  END IF;

  -- PROBE: a zero budget is refused. It is not a budget; it is a source that
  -- may not be read, which `admission` already says.
  BEGIN
    INSERT INTO public.commodity_index_series
      (series_key, issuer, issuer_jurisdiction, series_title, source_url,
       value_kind, unit, base_period, cadence, max_age_days, licence,
       redistribution, request_budget_per_day)
    VALUES
      ('probe.zero.budget', 'probe', 'TR', 'probe', 'https://example.invalid',
       'index_number', 'Index, base year = 100', '2025=100', 'monthly', 70,
       'unstated', 'unstated', 0);
    admitted := true;
  EXCEPTION WHEN check_violation THEN
    admitted := false;
  END;
  IF admitted THEN
    DELETE FROM public.commodity_index_series WHERE series_key = 'probe.zero.budget';
    RAISE EXCEPTION 'a request budget of zero was admitted';
  END IF;

  -- And the real shape goes in: a keyed, attribution-required, budgeted series.
  INSERT INTO public.commodity_index_series
    (series_key, issuer, issuer_jurisdiction, series_title, source_url,
     value_kind, unit, base_period, cadence, max_age_days, licence,
     attribution, redistribution, access_key_required, key_env_var,
     robots_reading, user_agent, request_budget_per_day, licence_url)
  VALUES
    ('probe.tuik.shape', 'probe', 'TR', 'probe', 'https://example.invalid',
     'index_number', 'Index, base year = 100', '2025=100', 'monthly', 70,
     'probe licence', 'Source: probe', 'attribution_required', true,
     'TUIK_SDMX_API_KEY',
     '401 - the host will not tell an unauthenticated client its crawl rules',
     'MudavymBot/1.0', 24, 'https://example.invalid/notice')
  RETURNING id INTO probe;
  DELETE FROM public.commodity_index_series WHERE id = probe;

  RAISE NOTICE 'credential provenance: six columns added, four CHECK probes refused, the keyed shape admitted';
END
$$;
