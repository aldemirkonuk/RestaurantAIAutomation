-- price_index_postings — the public price INDEX register (ADR 0117, ADR 0111).
--
-- WHY A SEPARATE TABLE AND NOT vendor_price_observations
-- ------------------------------------------------------
-- ADR 0111 and ADR 0117 draw a hard line: a state's posted list, a control
-- state's shelf price and a public index are a DIFFERENT KIND of number from a
-- vendor's quote to this house. They are published by a government, keyed to a
-- STATE rather than to a restaurant, and — the founder's rule — they may never
-- be placed beside a vendor quote. `vendor_price_observations` is the market
-- box's register: restaurant-scoped, seven vendor trust tiers, a source_type
-- CHECK that admits no value meaning "a government posted this". Writing a
-- posted list into it would (1) need a NULL restaurant_id, which
-- `belowTrailingAverage` reads as visible to EVERY house, and (2) mislabel the
-- trust tier the whole consensus rests on. So: a sibling register, keyed by
-- state, that the market box reads as a labelled INDEX LINE, never folds into
-- its average. See `scripts/fetch_price_sightings.py` for the three blockers
-- this table clears.
--
-- WHAT A ROW CARRIES, AND WHY EACH FIELD IS LOAD-BEARING (ADR 0117's five)
-- -----------------------------------------------------------------------
-- A row is admitted only if it names, on the row, the five things a sighting
-- must: what number (`price`,`price_unit`,`pack`), who published it (`issuer`),
-- when (`issued_at`), what unit (`size_value`/`size_unit`), and WHERE it is a
-- price (`state`, `region`). Anything missing one of the five is refused by the
-- parser BEFORE it reaches this table, and never defaulted in. `price_basis`
-- names WHICH published number this is (a CA posting to Retailers vs to
-- Wholesalers; Iowa's state_bottle_retail vs state_bottle_cost) so two trade
-- levels can never be silently compared.
--
-- NOT restaurant-scoped. There is deliberately no restaurant_id: this is a
-- public register keyed by jurisdiction, and the endpoint scopes it to a
-- house's state at read time, not at write time.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.price_index_postings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The registry row this came from (`.planning/07-reference/price-sources.md`),
  -- e.g. 'california-abc-beer-price-posting'. The join key to the source's terms.
  source_key VARCHAR(80) NOT NULL CHECK (btrim(source_key) <> ''),

  -- B posted wholesale list · D retail reference · E public index (ADR 0117).
  -- Class A (own paper) and C (licensed feed) never live here — A is the market
  -- box's own register, C is a per-house credentialled feed.
  source_class VARCHAR(32) NOT NULL
    CHECK (source_class IN ('posted_wholesale_list', 'retail_reference', 'public_index')),

  -- WHERE it is a price. ISO-3166-2 where a state exists ('US-CA', 'US-IA'),
  -- so the free-text `restaurants.state_province` mess ('CA'/'California') is
  -- normalised to one key the endpoint can scope on.
  state VARCHAR(12) NOT NULL CHECK (state ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$'),
  -- The sub-state area a posting is filed for. CA posts per county; NULL where
  -- the source is state-wide. Part of the identity, never invented.
  region VARCHAR(80),

  -- WHO published it, by name. Free text: the issuer is an agency, not an FK.
  issuer VARCHAR(120) NOT NULL CHECK (btrim(issuer) <> ''),

  -- WHEN the ISSUER says this price took effect / was published. Never our
  -- fetch date. This is the column the staleness gate reads.
  issued_at DATE NOT NULL,
  -- When we read it, kept separate so a stale row can state its own age.
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- WHICH published number this is. 'Retailers' / 'Wholesalers' for a CA beer
  -- posting (the trade level); 'state_bottle_retail' for an Iowa shelf price.
  -- The thing that stops a manufacturer→wholesaler price being compared to a
  -- wholesaler→retailer one.
  price_basis VARCHAR(64) NOT NULL CHECK (btrim(price_basis) <> ''),

  -- Product identity AS POSTED. Not resolved to a house item — that join is the
  -- reader's job and a wrong guess here would corrupt the register.
  product_name VARCHAR(300) NOT NULL CHECK (btrim(product_name) <> ''),
  brand VARCHAR(200),          -- the trade name, where the source separates it
  producer VARCHAR(200),       -- manufacturer / supplier, as named by the issuer
  package_desc VARCHAR(120),   -- '4 x 6 Pack', '1 Keg', '24 Loose' — verbatim
  container_type VARCHAR(60),  -- 'Glass Bottle', 'Can', 'Keg'

  -- The container size, in the issuer's own unit. NULL, never 0, when the
  -- source did not state one — a zero volume is a division the register cannot
  -- defend (measured: 11 Iowa rows publish bottle_volume_ml = 0).
  size_value NUMERIC(10, 3) CHECK (size_value IS NULL OR size_value > 0),
  size_unit VARCHAR(16),

  -- The number.
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  -- What the price covers: 'per package', 'per bottle', 'per case'. Named, not
  -- assumed, so a per-case price is never read as a per-bottle one.
  price_unit VARCHAR(24) NOT NULL CHECK (btrim(price_unit) <> ''),
  -- Units per package where the source gives a clean integer; NULL where the
  -- package is descriptive ('24 Loose') and no honest integer exists.
  pack INTEGER CHECK (pack IS NULL OR pack > 0),

  -- A refundable deposit posted separately from price (CA keg/bottle charge).
  -- NULL when the source does not post one; 0 is a real "posted, and it is nil".
  container_charge NUMERIC(10, 2) CHECK (container_charge IS NULL OR container_charge >= 0),
  -- The source's own promotion flag, where it has one.
  is_promotion BOOLEAN NOT NULL DEFAULT FALSE,
  -- The source's own status string ('Active'), kept so a consumer can see it
  -- was the current posting and not a superseded one at fetch time.
  source_status VARCHAR(24),

  -- Required attribution text where the licence requires it (Iowa CC BY 4.0).
  -- NULL where the source declares no licence — unstated, never defaulted to
  -- permissive.
  attribution TEXT,

  -- Provenance for audit and re-fetch.
  source_url TEXT NOT NULL,
  -- Stable per-item key, for the dedup index below.
  source_ref VARCHAR(400) NOT NULL CHECK (btrim(source_ref) <> ''),
  -- sha256 of the price-bearing fields. A re-read of an unchanged posting hashes
  -- the same and dedups away; a changed price is a new row beside the old one.
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),

  -- The issuer's own identifiers (item_no, itemcode, posting id) and the raw
  -- posted row, for provenance. Never read for a decision.
  external_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The endpoint's read: this state, newest first, optionally one basis.
CREATE INDEX IF NOT EXISTS idx_price_index_postings_state_issued
  ON public.price_index_postings (state, issued_at DESC);

-- The status endpoint's read: per-source last fetch and count.
CREATE INDEX IF NOT EXISTS idx_price_index_postings_source
  ON public.price_index_postings (source_key, fetched_at DESC);

-- The founder's uniqueness: one row per (source_ref, content_hash). A re-fetch
-- of the same posting at the same price is discarded; a price change is a new
-- row. The scheduled writer binds ON CONFLICT to this, so it is NOT partial.
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_index_postings_ref_hash
  ON public.price_index_postings (source_ref, content_hash);

-- ---------------------------------------------------------------------------
-- 2. Lock it down in the SAME migration that creates it (OD-72 / OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.price_index_postings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS price_index_postings_service_role
  ON public.price_index_postings;
CREATE POLICY price_index_postings_service_role
  ON public.price_index_postings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.price_index_postings FROM anon, authenticated;

COMMENT ON TABLE public.price_index_postings IS
  'The public price INDEX register (ADR 0117 / ADR 0111): a state''s posted wholesale list, a control state''s shelf price, or a public index. Keyed by state, NOT by restaurant. Read by the market box as a labelled index line, never folded into a vendor-quote average. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.price_index_postings.state IS
  'ISO-3166-2 jurisdiction (US-CA). Normalised at write time from the free-text restaurants.state_province so the endpoint can scope a house to its own state.';
COMMENT ON COLUMN public.price_index_postings.issued_at IS
  'The ISSUER''s own effective/publication date, never the fetch date. The staleness gate reads this: a live 200 serving a year-old file must be refused, not parsed as current (the bh_fv020.txt case).';
COMMENT ON COLUMN public.price_index_postings.price_basis IS
  'WHICH published number this is — the trade level (CA Retailers/Wholesalers) or the named column (Iowa state_bottle_retail). Stops two trade levels being compared as one.';
COMMENT ON COLUMN public.price_index_postings.size_value IS
  'Container size in the issuer''s own unit, or NULL when unstated. Never 0 — a zero volume is a division the register cannot defend.';
COMMENT ON COLUMN public.price_index_postings.attribution IS
  'Required licence text where the source requires it (Iowa CC BY 4.0). NULL where the source declares no licence — unstated is recorded as unstated, never as permissive.';

-- ---------------------------------------------------------------------------
-- 3. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  absent_cols text;
  c           text;
  required    text[] := ARRAY[
    'id', 'source_key', 'source_class', 'state', 'region', 'issuer',
    'issued_at', 'fetched_at', 'price_basis', 'product_name', 'brand',
    'producer', 'package_desc', 'container_type', 'size_value', 'size_unit',
    'price', 'currency', 'price_unit', 'pack', 'container_charge',
    'is_promotion', 'source_status', 'attribution', 'source_url', 'source_ref',
    'content_hash', 'external_ids', 'raw', 'created_at'
  ];
  nullable_by_design text[] := ARRAY[
    'region', 'brand', 'producer', 'package_desc', 'container_type',
    'size_value', 'size_unit', 'pack', 'container_charge', 'source_status',
    'attribution'
  ];
BEGIN
  IF to_regclass('public.price_index_postings') IS NULL THEN
    RAISE EXCEPTION 'price_index_postings was not created';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = to_regclass('public.price_index_postings')) THEN
    RAISE EXCEPTION 'price_index_postings has RLS off';
  END IF;

  IF has_table_privilege('anon', 'public.price_index_postings', 'SELECT')
     OR has_table_privilege('anon', 'public.price_index_postings', 'INSERT')
     OR has_table_privilege('anon', 'public.price_index_postings', 'UPDATE')
     OR has_table_privilege('anon', 'public.price_index_postings', 'DELETE')
     OR has_table_privilege('authenticated', 'public.price_index_postings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.price_index_postings', 'INSERT')
     OR has_table_privilege('authenticated', 'public.price_index_postings', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.price_index_postings', 'DELETE')
  THEN
    RAISE EXCEPTION 'price_index_postings is still reachable by anon/authenticated';
  END IF;

  FOREACH c IN ARRAY required LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'price_index_postings'
        AND column_name = c
    ) THEN
      absent_cols := concat_ws(', ', absent_cols, c);
    END IF;
  END LOOP;

  IF absent_cols IS NOT NULL THEN
    RAISE EXCEPTION 'price_index_postings is missing columns the gateway reads: %', absent_cols;
  END IF;

  FOREACH c IN ARRAY nullable_by_design LOOP
    IF (SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'price_index_postings'
           AND column_name = c) <> 'YES' THEN
      RAISE EXCEPTION
        '% must be nullable — a field the issuer did not publish has no value', c;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'price_index_postings'
      AND indexname = 'uq_price_index_postings_ref_hash'
  ) THEN
    RAISE EXCEPTION 'the (source_ref, content_hash) uniqueness the writer binds to is missing';
  END IF;

  RAISE NOTICE 'price_index_postings created, RLS on, anon/authenticated revoked, column contract satisfied.';
END
$$;
