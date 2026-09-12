-- A bottle has one identity, and every price names it (ADR 0124).
--
-- WHY A REGISTER AND NOT COLUMNS ON master_wine_library
-- ----------------------------------------------------
-- Measured read-only on production (project exzueerziesmczwlhomd) 2026-09-05:
--
--   master_wine_library     4,226 rows.  upc 0.  ean 0.  barcode 0.
--                           manufacturer_sku 0.  distributor_skus 0.  sku 1.
--                           bottle_size_ml is 750 on ALL 4,226 -- one distinct
--                           value, i.e. the column DEFAULT, never a reading.
--                           Only 2 of 3,562 live rows name a format in `name`.
--   restaurant_inventory    206 rows, and NO barcode/upc column at all;
--                           bottle_size_ml known on 51 (47 x 750, 4 x 375).
--   beverages               608 rows.  upc 0.  ean 0.  barcode 0.  sku 0.
--   vendor_price_observations 0 rows.  price_history 0 rows.
--   procurement_order_items 1 row, 0 with a upc.
--
-- So the library cannot BE the identity register: it does not know the size of
-- a single bottle it holds, and it can hold only one size per row. A wine sold
-- in 750 ml and in magnum is two trade items and one library row. Identity
-- therefore lives beside the library, is asserted rather than derived, and a
-- library row reaches it through a KEY like any other source (namespace
-- 'mudavym:master_wine_library'), so one row may name several identities and
-- several rows may name one.
--
-- WHY THE KEYS TABLE DOES NOT MAKE (namespace, value) UNIQUE
-- ----------------------------------------------------------
-- Because a GTIN is evidence, not proof, and this was measured rather than
-- assumed. The Iowa Liquor Products file was fetched live on 2026-09-05
-- (https://idh-be.iowa.gov/api/v1/datasets/1029/rows.json, 5,425,785 bytes,
-- report_as_of 2026-09-01 on all 13,762 rows): `upc` is present on 100% of
-- rows and every one is 12 digits -- and there are only 9,118 distinct values.
-- 1,736 UPCs name MORE THAN ONE distinct item_no (4,069 items), 343 of those
-- collisions span different bottle volumes, and one UPC (081128001032) is
-- published against a 50 ml Van Gogh sampler, a second 50 ml Van Gogh sampler
-- and a 1,000 ml Woodford Reserve from a different supplier. A UNIQUE index
-- here would have forced a writer to pick one of the three. Instead the key may
-- name several identities, and `joinByExactKey` REFUSES an ambiguous key and
-- queues it for a person. Absence of ambiguity is not something this schema is
-- allowed to assert on the trade's behalf.
--
-- WHAT IS DELIBERATELY NOT DONE HERE
-- ----------------------------------
-- No backfill. Not one row is written by this migration. There is nothing to
-- backfill from: every identity column in the estate is empty, and the one
-- column that is full (bottle_size_ml = 750) is full of a default. A backfill
-- would be this repo's standing fault -- absence reported as health -- written
-- into 4,226 rows at once.
--
-- Additive and idempotent. No explicit BEGIN/COMMIT: the Supabase CLI wraps
-- each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. The register: one row per distinct TRADE ITEM.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.beverage_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The four parts LWIN-18 decomposes a bottle into (wine, vintage, pack,
  -- size), which is also what GS1 says makes a new trade item: a change to the
  -- declared net content or to the pack quantity requires a new GTIN
  -- (GTIN Management Standard 1.1, Sep 2023, sections 2.3 and 2.8).
  producer_normalised TEXT NOT NULL CHECK (btrim(producer_normalised) <> ''),
  name_normalised     TEXT NOT NULL CHECK (btrim(name_normalised) <> ''),

  -- THREE answers, not two. 'nv' is an assertion that this bottle carries no
  -- vintage (true of most spirits and much Champagne); 'unstated' is the
  -- source's silence. Collapsing them would turn a missing reading into a
  -- claim about the bottle.
  vintage_text VARCHAR(8) NOT NULL
    CHECK (vintage_text ~ '^(nv|unstated|[0-9]{4})$'),

  -- NULL means unstated. NEVER 750: the library's 750 is a column default and
  -- this register exists partly to stop that default being read as a fact.
  size_ml INTEGER CHECK (size_ml IS NULL OR size_ml > 0),
  -- Bottles per trade item. NULL means unstated; 1 is a real "sold singly".
  pack    INTEGER CHECK (pack IS NULL OR pack > 0),

  -- The comparison key, and the answer to ADR 0119 Q7 by construction: format
  -- is PART OF the key rather than a scale factor, so a 12 x 375 case and a
  -- 6 x 750 case can no longer normalise to one per-750 number. The 'size?'
  -- and 'pack?' markers keep an unstated part VISIBLE in the key instead of
  -- silently equal to some default. Generated, so it can never drift from the
  -- columns, and mirrored by buildIdentityKey() in beverage-identity.ts.
  identity_key TEXT GENERATED ALWAYS AS (
    producer_normalised || '|' || name_normalised || '|' || vintage_text
      || '|' || COALESCE(size_ml::text, 'size?')
      || '|' || COALESCE(pack::text, 'pack?')
  ) STORED,

  -- Liv-ex's LWIN, when someone has one. 7 / 11 / 16 / 18 digit forms only.
  -- The database is CC BY 4.0 (https://www.liv-ex.com/lwin/lwin-creative-commons/,
  -- read 2026-09-05), so a row derived from it must carry the attribution.
  lwin VARCHAR(18) CHECK (
    lwin IS NULL OR lwin ~ '^([0-9]{7}|[0-9]{11}|[0-9]{16}|[0-9]{18})$'
  ),
  lwin_attribution TEXT,

  -- What a person should read. Kept beside the normalised parts because the
  -- normalised parts are for machines and are unreadable on purpose.
  display_label VARCHAR(300) NOT NULL CHECK (btrim(display_label) <> ''),

  -- PROVENANCE OF THE ASSERTION ITSELF. An identity is a claim somebody made,
  -- and this repo's rule is that a claim names its maker. `asserted_by` is
  -- NULL for a machine assertion and `assertion_method` says which machine.
  asserted_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  asserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assertion_method VARCHAR(48) NOT NULL
    CHECK (assertion_method IN (
      'person',            -- a human typed or confirmed it
      'exact_key',         -- an unambiguous GTIN / LWIN said so
      'source_transcript', -- copied verbatim from a recorded source file
      'import'             -- a one-off load, named in assertion_note
    )),
  -- 0..1. NULL where the method does not produce one (a person is not a score).
  assertion_confidence NUMERIC(4, 3)
    CHECK (assertion_confidence IS NULL
           OR (assertion_confidence >= 0 AND assertion_confidence <= 1)),
  assertion_note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One identity per distinct trade item. This is the only uniqueness in the
-- design that is safe to assert, because it is a statement about OUR key, not
-- about the trade's codes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_beverage_identities_key
  ON public.beverage_identities (identity_key);

-- The candidate generator blocks on the producer before it scores anything.
CREATE INDEX IF NOT EXISTS idx_beverage_identities_producer
  ON public.beverage_identities (producer_normalised);

-- ---------------------------------------------------------------------------
-- 2. The keys: many per identity, and a key may name more than one identity.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.beverage_identity_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  identity_id UUID NOT NULL
    REFERENCES public.beverage_identities(id) ON DELETE RESTRICT,

  -- 'gtin', 'lwin', 'ttb_cola', or 'source:<source_key>' /
  -- 'mudavym:<table>' for a code that is only meaningful inside one source.
  -- A NEW SOURCE ADDS A ROW HERE, NEVER A COLUMN ANYWHERE. That is the whole
  -- scalability argument for this table.
  key_namespace VARCHAR(64) NOT NULL
    CHECK (key_namespace ~ '^[a-z0-9]+(:[a-z0-9][a-z0-9_.-]*)?$'),

  -- Whether the namespace is meant to be unique across the whole trade
  -- ('global_standard': GTIN, LWIN, TTB COLA) or only inside its own source
  -- ('source_local': an Iowa item_no, a Michigan liquor code, our own uuid).
  -- The joiner treats the two differently and says which it used.
  key_class VARCHAR(16) NOT NULL
    CHECK (key_class IN ('global_standard', 'source_local')),

  -- Stored in the source's own canonical form. A GTIN is normalised to its
  -- 14-digit form with the check digit VERIFIED before it gets here; anything
  -- that fails the check digit is refused rather than stored as a bad key.
  key_value VARCHAR(200) NOT NULL CHECK (btrim(key_value) <> ''),

  asserted_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  asserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assertion_method VARCHAR(48) NOT NULL
    CHECK (assertion_method IN ('person', 'exact_key', 'source_transcript', 'import')),
  assertion_confidence NUMERIC(4, 3)
    CHECK (assertion_confidence IS NULL
           OR (assertion_confidence >= 0 AND assertion_confidence <= 1)),
  -- Where this key was read: a file URL plus the row, a page URL, an invoice id.
  source_ref TEXT,
  note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The same assertion twice is one row. NOT unique on (namespace, value): see
-- the header -- 1,736 measured Iowa UPCs name more than one product, and a
-- unique index would force a writer to choose one of them silently.
CREATE UNIQUE INDEX IF NOT EXISTS uq_beverage_identity_keys_assertion
  ON public.beverage_identity_keys (key_namespace, key_value, identity_id);

-- The joiner's read: "which identities does this key name?"
CREATE INDEX IF NOT EXISTS idx_beverage_identity_keys_lookup
  ON public.beverage_identity_keys (key_namespace, key_value);

CREATE INDEX IF NOT EXISTS idx_beverage_identity_keys_identity
  ON public.beverage_identity_keys (identity_id);

-- ---------------------------------------------------------------------------
-- 3. The queue: a proposed link, waiting for a person.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.beverage_identity_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- WHAT is being linked. A table name and a row id rather than five nullable
  -- FKs, so a new subject needs no migration -- the same reason the keys table
  -- has a namespace instead of a column per standard.
  subject_table VARCHAR(64) NOT NULL
    CHECK (subject_table IN (
      'master_wine_library',
      'beverages',
      'restaurant_inventory',
      'vendor_price_observations',
      'price_index_postings'
    )),
  subject_id UUID NOT NULL,
  -- Present for tenant-scoped subjects so the queue can be shown to the house
  -- it belongs to; NULL for the public registers.
  restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,

  identity_id UUID NOT NULL
    REFERENCES public.beverage_identities(id) ON DELETE RESTRICT,

  -- How the proposal was made and how much it is worth. NEVER a threshold that
  -- auto-merges: `status` starts 'pending' whatever the confidence is.
  method VARCHAR(48) NOT NULL
    CHECK (method IN ('exact_key_ambiguous', 'normalised_key', 'person')),
  confidence NUMERIC(4, 3) NOT NULL
    CHECK (confidence >= 0 AND confidence <= 1),
  -- Which parts agreed, which disagreed, which were unstated. The reason the
  -- person can decide in a second instead of re-deriving the match.
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,

  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'rejected')),
  decided_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A pending row has NO decision recorded, and a decided row is DATED.
  --
  -- Stated precisely, because the loose version would be a lie: `decided_by`
  -- is ON DELETE SET NULL, so a decision by a person who later leaves keeps
  -- its date and loses its name, and a NOT NULL here would either block that
  -- delete or force a fake author. The service refuses a decision with no user
  -- id (`IdentityService.decide`), so a NULL `decided_by` on a decided row
  -- means "the person was removed", never "nobody decided". That is the
  -- distinction ADR 0117 Q26 found missing on `providers.verified_at`.
  CONSTRAINT bic_decision_is_dated CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status <> 'pending' AND decided_at IS NOT NULL)
  )
);

-- One live proposal per (subject, identity). A re-run must not stack duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_beverage_identity_candidates_pair
  ON public.beverage_identity_candidates (subject_table, subject_id, identity_id);

-- The queue read: what is waiting, newest first.
CREATE INDEX IF NOT EXISTS idx_beverage_identity_candidates_pending
  ON public.beverage_identity_candidates (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_beverage_identity_candidates_house
  ON public.beverage_identity_candidates (restaurant_id, status)
  WHERE restaurant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. The link itself, nullable everywhere, never guessed.
-- ---------------------------------------------------------------------------
-- A row with no confirmed identity stays unjoined and the reader says so. That
-- is why every one of these is NULLABLE and none is backfilled.

ALTER TABLE public.restaurant_inventory
  ADD COLUMN IF NOT EXISTS identity_id UUID
    REFERENCES public.beverage_identities(id) ON DELETE RESTRICT;

ALTER TABLE public.vendor_price_observations
  ADD COLUMN IF NOT EXISTS identity_id UUID
    REFERENCES public.beverage_identities(id) ON DELETE RESTRICT;

ALTER TABLE public.price_index_postings
  ADD COLUMN IF NOT EXISTS identity_id UUID
    REFERENCES public.beverage_identities(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_vpo_identity
  ON public.vendor_price_observations (identity_id, observed_at DESC)
  WHERE identity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_price_index_postings_identity
  ON public.price_index_postings (identity_id, issued_at DESC)
  WHERE identity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_identity
  ON public.restaurant_inventory (identity_id)
  WHERE identity_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Lock the new tables down in the SAME migration that creates them
--    (OD-72 / OD-73, and scripts/check_new_tables_are_locked_down.py).
-- ---------------------------------------------------------------------------

ALTER TABLE public.beverage_identities            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beverage_identity_keys         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beverage_identity_candidates   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS beverage_identities_service_role ON public.beverage_identities;
CREATE POLICY beverage_identities_service_role
  ON public.beverage_identities FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS beverage_identity_keys_service_role ON public.beverage_identity_keys;
CREATE POLICY beverage_identity_keys_service_role
  ON public.beverage_identity_keys FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS beverage_identity_candidates_service_role ON public.beverage_identity_candidates;
CREATE POLICY beverage_identity_candidates_service_role
  ON public.beverage_identity_candidates FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.beverage_identities          FROM anon, authenticated;
REVOKE ALL ON public.beverage_identity_keys       FROM anon, authenticated;
REVOKE ALL ON public.beverage_identity_candidates FROM anon, authenticated;

COMMENT ON TABLE public.beverage_identities IS
  'One row per distinct TRADE ITEM (producer, name, vintage, size, pack) -- ADR 0124. Not one row per wine: a wine sold in 750 ml and in magnum is two trade items (GS1 GTIN Management Standard 1.1 s2.3/s2.8) and one master_wine_library row. Every row is an ASSERTION carrying who made it, how and when. RLS on, service_role only.';
COMMENT ON COLUMN public.beverage_identities.identity_key IS
  'The comparison key. Format is PART OF the key, not a scale factor (ADR 0119 Q7): a 12 x 375 case and a 6 x 750 case are two keys. ''size?''/''pack?'' keep an unstated part visible rather than defaulted.';
COMMENT ON COLUMN public.beverage_identities.vintage_text IS
  'Three answers: a year, ''nv'' (asserted non-vintage) or ''unstated'' (the source was silent). Never collapse the last two -- one is a fact about the bottle, the other a fact about our reading.';
COMMENT ON COLUMN public.beverage_identities.size_ml IS
  'NULL where unstated. Never defaulted to 750: measured 2026-09-05, master_wine_library.bottle_size_ml is 750 on all 4,226 rows because that is the column default, and only 2 of 3,562 live rows name a format anywhere.';
COMMENT ON TABLE public.beverage_identity_keys IS
  'Every code that names an identity: GTIN, LWIN, TTB COLA, a source item code, our own row ids. Deliberately NOT unique on (namespace, value) -- measured 2026-09-05, 1,736 of Iowa''s 9,118 distinct UPCs name more than one product and 343 of those span different bottle volumes, so an exact key is evidence and the joiner refuses an ambiguous one.';
COMMENT ON TABLE public.beverage_identity_candidates IS
  'Proposed identity links awaiting a person. Nothing is ever auto-merged: status starts ''pending'' at every confidence, and a decided row must name who decided it.';
COMMENT ON COLUMN public.restaurant_inventory.identity_id IS
  'The trade item this house item is (ADR 0124, beside ADR 0115''s house-item key). Nullable and never guessed: an unjoined row stays unjoined and the reader says so.';
COMMENT ON COLUMN public.vendor_price_observations.identity_id IS
  'The trade item this sighting prices (ADR 0124). NULL means the sighting has no confirmed identity; readers fall back to master_wine_id/signature_hash and state which key they grouped on.';
COMMENT ON COLUMN public.price_index_postings.identity_id IS
  'The trade item this posting prices (ADR 0124). NULL means the posted product has not been identified -- the register keeps the identity AS POSTED either way.';

-- ---------------------------------------------------------------------------
-- 6. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t           text;
  c           text;
  absent      text;
  new_tables  text[] := ARRAY[
    'beverage_identities', 'beverage_identity_keys', 'beverage_identity_candidates'
  ];
  required    text[] := ARRAY[
    'beverage_identities.identity_key',
    'beverage_identities.vintage_text',
    'beverage_identities.size_ml',
    'beverage_identities.pack',
    'beverage_identities.lwin',
    'beverage_identities.assertion_method',
    'beverage_identity_keys.key_namespace',
    'beverage_identity_keys.key_class',
    'beverage_identity_keys.key_value',
    'beverage_identity_candidates.subject_table',
    'beverage_identity_candidates.subject_id',
    'beverage_identity_candidates.confidence',
    'beverage_identity_candidates.status',
    'restaurant_inventory.identity_id',
    'vendor_price_observations.identity_id',
    'price_index_postings.identity_id'
  ];
  probe_a     uuid;
  probe_b     uuid;
  gen_key     text;
BEGIN
  FOREACH t IN ARRAY new_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '% was not created', t;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t)) THEN
      RAISE EXCEPTION '% has RLS off', t;
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT')
       OR has_table_privilege('anon', 'public.' || t, 'UPDATE')
       OR has_table_privilege('anon', 'public.' || t, 'DELETE')
       OR has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE')
    THEN
      RAISE EXCEPTION '% is still reachable by anon/authenticated', t;
    END IF;
  END LOOP;

  FOREACH c IN ARRAY required LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = split_part(c, '.', 1)
        AND column_name = split_part(c, '.', 2)
    ) THEN
      absent := concat_ws(', ', absent, c);
    END IF;
  END LOOP;
  IF absent IS NOT NULL THEN
    RAISE EXCEPTION 'columns the gateway reads are missing: %', absent;
  END IF;

  -- Every identity_id must be NULLABLE. A NOT NULL here would force a guess on
  -- 206 inventory rows that have no identity and cannot honestly be given one.
  FOREACH c IN ARRAY ARRAY['restaurant_inventory', 'vendor_price_observations',
                           'price_index_postings'] LOOP
    IF (SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = c
           AND column_name = 'identity_id') <> 'YES' THEN
      RAISE EXCEPTION '%.identity_id must be nullable -- an unjoined row is a real state', c;
    END IF;
  END LOOP;

  -- Nothing was backfilled. If a later edit adds an INSERT above, this fails.
  IF (SELECT count(*) FROM public.beverage_identities) <> 0
     OR (SELECT count(*) FROM public.beverage_identity_keys) <> 0
     OR (SELECT count(*) FROM public.beverage_identity_candidates) <> 0 THEN
    RAISE EXCEPTION 'this migration must not write rows -- every identity is an assertion someone makes';
  END IF;

  -- PROVE the two properties the design rests on, then roll the probes back.
  -- (a) the generated key separates two formats of the same wine;
  -- (b) one key value may name both of them.
  INSERT INTO public.beverage_identities
    (producer_normalised, name_normalised, vintage_text, size_ml, pack,
     display_label, assertion_method)
  VALUES ('probe producer', 'probe wine', '2019', 750, 1,
          'Probe Wine 2019', 'source_transcript')
  RETURNING id, identity_key INTO probe_a, gen_key;

  IF gen_key <> 'probe producer|probe wine|2019|750|1' THEN
    RAISE EXCEPTION 'identity_key generated as %, which buildIdentityKey() does not produce', gen_key;
  END IF;

  INSERT INTO public.beverage_identities
    (producer_normalised, name_normalised, vintage_text, size_ml, pack,
     display_label, assertion_method)
  VALUES ('probe producer', 'probe wine', '2019', 1500, 1,
          'Probe Wine 2019 Magnum', 'source_transcript')
  RETURNING id INTO probe_b;

  IF probe_a = probe_b THEN
    RAISE EXCEPTION 'a magnum collapsed into the 750 -- format is not part of the key';
  END IF;

  INSERT INTO public.beverage_identity_keys
    (identity_id, key_namespace, key_class, key_value, assertion_method)
  VALUES (probe_a, 'gtin', 'global_standard', '00081128001032', 'source_transcript'),
         (probe_b, 'gtin', 'global_standard', '00081128001032', 'source_transcript');

  IF (SELECT count(*) FROM public.beverage_identity_keys
       WHERE key_namespace = 'gtin' AND key_value = '00081128001032') <> 2 THEN
    RAISE EXCEPTION 'one GTIN could not name two identities -- the Iowa case is unrepresentable';
  END IF;

  DELETE FROM public.beverage_identity_keys WHERE identity_id IN (probe_a, probe_b);
  DELETE FROM public.beverage_identities WHERE id IN (probe_a, probe_b);

  IF (SELECT count(*) FROM public.beverage_identities) <> 0
     OR (SELECT count(*) FROM public.beverage_identity_keys) <> 0 THEN
    RAISE EXCEPTION 'the probes did not roll back';
  END IF;

  RAISE NOTICE 'beverage_identities/_keys/_candidates created, RLS on, anon+authenticated revoked, identity_id added nullable to 3 registers, 0 rows written, key generation and GTIN ambiguity both proved.';
END
$$;
