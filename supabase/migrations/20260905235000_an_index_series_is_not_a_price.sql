-- An index series is not a price, so it gets its own register.
--
-- WHY THIS EXISTS (the founder's batch-37 call, 2026-09-05: "a seperate table
-- for index series"; the plan is .planning/07-reference/commodity-signals-plan.md
-- §6-§8; the class it serves is ADR 0117's class E)
-- ---------------------------------------------------------------------------
-- `price_index_postings` cannot hold an index series, and this is not a matter
-- of taste. Measured against 20260904200000_a_posted_price_names_its_state.sql,
-- FIVE independent columns each refuse one on their own:
--
--   price NUMERIC(12,2) NOT NULL     an FAO index of 133.3 is not a price, and
--                                    two decimals would round the 228.73884495
--                                    an issuer actually published
--   currency CHAR(3) NOT NULL
--     DEFAULT 'USD'                  an index number has no currency, and the
--                                    default would STAMP one - the exact
--                                    absence-as-health defect already recorded
--                                    for restaurants.currency
--   price_unit VARCHAR(24) NOT NULL  ONS d7bu's own declared unit is
--                                    'Index, base year = 100': not a price
--                                    unit, and 26 characters
--   product_name VARCHAR(300)
--     NOT NULL                       a series names a commodity CLASS; writing
--                                    a product in asserts an identity the
--                                    issuer never published
--   state ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$'
--                                    the FAO index is global. There is no
--                                    ISO 3166-2 code for "everywhere"
--
-- So: two tables, because a series' licence, issuer, cadence and unit are
-- properties of the SERIES and repeating them on every observation is how a
-- licence goes stale without anyone noticing. Plus a third for the mapping,
-- because which series moves a given house's item is an ASSERTION a person
-- makes and never an inference a model draws.
--
-- WHAT IS DELIBERATELY ABSENT
-- ---------------------------------------------------------------------------
-- No `restaurant_id` on the series or the observations. The register is public
-- and keyed by series, exactly as `price_index_postings` is keyed by state, and
-- the endpoint scopes it at read time. The MAPPING is per-house and carries one.
--
-- No `price` column anywhere, and no currency default anywhere. A series whose
-- value_kind is 'price' must NAME its currency; every other kind must leave it
-- NULL. Both halves are CHECKed below and both are probed in the assertion
-- block, because a constraint nobody has watched refuse anything is a constraint
-- nobody knows is there.
--
-- Additive: no existing table is altered, no existing CHECK is narrowed, no
-- existing row is rewritten. RLS on and anon/authenticated revoked in this same
-- file, for the reason OD-72/OD-73 exist. The Supabase CLI wraps each migration
-- in a transaction, so there is no explicit BEGIN/COMMIT.

-- ---------------------------------------------------------------------------
-- 1. The series: one row per published series, and everything true of all of it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.commodity_index_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Our stable key, e.g. 'fao.food_price_index.all'. The code's registry is
  -- keyed by this and nothing else, so a re-registered series is the same row.
  series_key TEXT NOT NULL UNIQUE CHECK (btrim(series_key) <> ''),

  -- WHO published it. Free text, and an agency rather than an FK, for the same
  -- reason price_index_postings.issuer is free text: a statistical agency is
  -- not a vendor and giving it a row in `providers` would invite a join that
  -- puts a government index beside a quote.
  issuer TEXT NOT NULL CHECK (btrim(issuer) <> ''),

  -- WHERE it speaks for. ISO 3166 where one applies and the literal 'WORLD'
  -- where none does. THE COLUMN price_index_postings COULD NOT HAVE: its
  -- `state` regex has no code for everywhere, which is why the FAO index could
  -- never have been written there.
  issuer_jurisdiction TEXT NOT NULL CHECK (btrim(issuer_jurisdiction) <> ''),

  -- The issuer's own title, verbatim. Never our paraphrase: the title is the
  -- only place the base period and the coverage are stated in the issuer's
  -- words, and a tidied one loses both.
  series_title TEXT NOT NULL CHECK (btrim(series_title) <> ''),
  source_url TEXT NOT NULL CHECK (source_url ~ '^https?://'),

  -- THE COLUMN THAT MAKES THE TABLE HONEST. An index number may never be
  -- rendered as a price; a rate (HMRC duty, the GIB OTV schedule, the Illinois
  -- gallonage tax) may never be rendered as either; a forecast must carry its
  -- interval before anything reads it as a fact.
  value_kind TEXT NOT NULL
    CHECK (value_kind IN ('price', 'index_number', 'rate', 'forecast')),

  -- The issuer's own unit string, verbatim: 'cents per dozen',
  -- 'Index, base year = 100', 'GBP per kg'. TEXT, not VARCHAR(24): ONS's own
  -- unit is 26 characters and truncating an issuer's unit invents a new one.
  unit TEXT NOT NULL CHECK (btrim(unit) <> ''),

  -- The base period an index is stated against, verbatim: '2014-2016=100'.
  -- NULL for a price or a rate, which have no base. A BASE CHANGE IS A NEW
  -- SERIES, not a new observation - the same index on two bases differs by
  -- roughly fifty percent, which any step guard would read as a crash. The
  -- parser compares the file's own base line against this and refuses the run
  -- when they differ, which is also what catches FAO's second live path
  -- (HTTP 200, well-formed, base 2002-2004=100, last row Mar-18).
  base_period TEXT,

  -- No currency DEFAULT, ever, on purpose. See the CHECK below.
  currency CHAR(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),

  -- WHICH published number this is: 'FOB', 'delivered to warehouse',
  -- 'to producers', 'retail city average'. The column that stops a producer
  -- price being compared with a retail one - measured on eggs the same day at
  -- a ratio of 6.3x between the two.
  price_basis TEXT,

  cadence TEXT NOT NULL CHECK (btrim(cadence) <> ''),
  -- The staleness gate's input. Counted in days and compared against the
  -- NEWEST OBSERVATION'S OWN PERIOD, never against the HTTP status and never
  -- against the file's presence.
  max_age_days INTEGER NOT NULL CHECK (max_age_days > 0),

  -- Verbatim, or the literal 'unstated'. Never 'unknown', never NULL: a NULL
  -- licence reads as "nobody has looked", and for FAO somebody has looked and
  -- found that no licence is declared at all.
  licence TEXT NOT NULL CHECK (btrim(licence) <> ''),
  -- The string that must travel WITH the number wherever it is drawn, when the
  -- licence requires one (the Iowa CC BY 4.0 precedent).
  attribution TEXT,

  -- The four states a licence can actually be in. A boolean would collapse
  -- `prohibited` and `unstated` into one silence, and they are opposite facts:
  -- one is a publisher saying no, the other is a publisher saying nothing.
  redistribution TEXT NOT NULL
    CHECK (redistribution IN
      ('permitted', 'attribution_required', 'prohibited', 'unstated')),

  -- HOW an observation may reach this register.
  --   fetch        a scheduled reader may be pointed at the host
  --   upload_only  the host's crawl rules cannot be READ, so nothing may be
  --                fetched from it and a person brings the file instead. Today:
  --                www.ams.usda.gov, whose robots.txt returned 403 on
  --                2026-09-04 and again on 2026-09-05.
  admission TEXT NOT NULL DEFAULT 'fetch'
    CHECK (admission IN ('fetch', 'upload_only')),

  -- The alert thresholds, DERIVED FROM THIS SERIES' OWN HISTORY and never set
  -- as a global percentage. Measured 2026-09-05 across three real series: the
  -- rise that produces "about twice a year" ranges from 8.5% to 67.8%, a factor
  -- of eight, so one constant would mean eight different things. NULL means the
  -- rule CANNOT FIRE for this series, and that is said on the screen rather
  -- than left as a silence.
  rise_threshold NUMERIC(6, 4) CHECK (rise_threshold IS NULL OR rise_threshold > 0),
  -- The series' own p99 month-on-month move. A global "probably a bad parse"
  -- ceiling of 35% refused 25 of 114 evaluated months on the wholesale egg
  -- series, whose real p99 is 82% - twenty-two percent of a real market
  -- suppressed as implausible.
  step_guard NUMERIC(6, 4) CHECK (step_guard IS NULL OR step_guard > 0),
  threshold_window_from DATE,
  threshold_window_to DATE,
  threshold_window_n_obs INTEGER CHECK (threshold_window_n_obs IS NULL OR threshold_window_n_obs >= 0),
  threshold_computed_at TIMESTAMPTZ,

  -- Armed for ALERTING. Never for fetching: fetching is armed by the
  -- environment flag, so a row in a table can never turn an outbound reader on.
  armed BOOLEAN NOT NULL DEFAULT false,

  -- Unreadable versus read-but-unusable, mirroring price-index.registry.ts's
  -- existing distinction rather than inventing a second vocabulary.
  withheld_reason TEXT,
  silent TEXT,
  measured_on DATE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A price names its money; nothing else may carry any. The absence of a
  -- currency is never reported AS a currency, and a currency on an index
  -- number would be a unit nobody published.
  CONSTRAINT commodity_index_series_currency_only_for_price
    CHECK (
      (value_kind = 'price' AND currency IS NOT NULL)
      OR (value_kind <> 'price' AND currency IS NULL)
    ),

  -- An index number is stated against a base or it is not an index number.
  CONSTRAINT commodity_index_series_index_has_a_base
    CHECK (
      value_kind <> 'index_number'
      OR (base_period IS NOT NULL AND btrim(base_period) <> '')
    ),

  -- A threshold that cannot be traced to the window that produced it is a
  -- number on a screen with no working behind it. Either both halves or
  -- neither.
  CONSTRAINT commodity_index_series_threshold_states_its_window
    CHECK (
      rise_threshold IS NULL
      OR (threshold_window_from IS NOT NULL
          AND threshold_window_to IS NOT NULL
          AND threshold_window_n_obs IS NOT NULL
          AND threshold_computed_at IS NOT NULL)
    ),

  -- A series with no threshold may not be armed: arming one would arm a rule
  -- that can never fire, which reads on every status page as health.
  CONSTRAINT commodity_index_series_armed_needs_a_threshold
    CHECK (armed = false OR rise_threshold IS NOT NULL),

  -- A series nobody may republish may not be armed to alert anybody, because
  -- an alert IS publication. `unstated` is deliberately NOT blocked here: that
  -- is the founder's open question (the plan's Q4) and a CHECK would answer it.
  CONSTRAINT commodity_index_series_prohibited_never_armed
    CHECK (armed = false OR redistribution <> 'prohibited')
);

COMMENT ON TABLE public.commodity_index_series IS
  'One row per published commodity or market index series (ADR 0117 class E; commodity-signals-plan.md §7a). NOT restaurant-scoped: the register is public and keyed by series, and the endpoint scopes it at read time. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.commodity_index_series.value_kind IS
  'price / index_number / rate / forecast. The column that keeps the register honest: an index number may never be rendered as a price, a rate may never be rendered as either, and a forecast must carry its interval.';
COMMENT ON COLUMN public.commodity_index_series.base_period IS
  'The base an index is stated against, verbatim (''2014-2016=100''). A base change is a NEW SERIES, not a new observation: the same index on two bases differs by roughly fifty percent, which a step guard would read as a crash.';
COMMENT ON COLUMN public.commodity_index_series.redistribution IS
  'permitted / attribution_required / prohibited / unstated. Four values, not a boolean: a boolean would collapse ''prohibited'' (a publisher saying no) and ''unstated'' (a publisher saying nothing) into the same silence.';
COMMENT ON COLUMN public.commodity_index_series.admission IS
  'fetch = a scheduled reader may be pointed at the host. upload_only = the host refuses to serve its robots.txt, so nothing may be fetched from it and a person brings the file (www.ams.usda.gov, 403 on 2026-09-04 and 2026-09-05).';
COMMENT ON COLUMN public.commodity_index_series.rise_threshold IS
  'Derived from THIS series'' own history at the quantile that produces the frequency the house asked for. NULL means the rule cannot fire for this series, which is stated on the screen and never left as a silence.';
COMMENT ON COLUMN public.commodity_index_series.armed IS
  'Armed for ALERTING only. Fetching is armed by an environment flag, so no row in this table can ever turn an outbound reader on.';

CREATE INDEX IF NOT EXISTS idx_commodity_index_series_armed
  ON public.commodity_index_series (series_key)
  WHERE armed = true;

ALTER TABLE public.commodity_index_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commodity_index_series_service_role
  ON public.commodity_index_series;
CREATE POLICY commodity_index_series_service_role
  ON public.commodity_index_series
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.commodity_index_series FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The observations: one row per period the issuer published a value for.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.commodity_index_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  series_id UUID NOT NULL
    REFERENCES public.commodity_index_series(id) ON DELETE CASCADE,

  -- THE OBSERVATION'S OWN PERIOD, never our clock. This is the column the
  -- staleness gate ages, because a live 200 serving an eight-year-old file is
  -- the failure this whole register is built against: FAO's older CSV path
  -- returns HTTP 200, well-formed, 14,225 bytes, and its last row is Mar-18.
  period_start DATE NOT NULL,
  period_grain TEXT NOT NULL
    CHECK (period_grain IN ('day', 'week', 'month', 'quarter', 'year')),

  -- Wide enough for the 228.73884495 an issuer actually published. A rounded
  -- series is a different series.
  value NUMERIC(18, 8) NOT NULL,

  -- The issuer's publication date - or ours, and the next column says which.
  issued_at TIMESTAMPTZ NOT NULL,
  -- ADR 0117 Q27's decided column and vocabulary, reused EXACTLY rather than
  -- re-spelled, so refuseStale ages a fetch-dated row from the read and the
  -- screen prints 'read on' rather than 'issued'. Measured need, not symmetry:
  -- FAO's CSV states no date of any kind and ONS states two.
  issued_at_basis TEXT NOT NULL
    CHECK (issued_at_basis IN ('issuer_stated', 'fetch_date')),
  fetched_at TIMESTAMPTZ NOT NULL,

  -- BLS returned WPU0223 flagged 'Preliminary. All indexes are subject to
  -- monthly revisions' for four consecutive months. A revision that silently
  -- overwrote a preliminary value would rewrite the history an alert already
  -- fired on, so a revision is a NEW ROW and this column says which it is.
  vintage TEXT CHECK (vintage IS NULL OR vintage IN ('preliminary', 'final', 'revised')),

  source_ref TEXT NOT NULL CHECK (btrim(source_ref) <> ''),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The same dedup shape price_index_postings uses: a re-read of an unchanged
  -- observation hashes the same and dedups away; a revision is new evidence and
  -- gets its own row.
  CONSTRAINT commodity_index_observations_once
    UNIQUE (series_id, period_start, source_ref, content_hash)
);

COMMENT ON TABLE public.commodity_index_observations IS
  'One row per period an index series published a value for (commodity-signals-plan.md §7b). Dated by the OBSERVATION''S OWN PERIOD, never by our clock and never by the HTTP status. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.commodity_index_observations.issued_at_basis IS
  'issuer_stated = the publisher stamped this date. fetch_date = nobody published one and this column holds the day WE read the file (FAO''s CSV states no date of any kind). Only the first may be rendered as "issued".';
COMMENT ON COLUMN public.commodity_index_observations.vintage IS
  'preliminary / final / revised, when the issuer says. A revision is a NEW ROW: silently overwriting a preliminary value would rewrite the history an alert already fired on.';

CREATE INDEX IF NOT EXISTS idx_commodity_index_observations_latest
  ON public.commodity_index_observations (series_id, period_start DESC);

ALTER TABLE public.commodity_index_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commodity_index_observations_service_role
  ON public.commodity_index_observations;
CREATE POLICY commodity_index_observations_service_role
  ON public.commodity_index_observations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.commodity_index_observations FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The mapping: which series moves THIS house's item. A person's assertion.
-- ---------------------------------------------------------------------------
--
-- A house buys "eggs, large, case of 15 dozen". No series knows that. The join
-- is an assertion and it is the part most likely to be got wrong quietly, so:
--
--   NEVER INFERRED. No model proposes an exposure. The category leader's own
--   product does exactly this inference at item level and publishes no accuracy
--   figure of any kind (measured 2026-09-05); under ADR 0083 this product may
--   not do the same.
--
--   ABSENCE IS SAID. Where no live exposure exists the panel reads "no
--   commodity series is mapped to this item" - ADR 0051's rule and the
--   difference between STABLE and UNOBSERVED.
--
--   RETIRED, NEVER DELETED. ADR 0115's rule: a mapping that was true and
--   stopped being true is evidence, and deleting it destroys the only record
--   that an alert once had a basis.

CREATE TABLE IF NOT EXISTS public.house_item_commodity_exposure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- ADR 0115's key. References public.restaurant_inventory, THE TABLE THAT
  -- EXISTS TODAY, deliberately and not the `house_items` view that ADR 0115's
  -- own migration is written for and that is NOT APPLIED. A foreign key to a
  -- relation that does not exist at this point in the corpus is a migration
  -- that cannot replay.
  house_item_id UUID NOT NULL
    REFERENCES public.restaurant_inventory(id) ON DELETE CASCADE,

  series_id UUID NOT NULL
    REFERENCES public.commodity_index_series(id) ON DELETE CASCADE,

  -- The share of a series move expected to reach THIS item's invoice price.
  pass_through NUMERIC(4, 3)
    CHECK (pass_through IS NULL OR (pass_through >= 0 AND pass_through <= 1)),
  -- 'unset' IS THE HONEST DEFAULT AND IT IS THE COMMON CASE. With it, the
  -- assistant says the series moved and says it does not know how much of that
  -- reaches this item. A number with no basis behind it is the one thing this
  -- column exists to make impossible.
  pass_through_basis TEXT NOT NULL DEFAULT 'unset'
    CHECK (pass_through_basis IN ('issuer_published', 'house_measured', 'unset')),

  lag_days INTEGER CHECK (lag_days IS NULL OR lag_days >= 0),
  lag_basis TEXT NOT NULL DEFAULT 'unset'
    CHECK (lag_basis IN ('issuer_published', 'house_measured', 'unset')),

  -- A PERSON. From public.users(user_id) and never auth.users: the two tables
  -- are DISJOINT (zero shared ids), the JWT carries public.users.user_id, and
  -- CI cannot catch the mistake because a fresh database has no rows to
  -- violate an FK with.
  asserted_by UUID NOT NULL
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  asserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT,

  -- Retirement, not deletion.
  retired_at TIMESTAMPTZ,
  retired_by UUID REFERENCES public.users(user_id) ON DELETE RESTRICT,
  retired_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A figure states its basis, or it is not a figure. Both directions: a number
  -- with basis 'unset' is a number nobody can trace, and a basis that claims a
  -- measurement with no number behind it is worse.
  CONSTRAINT house_item_commodity_exposure_pass_through_states_its_basis
    CHECK ((pass_through IS NULL) = (pass_through_basis = 'unset')),
  CONSTRAINT house_item_commodity_exposure_lag_states_its_basis
    CHECK ((lag_days IS NULL) = (lag_basis = 'unset')),

  -- A retirement names a person and a reason, or it is not a retirement.
  CONSTRAINT house_item_commodity_exposure_retirement_complete
    CHECK (
      (retired_at IS NULL AND retired_by IS NULL AND retired_reason IS NULL)
      OR (retired_at IS NOT NULL AND retired_by IS NOT NULL
          AND retired_reason IS NOT NULL AND btrim(retired_reason) <> '')
    )
);

COMMENT ON TABLE public.house_item_commodity_exposure IS
  'Which index series moves this house''s item (commodity-signals-plan.md §8). A PERSON''S ASSERTION, never a model''s inference. Retired, never deleted. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.house_item_commodity_exposure.pass_through_basis IS
  'issuer_published / house_measured / unset. ''unset'' is the honest default and the common case: the assistant then says the series moved and says it does not know how much of that reaches this item.';
COMMENT ON COLUMN public.house_item_commodity_exposure.house_item_id IS
  'ADR 0115''s key, referencing public.restaurant_inventory - the table that exists today - and deliberately NOT the house_items view, whose migration is unapplied.';

-- One LIVE exposure per (house, item, series). A retired one may sit beside it,
-- which is why the index is partial rather than a plain UNIQUE: retiring and
-- re-asserting a mapping is a legitimate history and must not collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_house_item_commodity_exposure_live
  ON public.house_item_commodity_exposure (restaurant_id, house_item_id, series_id)
  WHERE retired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_house_item_commodity_exposure_by_series
  ON public.house_item_commodity_exposure (series_id, restaurant_id)
  WHERE retired_at IS NULL;

ALTER TABLE public.house_item_commodity_exposure ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS house_item_commodity_exposure_service_role
  ON public.house_item_commodity_exposure;
CREATE POLICY house_item_commodity_exposure_service_role
  ON public.house_item_commodity_exposure
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.house_item_commodity_exposure FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------
--
-- Every probe below inserts, observes the refusal or the acceptance, and cleans
-- up. A CREATE TABLE that returned no error is not evidence that its CHECKs
-- refuse anything: it is evidence that the parser accepted the text.

DO $$
DECLARE
  t TEXT;
  probe_series UUID;
  admitted BOOLEAN;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'commodity_index_series',
    'commodity_index_observations',
    'house_item_commodity_exposure'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '% was not created', t;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class WHERE oid = to_regclass('public.' || t) AND relrowsecurity
    ) THEN
      RAISE EXCEPTION '% has RLS off', t;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = t
         AND grantee IN ('anon', 'authenticated')
    ) THEN
      RAISE EXCEPTION '% still grants anon or authenticated', t;
    END IF;
    -- Every FK must point INSIDE public. auth.users and public.users are
    -- disjoint (zero shared ids) and a fresh CI database has no rows to prove
    -- it with, so the schema is the only place this can be caught.
    IF EXISTS (
      SELECT 1
        FROM pg_constraint con
        JOIN pg_class ref ON ref.oid = con.confrelid
        JOIN pg_namespace ns ON ns.oid = ref.relnamespace
       WHERE con.conrelid = to_regclass('public.' || t)
         AND con.contype = 'f'
         AND ns.nspname <> 'public'
    ) THEN
      RAISE EXCEPTION
        'a foreign key on % points outside public; auth.users and public.users are disjoint', t;
    END IF;
  END LOOP;

  -- No currency default may exist on this table, ever. This is the exact defect
  -- the register was built to avoid: restaurants.currency said USD on fourteen
  -- houses, two of them in Turkiye, because the column carried a default and
  -- nothing ever asked.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'commodity_index_series'
       AND column_name = 'currency' AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'commodity_index_series.currency carries a DEFAULT; the absence of a currency would be reported as a currency';
  END IF;

  -- PROBE 1: an index number may not carry a currency.
  BEGIN
    INSERT INTO public.commodity_index_series
      (series_key, issuer, issuer_jurisdiction, series_title, source_url,
       value_kind, unit, base_period, currency, cadence, max_age_days,
       licence, redistribution)
    VALUES
      ('probe.index.with.currency', 'probe', 'WORLD', 'probe',
       'https://example.invalid', 'index_number', 'Index, base year = 100',
       '2014-2016=100', 'USD', 'monthly', 70, 'unstated', 'unstated');
    admitted := true;
  EXCEPTION WHEN check_violation THEN
    admitted := false;
  END;
  IF admitted THEN
    DELETE FROM public.commodity_index_series WHERE series_key = 'probe.index.with.currency';
    RAISE EXCEPTION 'an index number was admitted carrying a currency';
  END IF;

  -- PROBE 2: a price must name one.
  BEGIN
    INSERT INTO public.commodity_index_series
      (series_key, issuer, issuer_jurisdiction, series_title, source_url,
       value_kind, unit, cadence, max_age_days, licence, redistribution)
    VALUES
      ('probe.price.no.currency', 'probe', 'US', 'probe',
       'https://example.invalid', 'price', 'cents per dozen',
       'daily', 5, 'unstated', 'unstated');
    admitted := true;
  EXCEPTION WHEN check_violation THEN
    admitted := false;
  END;
  IF admitted THEN
    DELETE FROM public.commodity_index_series WHERE series_key = 'probe.price.no.currency';
    RAISE EXCEPTION 'a price series was admitted with no currency';
  END IF;

  -- PROBE 3: a series with no derived threshold may not be armed.
  BEGIN
    INSERT INTO public.commodity_index_series
      (series_key, issuer, issuer_jurisdiction, series_title, source_url,
       value_kind, unit, base_period, cadence, max_age_days, licence,
       redistribution, armed)
    VALUES
      ('probe.armed.no.threshold', 'probe', 'WORLD', 'probe',
       'https://example.invalid', 'index_number', 'Index, base year = 100',
       '2014-2016=100', 'monthly', 70, 'unstated', 'unstated', true);
    admitted := true;
  EXCEPTION WHEN check_violation THEN
    admitted := false;
  END;
  IF admitted THEN
    DELETE FROM public.commodity_index_series WHERE series_key = 'probe.armed.no.threshold';
    RAISE EXCEPTION 'a series with no threshold was armed; the rule could never fire and the status would read as health';
  END IF;

  -- PROBE 4: an index number must state its base. A base change is a new
  -- series, and a series with no base cannot tell anyone that one happened.
  BEGIN
    INSERT INTO public.commodity_index_series
      (series_key, issuer, issuer_jurisdiction, series_title, source_url,
       value_kind, unit, cadence, max_age_days, licence, redistribution)
    VALUES
      ('probe.index.no.base', 'probe', 'WORLD', 'probe',
       'https://example.invalid', 'index_number', 'Index, base year = 100',
       'monthly', 70, 'unstated', 'unstated');
    admitted := true;
  EXCEPTION WHEN check_violation THEN
    admitted := false;
  END;
  IF admitted THEN
    DELETE FROM public.commodity_index_series WHERE series_key = 'probe.index.no.base';
    RAISE EXCEPTION 'an index number was admitted with no base period';
  END IF;

  -- PROBE 5: the dedup index actually refuses a second identical observation,
  -- and admits a revision. A UNIQUE that nobody has watched refuse anything is
  -- a UNIQUE nobody knows is there.
  INSERT INTO public.commodity_index_series
    (series_key, issuer, issuer_jurisdiction, series_title, source_url,
     value_kind, unit, base_period, cadence, max_age_days, licence,
     redistribution)
  VALUES
    ('probe.dedup', 'probe', 'WORLD', 'probe', 'https://example.invalid',
     'index_number', 'Index, base year = 100', '2014-2016=100',
     'monthly', 70, 'unstated', 'unstated')
  RETURNING id INTO probe_series;

  INSERT INTO public.commodity_index_observations
    (series_id, period_start, period_grain, value, issued_at, issued_at_basis,
     fetched_at, source_ref, content_hash)
  VALUES
    (probe_series, DATE '2026-08-01', 'month', 133.3, NOW(), 'fetch_date',
     NOW(), 'probe-ref', repeat('a', 64));

  BEGIN
    INSERT INTO public.commodity_index_observations
      (series_id, period_start, period_grain, value, issued_at, issued_at_basis,
       fetched_at, source_ref, content_hash)
    VALUES
      (probe_series, DATE '2026-08-01', 'month', 133.3, NOW(), 'fetch_date',
       NOW(), 'probe-ref', repeat('a', 64));
    admitted := true;
  EXCEPTION WHEN unique_violation THEN
    admitted := false;
  END;
  IF admitted THEN
    DELETE FROM public.commodity_index_series WHERE id = probe_series;
    RAISE EXCEPTION 'the same observation was written twice';
  END IF;

  -- A REVISION is different bytes, so it is a new row rather than an overwrite.
  INSERT INTO public.commodity_index_observations
    (series_id, period_start, period_grain, value, issued_at, issued_at_basis,
     fetched_at, vintage, source_ref, content_hash)
  VALUES
    (probe_series, DATE '2026-08-01', 'month', 133.9, NOW(), 'fetch_date',
     NOW(), 'revised', 'probe-ref', repeat('b', 64));

  IF (SELECT count(*) FROM public.commodity_index_observations
       WHERE series_id = probe_series) <> 2 THEN
    DELETE FROM public.commodity_index_series WHERE id = probe_series;
    RAISE EXCEPTION 'a revision did not become its own row';
  END IF;

  -- ON DELETE CASCADE from the series, so the probe leaves nothing behind.
  DELETE FROM public.commodity_index_series WHERE id = probe_series;
  IF EXISTS (SELECT 1 FROM public.commodity_index_observations
              WHERE series_id = probe_series) THEN
    RAISE EXCEPTION 'observations outlived their series';
  END IF;

  RAISE NOTICE 'commodity index register: three tables created, RLS on, anon/authenticated revoked, five CHECK probes refused, dedup proven, revision admitted';
END
$$;
