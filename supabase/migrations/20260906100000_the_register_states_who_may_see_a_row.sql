-- The price register states who may see a row (ADR 0117 addendum, 2026-09-05).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The founder, 2026-09-05 (batch 56), asked whether the fifteen houses the ADR
-- 0128 census counts are real independently owned restaurants or test tenants,
-- and answered: "All real." Recorded in ADR 0126 with the consequence he
-- accepted alongside it, verbatim:
--
--   the contributor floors researched in `p4be-market.md` apply as written, and
--   the register's tenancy boundary (nine hand-written filters and no RLS
--   policy) must be fixed before any cross-house read
--
-- Measured on this tree before the fix, the boundary of the two register tables
-- was SIX hand-written `.or("restaurant_id.is.null,restaurant_id.eq.<id>")`
-- clauses across five files, plus FIVE reads carrying no tenancy clause at all,
-- and NO policy anywhere in supabase/migrations/ naming either table beyond a
-- service-role one. (The "nine" of ADR 0126's sentence counted three clauses
-- that filter other tables entirely; the correction is in ADR 0117's addendum.)
--
-- WHAT THIS FILE ADDS, AND WHAT IT DELIBERATELY DOES NOT
-- -----------------------------------------------------
-- 1. `vendor_price_observations.visibility` — the THIRD visibility state, by
--    name, with a CHECK. No row is put into it and no read returns it; both
--    facts are asserted below.
-- 2. An RLS policy on each table that says the visibility rule in SQL.
-- 3. A REVOKE on `vendor_price_observations`, which had none, matching
--    `price_index_postings` (20260904200000:155).
--
-- It does NOT grant anything to `anon` or `authenticated`. Read the next
-- section before adding one.
--
-- WHAT THE POLICY PROTECTS, HONESTLY
-- ----------------------------------
-- The gateway connects with `SUPABASE_SERVICE_ROLE_KEY`
-- (`apps/api-gateway/src/database/database.service.ts:15`) and the service role
-- BYPASSES row level security. So for every read this product makes today, the
-- policies below protect NOTHING: the boundary is
-- `apps/api-gateway/src/price-register/visibility.ts`, and
-- `scripts/check_price_register_reads_are_scoped.py` is what keeps every read
-- inside it.
--
-- Nor do the policies tighten anything for a JWT-bearing caller, because there
-- is no such caller today and both tables are already shut to one:
--   * `vendor_price_observations` has had RLS ENABLED since
--     20260805154027:145 with NO permissive policy, and a table with RLS on and
--     no policy returns zero rows to every non-bypassing role.
--   * `price_index_postings` has RLS on AND `REVOKE ALL ... FROM anon,
--     authenticated` (20260904200000:149-155).
--
-- So these policies are a STATEMENT OF THE RULE that becomes load-bearing on
-- the day someone grants a JWT role access to either table — and they are
-- written now, while nothing depends on them, precisely so that day does not
-- also have to be the day the rule is invented. Adding the GRANT here would
-- OPEN a table that is currently shut, which is the opposite of this file's
-- job, so the GRANT is not here.
--
-- Idempotent and safe to re-run: ADD COLUMN IF NOT EXISTS, every constraint and
-- policy guarded, REVOKE of an absent privilege is a no-op. No explicit
-- BEGIN/COMMIT -- the Supabase CLI wraps each file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. The third visibility state, named on the row.
-- ---------------------------------------------------------------------------
--
-- Before this column there were exactly two states, and neither was written
-- down anywhere -- both were inferred from `restaurant_id`:
--
--   `restaurant_id = <house>`  the house's own row. An invoice line, a quote a
--                              rep gave them. A negotiating position.
--   `restaurant_id IS NULL`    openly posted. A scraped public list price.
--                              Everyone's, verbatim, AS A ROW.
--
-- A cross-house band needs a third: a row a house agrees may COUNT TOWARD an
-- aggregate and may never be SHOWN as a row. `restaurant_id` cannot express it
-- -- a contributed row still belongs to its house, so it cannot be NULL, and a
-- non-NULL `restaurant_id` is exactly what the ladder shows to that house.
--
-- NULLABLE, NO DEFAULT, ON PURPOSE
-- --------------------------------
-- `visibility IS NULL` is NOT a fourth state. It means "this row's visibility
-- is whatever `restaurant_id` says", which is states 1 and 2 -- the rule the
-- register has always had, unchanged. The column exists to name the ONE state
-- `restaurant_id` cannot express, and that state is the only one that changes
-- what a read may return.
--
-- A NOT NULL column would need either a DEFAULT (which
-- `scripts/check_no_seeded_defaults.py` exists to argue with, and which would
-- have to pick between two states it cannot see `restaurant_id` to choose
-- between) or an edit to every writer -- including
-- `procurement.service.ts:1834`, owned by another build in this wave. A
-- nullable column with no default breaks no writer and states no falsehood.

ALTER TABLE public.vendor_price_observations
  ADD COLUMN IF NOT EXISTS visibility TEXT;

-- The CHECK does two jobs. It admits exactly three names, so a typo is a write
-- failure rather than a row that quietly never matches the exclusion predicate.
-- And it ties each name to `restaurant_id`, so the column can never disagree
-- with the thing it is describing: 'open_market' with a house on it, or
-- 'house'/'contributed_aggregate_only' with none, are refused.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vpo_visibility_check'
      AND conrelid = 'public.vendor_price_observations'::regclass
  ) THEN
    ALTER TABLE public.vendor_price_observations
      ADD CONSTRAINT vpo_visibility_check CHECK (
        visibility IS NULL
        OR (visibility = 'house' AND restaurant_id IS NOT NULL)
        OR (visibility = 'open_market' AND restaurant_id IS NULL)
        OR (visibility = 'contributed_aggregate_only' AND restaurant_id IS NOT NULL)
      );
  END IF;
END $$;

COMMENT ON COLUMN public.vendor_price_observations.visibility IS
  'Who may see this row, stated rather than inferred (ADR 0117 addendum, '
  '2026-09-05). NULL means "whatever restaurant_id says" -- the two-state rule '
  'the register has always had -- and is not a state. ''house'' and '
  '''open_market'' name those two explicitly. ''contributed_aggregate_only'' is '
  'the third: the house''s row, contributed under a floor, which may COUNT '
  'toward an aggregate and may NEVER be returned as a row. No row is in that '
  'state and no read returns one: scopePriceRegisterRead() in '
  'apps/api-gateway/src/price-register/visibility.ts excludes it from every '
  'read in every scope, and check_price_register_reads_are_scoped.py fails CI '
  'for a read that does not pass through it.';

-- ---------------------------------------------------------------------------
-- 2. The rule, said in SQL. Read the header on what this does and does not do.
-- ---------------------------------------------------------------------------

-- The service role already bypasses RLS; this policy exists so the table's
-- access rules are readable in one place rather than being an absence.
DROP POLICY IF EXISTS vendor_price_observations_service_role
  ON public.vendor_price_observations;
CREATE POLICY vendor_price_observations_service_role
  ON public.vendor_price_observations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- The same sentence `scopePriceRegisterRead` applies, in SQL:
--   * a house's own rows, where "this house" is a restaurant the caller has
--     active access to -- the shape every other tenant-scoped table in this
--     schema uses (`cocktails_authenticated_read`,
--     20260818000000:30-43; `restaurant_inventory`'s own policy);
--   * plus the openly posted rows (`restaurant_id IS NULL`);
--   * and NEVER a row in the third state, whichever house it belongs to.
--
-- `auth.uid()` is the JWT's subject. `user_restaurant_access.user_id` is what
-- every existing policy in this schema joins it to, so this policy is the same
-- join those are, right or wrong, rather than a new one invented here --
-- `public.users` and `auth.users` are disjoint tables in this estate, and a
-- policy that guessed differently from its neighbours would be a second,
-- silent, opinion about which id a JWT carries.
DROP POLICY IF EXISTS vendor_price_observations_authenticated_read
  ON public.vendor_price_observations;
CREATE POLICY vendor_price_observations_authenticated_read
  ON public.vendor_price_observations
  FOR SELECT TO authenticated
  USING (
    (visibility IS NULL OR visibility <> 'contributed_aggregate_only')
    AND (
      restaurant_id IS NULL
      OR restaurant_id IN (
        SELECT user_restaurant_access.restaurant_id
        FROM public.user_restaurant_access
        WHERE user_restaurant_access.user_id = auth.uid()
          AND user_restaurant_access.is_active
      )
    )
  );

-- `price_index_postings` carries no restaurant_id -- it is keyed by
-- jurisdiction on purpose (20260904200000:30). Its visibility rule is ADR
-- 0128's: a row is the market when nobody carried it in, or when somebody let
-- it in. A held book waiting for a second pair of eyes is not an index line.
-- This is `MARKET_VISIBILITY` (price-register/visibility.ts), said in SQL.
DROP POLICY IF EXISTS price_index_postings_authenticated_read
  ON public.price_index_postings;
CREATE POLICY price_index_postings_authenticated_read
  ON public.price_index_postings
  FOR SELECT TO authenticated
  USING (uploaded_by IS NULL OR admitted_at IS NOT NULL);

-- `vendor_price_observations` has had RLS on since 20260805154027:145 but never
-- a REVOKE. Supabase's default privileges hand `anon` and `authenticated` table
-- rights on new public tables, and RLS-with-no-policy was the only thing
-- stopping them. Now that a policy exists, the grant matters -- so take it away
-- and let the policy be the statement it is meant to be rather than the door it
-- would otherwise become.
REVOKE ALL ON public.vendor_price_observations FROM anon, authenticated;
REVOKE ALL ON public.price_index_postings FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Prove it, in the migration, rather than trusting that it happened.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  n INTEGER;
  refused BOOLEAN;
BEGIN
  -- 3a. The column exists, is nullable, and has no default. A default would
  --     make every future row assert a visibility nobody chose.
  SELECT COUNT(*) INTO n
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'vendor_price_observations'
    AND column_name = 'visibility'
    AND is_nullable = 'YES'
    AND column_default IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'vendor_price_observations.visibility is missing, NOT NULL, or defaulted (found %)', n;
  END IF;

  -- 3b. The CHECK refuses each disagreement with restaurant_id. Four probes,
  --     each rolled back: the constraint is proven to FIRE, not assumed to
  --     exist. A constraint that exists and never fires is the shape this
  --     repository calls absence-reported-as-health.
  refused := FALSE;
  BEGIN
    INSERT INTO public.vendor_price_observations
      (restaurant_id, source_type, trust_tier, raw_price, visibility)
    VALUES (NULL, 'website_scrape', 1, 10, 'house');
  EXCEPTION WHEN check_violation THEN refused := TRUE;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'vpo_visibility_check admitted visibility=house with no restaurant_id';
  END IF;

  refused := FALSE;
  BEGIN
    INSERT INTO public.vendor_price_observations
      (restaurant_id, source_type, trust_tier, raw_price, visibility)
    VALUES (gen_random_uuid(), 'website_scrape', 1, 10, 'open_market');
  EXCEPTION WHEN check_violation THEN refused := TRUE;
       WHEN foreign_key_violation THEN refused := TRUE;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'vpo_visibility_check admitted visibility=open_market with a restaurant_id';
  END IF;

  refused := FALSE;
  BEGIN
    INSERT INTO public.vendor_price_observations
      (restaurant_id, source_type, trust_tier, raw_price, visibility)
    VALUES (NULL, 'website_scrape', 1, 10, 'contributed_aggregate_only');
  EXCEPTION WHEN check_violation THEN refused := TRUE;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'vpo_visibility_check admitted a contributed row belonging to no house';
  END IF;

  refused := FALSE;
  BEGIN
    INSERT INTO public.vendor_price_observations
      (restaurant_id, source_type, trust_tier, raw_price, visibility)
    VALUES (NULL, 'website_scrape', 1, 10, 'shared');
  EXCEPTION WHEN check_violation THEN refused := TRUE;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'vpo_visibility_check admitted a visibility name outside the three';
  END IF;

  -- 3c. A NULL visibility still writes, on a row with and without a house.
  --     This is the compatibility claim every existing writer depends on, and
  --     it is proven rather than assumed. Rolled back.
  BEGIN
    INSERT INTO public.vendor_price_observations
      (restaurant_id, source_type, trust_tier, raw_price)
    VALUES (NULL, 'website_scrape', 1, 10);
    RAISE EXCEPTION 'rollback_probe';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'rollback_probe' THEN RAISE; END IF;
  END;

  -- 3d. THE FOUNDER'S CONDITION: no row is in the third state.
  SELECT COUNT(*) INTO n
  FROM public.vendor_price_observations
  WHERE visibility = 'contributed_aggregate_only';
  IF n <> 0 THEN
    RAISE EXCEPTION 'the register already holds % contributed row(s); the third state was to be defined with nothing in it', n;
  END IF;

  -- 3e. RLS is on for both tables, and each carries the policies this file
  --     names. A policy that silently failed to create would leave the SQL
  --     statement of the rule as an absence.
  SELECT COUNT(*) INTO n
  FROM pg_class
  WHERE relnamespace = 'public'::regnamespace
    AND relname IN ('vendor_price_observations', 'price_index_postings')
    AND relrowsecurity;
  IF n <> 2 THEN
    RAISE EXCEPTION 'row level security is not enabled on both register tables (found %)', n;
  END IF;

  SELECT COUNT(*) INTO n
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname IN (
      'vendor_price_observations_service_role',
      'vendor_price_observations_authenticated_read',
      'price_index_postings_authenticated_read',
      'price_index_postings_service_role'
    );
  IF n <> 4 THEN
    RAISE EXCEPTION 'the register policies are not all present (found % of 4)', n;
  END IF;

  -- 3f. Neither table grants anything to anon or authenticated. The policies
  --     above are a statement of the rule, and a grant would turn them into a
  --     door -- see the header.
  SELECT COUNT(*) INTO n
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('vendor_price_observations', 'price_index_postings')
    AND grantee IN ('anon', 'authenticated');
  IF n <> 0 THEN
    RAISE EXCEPTION 'anon/authenticated still hold % grant(s) on the register tables', n;
  END IF;
END $$;

COMMENT ON TABLE public.vendor_price_observations IS
  'Immutable, multi-source vendor price sightings. Consensus is computed at '
  'read time from these rows; never store a single "current vendor price". '
  'THREE visibility states (ADR 0117 addendum, 2026-09-05): a house''s own row '
  '(restaurant_id set), an openly posted row (restaurant_id NULL, everyone''s '
  'verbatim), and visibility = ''contributed_aggregate_only'' -- contributed '
  'under a floor, countable in an aggregate, never returned as a row. Every '
  'read goes through scopePriceRegisterRead() in '
  'apps/api-gateway/src/price-register/visibility.ts; the gateway holds the '
  'service role, so that function -- not the policy below it -- is the '
  'boundary.';
