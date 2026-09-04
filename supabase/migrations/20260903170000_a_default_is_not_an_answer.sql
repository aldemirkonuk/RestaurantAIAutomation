-- A default is not an answer.
--
-- Three column defaults are dropped and the rows that carry them are set to
-- NULL. The founder's call, 2026-09-03: an unset value reads as unknown
-- everywhere.
--
--   public.providers.lead_time_days    DEFAULT 7                     (baseline:4864)
--   public.providers.payment_terms     DEFAULT 'Net 30'              (baseline:4897)
--   public.restaurants.timezone        DEFAULT 'America/Los_Angeles' (baseline:3575)
--
-- ---------------------------------------------------------------------------
-- WHY A DEFAULT IS THE PROBLEM AND NOT THE CONVENIENCE
-- ---------------------------------------------------------------------------
-- Each of these columns answers a question about the world that somebody has to
-- have been told: how long this vendor takes, what terms they gave this house,
-- what wall clock this restaurant runs on. A DEFAULT answers it for them, and —
-- this is the whole fault — the answer is INDISTINGUISHABLE from a real one.
-- Every provider row in the database asserts a seven-day lead time on Net 30
-- whether a human ever said so or not, and every restaurant is in California
-- unless somebody happened to change it. That is
-- [[absence-reported-as-health]] written into a column default: the absence of
-- an answer stored as an answer, and read as one by everything downstream.
--
-- `restaurant_vendor_terms` (20260903140000) was built around this fault rather
-- than fixing it: its `leadTimeCell` and `paymentCell` compared the stored value
-- against the default and reported "nobody can tell whether anyone chose it".
-- That was the right thing to do while the default stood. After this migration
-- the comparison is not only unnecessary, it is WRONG — a 7 that survives here
-- is a 7 somebody typed — so this file and
-- `apps/api-gateway/src/vendor-terms/vendor-terms.service.ts` move together.
--
-- ---------------------------------------------------------------------------
-- WHAT THE UPDATE ERASES, STATED PLAINLY
-- ---------------------------------------------------------------------------
-- The UPDATEs below set to NULL every value that EQUALS the old default. That
-- erases real answers too: a vendor who genuinely quoted seven days, a vendor
-- who genuinely said Net 30, a house genuinely in Los Angeles all lose their
-- recorded value.
--
-- This is deliberate and it is the only honest option available. A default is
-- indistinguishable from an answer — that is the definition of the fault — so
-- there is no query that separates the two. The choice is between keeping every
-- fabricated answer in order to save the few real ones, or dropping every one of
-- them and letting the real ones be stated again. Dropping is recoverable: a
-- person re-states the term, and `restaurant_vendor_terms` now records WHO said
-- it and WHEN, so the second telling is provable in a way the first never was.
-- Keeping is not recoverable: nothing downstream can ever learn which sevens
-- were real.
--
-- The rows each UPDATE touches are counted and raised as a NOTICE, so the apply
-- log says exactly how much was erased rather than leaving it to be inferred.
--
-- ---------------------------------------------------------------------------
-- WHAT IS NOT TOUCHED, AND WHY
-- ---------------------------------------------------------------------------
--   * `public.manager_preferences.report_timezone DEFAULT 'America/Los_Angeles'`
--     (baseline:3692) and `public.manager_report_profiles.timezone DEFAULT
--     'America/Los_Angeles'` (baseline:3729) carry the same fault. They were not
--     named in the decision and they belong to the reporting schedule rather
--     than to the house's identity, so they are filed in
--     `.planning/06-pages/settings.md` §13 rather than changed in passing.
--   * `providers.minimum_order` has no default and needs none.
--   * NOT NULL is not added anywhere here. These columns must be nullable — an
--     unstated term is not a zero and not an empty string.

-- The Supabase CLI wraps each migration file in one transaction (the same
-- assumption 20260903140000 states and relies on), so every statement below
-- lands together or not at all. No explicit BEGIN/COMMIT: 111 of the 113
-- migrations in this tree leave it to the CLI, and a nested BEGIN would only
-- warn.

-- ── 1. The defaults go ──────────────────────────────────────────────────────
ALTER TABLE public.providers    ALTER COLUMN lead_time_days  DROP DEFAULT;
ALTER TABLE public.providers    ALTER COLUMN payment_terms   DROP DEFAULT;
ALTER TABLE public.restaurants  ALTER COLUMN timezone        DROP DEFAULT;

-- ── 2. The rows that carry them are set back to unknown ─────────────────────
DO $$
DECLARE
  n_lead int;
  n_pay  int;
  n_zone int;
BEGIN
  UPDATE public.providers SET lead_time_days = NULL WHERE lead_time_days = 7;
  GET DIAGNOSTICS n_lead = ROW_COUNT;

  UPDATE public.providers SET payment_terms = NULL WHERE payment_terms = 'Net 30';
  GET DIAGNOSTICS n_pay = ROW_COUNT;

  UPDATE public.restaurants SET timezone = NULL WHERE timezone = 'America/Los_Angeles';
  GET DIAGNOSTICS n_zone = ROW_COUNT;

  RAISE NOTICE
    'a_default_is_not_an_answer: cleared lead_time_days on % provider row(s), payment_terms on % provider row(s), timezone on % restaurant row(s). Each was equal to the column default and therefore unattributable; a real value equal to the default was erased with the rest, because nothing can tell them apart.',
    n_lead, n_pay, n_zone;
END
$$;

-- ── 3. Assert the state this migration claims to have produced ──────────────
DO $$
DECLARE
  d text;
BEGIN
  FOR d IN
    SELECT format('%s.%s', c.table_name, c.column_name)
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND (
        (c.table_name = 'providers'   AND c.column_name IN ('lead_time_days', 'payment_terms'))
        OR (c.table_name = 'restaurants' AND c.column_name = 'timezone')
      )
      AND c.column_default IS NOT NULL
  LOOP
    RAISE EXCEPTION
      'public.% still carries a column default — dropping it is the whole point of this migration', d;
  END LOOP;

  -- Nullability is the other half of the contract: a column with no default
  -- that is NOT NULL would refuse the write instead of recording the unknown.
  FOR d IN
    SELECT format('%s.%s', c.table_name, c.column_name)
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND (
        (c.table_name = 'providers'   AND c.column_name IN ('lead_time_days', 'payment_terms'))
        OR (c.table_name = 'restaurants' AND c.column_name = 'timezone')
      )
      AND c.is_nullable <> 'YES'
  LOOP
    RAISE EXCEPTION
      'public.% is NOT NULL — an unstated term has to be storable as nothing', d;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.providers WHERE lead_time_days = 7) THEN
    RAISE EXCEPTION 'a provider still reads lead_time_days = 7 after the sweep';
  END IF;
  IF EXISTS (SELECT 1 FROM public.providers WHERE payment_terms = 'Net 30') THEN
    RAISE EXCEPTION 'a provider still reads payment_terms = ''Net 30'' after the sweep';
  END IF;
  IF EXISTS (SELECT 1 FROM public.restaurants WHERE timezone = 'America/Los_Angeles') THEN
    RAISE EXCEPTION 'a restaurant still reads timezone = ''America/Los_Angeles'' after the sweep';
  END IF;

  RAISE NOTICE
    'a_default_is_not_an_answer: three defaults dropped, three columns still nullable, no row left carrying a default value.';
END
$$;
