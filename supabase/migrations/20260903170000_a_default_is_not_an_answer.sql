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
--
-- ---------------------------------------------------------------------------
-- THE SNAPSHOT, AND ITS EXPIRY DATE
-- ---------------------------------------------------------------------------
-- Section 2 photographs the pre-change values into
-- `public.tmp_dropped_column_defaults_20260903` before section 3 clears them,
-- and section 3 asserts, per column, that the photograph caught exactly the
-- rows the UPDATE went on to clear.
--
-- It is a record, not a restore path — a value equal to a default is
-- unattributable, so restoring it wholesale would restore the fault. And it is
-- TEMPORARY: **drop it on 2026-10-04**. The follow-up is filed in
-- `.planning/06-pages/settings.md` §13.32 and in ADR 0116's Consequences,
-- because a table kept "just in case" and never dropped is a second copy of the
-- fabricated answers, which is worse than never having taken one.

-- The Supabase CLI wraps each migration file in one transaction (the same
-- assumption 20260903140000 states and relies on), so every statement below
-- lands together or not at all. No explicit BEGIN/COMMIT: 111 of the 113
-- migrations in this tree leave it to the CLI, and a nested BEGIN would only
-- warn.

-- ── 1. The defaults go ──────────────────────────────────────────────────────
ALTER TABLE public.providers    ALTER COLUMN lead_time_days  DROP DEFAULT;
ALTER TABLE public.providers    ALTER COLUMN payment_terms   DROP DEFAULT;
ALTER TABLE public.restaurants  ALTER COLUMN timezone        DROP DEFAULT;

-- ── 2. A photograph of what is about to be erased ───────────────────────────
--
-- The founder's call, 2026-09-04, after reading the cost above: take a
-- snapshot before the UPDATE.
--
-- WHY IT DOES NOT WEAKEN THE DECISION. This is not a hedge and not a rollback
-- path. The whole point of the migration is that a value equal to a default is
-- UNATTRIBUTABLE — so the snapshot cannot tell a real "7 days" from a
-- fabricated one either, and restoring it wholesale would restore exactly the
-- fault this migration removes. What it buys is one thing only: the erasure
-- becomes INSPECTABLE. A person can ask "which vendors lost a lead time, and do
-- any of them look like somebody really typed it?" and get an answer, instead of
-- a count in an apply log and no way back to the question.
--
-- SO IT IS EXPLICITLY TEMPORARY, and the name says so. It is scheduled for
-- deletion a month after this migration lands — filed in
-- `.planning/06-pages/settings.md` §13.32 and in ADR 0116's Consequences, with
-- the date. A table that is kept "just in case" and never dropped becomes a
-- second copy of the fabricated answers, which is worse than not taking one.
--
-- It is locked down in the same migration that creates it (OD-72 / OD-73): RLS
-- on, service_role only, anon and authenticated revoked. Nothing in the
-- application reads it and nothing ever should; it is an operator's record.
CREATE TABLE IF NOT EXISTS public.tmp_dropped_column_defaults_20260903 (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'provider' or 'restaurant'. A discriminator rather than two tables, because
  -- this is one erasure event and reading it should not need a UNION.
  entity        text NOT NULL,
  entity_id     uuid NOT NULL,
  -- Exactly the three columns this migration clears, NULL where not applicable
  -- to the row's entity. No defaults on any of them — a snapshot of a
  -- defaulted-column fault must not carry defaults of its own.
  lead_time_days integer,
  payment_terms  text,
  timezone       text,
  captured_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tmp_dropped_column_defaults_20260903_entity_check
    CHECK (entity IN ('provider', 'restaurant'))
);

ALTER TABLE public.tmp_dropped_column_defaults_20260903
  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tmp_dropped_column_defaults_20260903_service_role
  ON public.tmp_dropped_column_defaults_20260903;
CREATE POLICY tmp_dropped_column_defaults_20260903_service_role
  ON public.tmp_dropped_column_defaults_20260903
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.tmp_dropped_column_defaults_20260903
  FROM anon, authenticated;

COMMENT ON TABLE public.tmp_dropped_column_defaults_20260903 IS
  'TEMPORARY. The pre-change values that migration 20260903170000 erased when it dropped three column defaults (providers.lead_time_days, providers.payment_terms, restaurants.timezone). Taken so the erasure is inspectable, NOT as a restore path: a value equal to a default is unattributable, so restoring it wholesale would restore the fault. Scheduled for deletion 2026-10-04 — see .planning/06-pages/settings.md §13.32 and ADR 0116. RLS on, service_role only, anon/authenticated revoked. No application code reads this.';

-- ── 3. The rows that carry them are set back to unknown ─────────────────────
DO $$
DECLARE
  n_lead int;
  n_pay  int;
  n_zone int;
  s_lead int;
  s_pay  int;
  s_zone int;
BEGIN
  -- The photograph, taken BEFORE anything is cleared. One row per affected
  -- entity: a provider carrying BOTH a defaulted lead time and defaulted terms
  -- is one row with both columns filled, which is also why the assertion below
  -- counts per column rather than counting rows.
  INSERT INTO public.tmp_dropped_column_defaults_20260903
    (entity, entity_id, lead_time_days, payment_terms)
  SELECT
    'provider',
    p.id,
    CASE WHEN p.lead_time_days = 7        THEN p.lead_time_days END,
    CASE WHEN p.payment_terms  = 'Net 30' THEN p.payment_terms  END
  FROM public.providers p
  WHERE p.lead_time_days = 7 OR p.payment_terms = 'Net 30';

  INSERT INTO public.tmp_dropped_column_defaults_20260903
    (entity, entity_id, timezone)
  SELECT 'restaurant', r.id, r.timezone
  FROM public.restaurants r
  WHERE r.timezone = 'America/Los_Angeles';

  SELECT
    count(*) FILTER (WHERE lead_time_days IS NOT NULL),
    count(*) FILTER (WHERE payment_terms  IS NOT NULL),
    count(*) FILTER (WHERE timezone       IS NOT NULL)
  INTO s_lead, s_pay, s_zone
  FROM public.tmp_dropped_column_defaults_20260903
  WHERE captured_at >= now();

  UPDATE public.providers SET lead_time_days = NULL WHERE lead_time_days = 7;
  GET DIAGNOSTICS n_lead = ROW_COUNT;

  UPDATE public.providers SET payment_terms = NULL WHERE payment_terms = 'Net 30';
  GET DIAGNOSTICS n_pay = ROW_COUNT;

  UPDATE public.restaurants SET timezone = NULL WHERE timezone = 'America/Los_Angeles';
  GET DIAGNOSTICS n_zone = ROW_COUNT;

  -- THE ASSERTION THE FOUNDER ASKED FOR, and the reason it is per-column.
  --
  -- A snapshot that silently caught fewer rows than the UPDATE cleared would be
  -- a photograph with people missing from it, and the apply log would still read
  -- clean — [[absence-reported-as-health]] pointed at the record of an erasure.
  -- Row counts would not catch that: one provider can contribute to both
  -- provider columns, so rows(snapshot) < n_lead + n_pay by design. Each column
  -- is therefore checked against its own UPDATE.
  --
  -- `captured_at >= now()` scopes the count to THIS transaction (now() is the
  -- transaction start time and the CLI wraps this file in one), so a re-run over
  -- a database that already holds an earlier snapshot still passes.
  IF s_lead <> n_lead OR s_pay <> n_pay OR s_zone <> n_zone THEN
    RAISE EXCEPTION
      'the snapshot does not match what was erased: lead_time_days snapshot=% cleared=%, payment_terms snapshot=% cleared=%, timezone snapshot=% cleared=%',
      s_lead, n_lead, s_pay, n_pay, s_zone, n_zone;
  END IF;

  RAISE NOTICE
    'a_default_is_not_an_answer: cleared lead_time_days on % provider row(s), payment_terms on % provider row(s), timezone on % restaurant row(s). Each was equal to the column default and therefore unattributable; a real value equal to the default was erased with the rest, because nothing can tell them apart.',
    n_lead, n_pay, n_zone;
  RAISE NOTICE
    'a_default_is_not_an_answer: public.tmp_dropped_column_defaults_20260903 holds the pre-change values — % lead time(s), % payment term(s), % timezone(s), matching the counts above exactly. TEMPORARY: drop it on 2026-10-04 (settings.md 13.32). It is a record of what was erased, not a restore path.',
    s_lead, s_pay, s_zone;
END
$$;

-- ── 4. Assert the state this migration claims to have produced ──────────────
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

  -- The snapshot must exist, be locked down, and carry no default of its own.
  -- Asserted here rather than assumed: a temporary table created without RLS is
  -- the OD-72 fault, and a snapshot table with a column default would be this
  -- migration's own subject matter repeated inside the record of it.
  IF to_regclass('public.tmp_dropped_column_defaults_20260903') IS NULL THEN
    RAISE EXCEPTION 'the pre-change snapshot table was not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = to_regclass('public.tmp_dropped_column_defaults_20260903')
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION
      'public.tmp_dropped_column_defaults_20260903 does not have RLS enabled';
  END IF;
  IF has_table_privilege('anon', 'public.tmp_dropped_column_defaults_20260903', 'SELECT')
     OR has_table_privilege('authenticated', 'public.tmp_dropped_column_defaults_20260903', 'SELECT') THEN
    RAISE EXCEPTION
      'anon or authenticated can still read public.tmp_dropped_column_defaults_20260903';
  END IF;
  FOR d IN
    SELECT c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'tmp_dropped_column_defaults_20260903'
      AND c.column_name IN ('lead_time_days', 'payment_terms', 'timezone')
      AND c.column_default IS NOT NULL
  LOOP
    RAISE EXCEPTION
      'the snapshot column % carries a default — that is this migration''s own subject matter, repeated inside the record of it', d;
  END LOOP;

  RAISE NOTICE
    'a_default_is_not_an_answer: three defaults dropped, three columns still nullable, no row left carrying a default value, snapshot present with RLS on and anon/authenticated revoked.';
END
$$;
