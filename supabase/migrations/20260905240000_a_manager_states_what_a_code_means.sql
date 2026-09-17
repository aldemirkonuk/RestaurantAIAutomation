-- A manager states what a sender's price code means, and every row it admits
-- names the mapping (ADR 0126 Q3; the founder, 2026-09-05: "Manager maps it,
-- recorded on every row").
--
-- WHY THIS TABLE EXISTS
-- --------------------
-- An EDI 832 price/sales catalogue prices each line under a `CTP02` Price
-- Identifier Code, and the X12 standard leaves that code list to the two
-- trading partners. Measured on 2026-09-05 from two published implementation
-- guides: CDW's defines `C01` as literally "CDW Price"; SPS Commerce's MSSS
-- guide uses `CON` and `CAT` out of a list its own guide says holds 164. There
-- is no universal "the licensee price". `parse-edi832.ts` therefore refuses
-- every code it has not been told about (`unmapped_price_basis`), and that
-- refusal is a dead end for a manager holding a perfectly good file from their
-- own distributor.
--
-- The founder's answer is that the manager may say what the code means, once,
-- and that the saying is recorded on every row the mapping admits. This table
-- is the saying.
--
-- WHAT IT DELIBERATELY IS NOT
-- ---------------------------
--  * NOT a catalogue Mudavym maintains. There is no seeded row here and no
--    default anywhere in the stack: a code nobody has mapped is refused, which
--    is the posture before this migration and stays the posture after it. A
--    shipped guess at what `CON` means would be a trade level this product
--    invented, filed against a house's real money.
--  * NOT deletable once it has admitted a row. `vendor_price_observations
--    .price_code_mapping_id` is ON DELETE RESTRICT, so the provenance of a
--    price cannot be erased by removing the mapping that let it in. A mapping
--    is WITHDRAWN, and the rows it admitted are then found by one join.
--
-- HOW A WRONG MAPPING IS FOUND AND REVERSED, IN ONE QUERY
-- ------------------------------------------------------
--     SELECT v.*
--       FROM public.vendor_price_observations v
--       JOIN public.distributor_price_code_mappings m
--         ON m.id = v.price_code_mapping_id
--      WHERE m.id = $1;                          -- every row this mapping admitted
--
-- and the mark a withdrawal leaves is the same join with
-- `m.withdrawn_at IS NOT NULL`. The mark is DERIVED rather than stamped onto
-- each row on purpose: a stamped flag needs a backfill that can half-succeed,
-- and it can then disagree with the mapping it is supposed to reflect. One
-- place holds the truth, and no row is ever deleted or rewritten by a
-- withdrawal.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. The mapping
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.distributor_price_code_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Whose statement this is. A trade level is negotiated per licence, so one
  -- house's reading of `CON` is not another's and this is never shared.
  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- The sender, by the key `distributor-feed.registry.ts` uses
  -- ('breakthru-il', 'southern-glazers-il', …). Free text rather than an FK:
  -- the registry is a config file, not a table, for the reasons recorded in
  -- `price-reference-shops.ts` and repeated in ADR 0126.
  distributor_key VARCHAR(80) NOT NULL CHECK (btrim(distributor_key) <> ''),

  -- WHICH field of WHICH format the code belongs to. A CHECK rather than free
  -- text, so a second format cannot be added by a typo: adding one is a
  -- migration and a decision. `edi_832_ctp02` is the only member today because
  -- the 832 is the only format this repo parses; there is no CSV feed path.
  code_field VARCHAR(32) NOT NULL
    CHECK (code_field IN ('edi_832_ctp02')),

  -- The sender's own code, verbatim, upper-cased. The CHECK enforces the
  -- normalisation rather than trusting the writer, so 'con' and 'CON ' can
  -- never become two live mappings for one code.
  price_code VARCHAR(16) NOT NULL
    CHECK (price_code = upper(btrim(price_code)) AND btrim(price_code) <> ''),

  -- What the manager says it means, in the manager's own words. This becomes
  -- `vendor_price_observations.source_ref`'s companion and the sighting's
  -- price basis. NO DEFAULT AT ANY LAYER — table, DTO or UI. A default here
  -- would be this product naming a trade level it was never told.
  price_basis VARCHAR(64) NOT NULL CHECK (btrim(price_basis) <> ''),

  -- The manager's own account of HOW they know. Required, because "somebody
  -- typed it" and "the distributor's implementation guide, page 7" are
  -- different qualities of evidence and a reader must be able to tell them
  -- apart a year later.
  evidence TEXT NOT NULL CHECK (btrim(evidence) <> ''),

  -- WHO said it and WHEN. `public.users`, never `auth.users`: the two tables
  -- are disjoint on this deployment and the JWT carries `public.users.user_id`,
  -- so an actor FK to `auth.users` 23503s on every write.
  declared_by UUID NOT NULL
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  -- The name AS IT WAS when the statement was made. Stored, not joined: this
  -- is an attestation, and a person renamed next year did not make a different
  -- statement. The FK above is what a reader follows to the live account.
  declared_by_name VARCHAR(200) NOT NULL CHECK (btrim(declared_by_name) <> ''),
  declared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The withdrawal. All three or none: a withdrawal with no reason is a row
  -- that stopped working and cannot say why.
  withdrawn_by UUID REFERENCES public.users(user_id) ON DELETE RESTRICT,
  withdrawn_at TIMESTAMPTZ,
  withdrawn_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT distributor_price_code_mappings_withdrawal_is_whole CHECK (
    (withdrawn_at IS NULL AND withdrawn_by IS NULL AND withdrawn_reason IS NULL)
    OR (withdrawn_at IS NOT NULL
        AND withdrawn_by IS NOT NULL
        AND btrim(coalesce(withdrawn_reason, '')) <> '')
  ),
  CONSTRAINT distributor_price_code_mappings_withdrawn_after_declared CHECK (
    withdrawn_at IS NULL OR withdrawn_at >= declared_at
  )
);

-- One LIVE statement per (house, sender, field, code). A withdrawn one stays
-- and frees the key, so a house that got it wrong can say so and then say the
-- right thing without either statement being erased.
CREATE UNIQUE INDEX IF NOT EXISTS uq_distributor_price_code_mappings_live
  ON public.distributor_price_code_mappings
     (restaurant_id, distributor_key, code_field, price_code)
  WHERE withdrawn_at IS NULL;

-- The reader's query: what has this house mapped for this sender.
CREATE INDEX IF NOT EXISTS idx_distributor_price_code_mappings_house
  ON public.distributor_price_code_mappings
     (restaurant_id, distributor_key, declared_at DESC);

ALTER TABLE public.distributor_price_code_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS distributor_price_code_mappings_service_role
  ON public.distributor_price_code_mappings;
CREATE POLICY distributor_price_code_mappings_service_role
  ON public.distributor_price_code_mappings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.distributor_price_code_mappings FROM anon, authenticated;

COMMENT ON TABLE public.distributor_price_code_mappings IS
  'A manager''s statement of what one distributor''s price-identifier code means for this house. No seeded rows and no default: an unmapped code is refused. Withdrawn, never deleted; the rows a mapping admitted are found by joining vendor_price_observations.price_code_mapping_id (ADR 0126).';

-- ---------------------------------------------------------------------------
-- 2. The row a mapping admits names it
-- ---------------------------------------------------------------------------

ALTER TABLE public.vendor_price_observations
  ADD COLUMN IF NOT EXISTS price_code_mapping_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'vendor_price_observations_price_code_mapping_fk'
       AND conrelid = to_regclass('public.vendor_price_observations')
  ) THEN
    -- RESTRICT, not SET NULL and not CASCADE. Erasing the mapping id would
    -- erase the answer to "who told us this was the licensee price", which is
    -- the only question anyone asks after a bad price reaches a screen.
    ALTER TABLE public.vendor_price_observations
      ADD CONSTRAINT vendor_price_observations_price_code_mapping_fk
      FOREIGN KEY (price_code_mapping_id)
      REFERENCES public.distributor_price_code_mappings(id) ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_vpo_price_code_mapping
  ON public.vendor_price_observations (price_code_mapping_id)
  WHERE price_code_mapping_id IS NOT NULL;

COMMENT ON COLUMN public.vendor_price_observations.price_code_mapping_id IS
  'The manager statement that admitted this row''s trade level (distributor_price_code_mappings). NULL on every row that came from anywhere else. A withdrawal marks these rows by join, never by rewriting them (ADR 0126).';

-- ---------------------------------------------------------------------------
-- 3. Assertions — the CHECKs and the index are exercised, not merely written
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  probe_user UUID;
  probe_restaurant UUID;
  first_id UUID;
  second_id UUID;
  admitted_blank BOOLEAN;
  admitted_lowercase BOOLEAN;
  admitted_half_withdrawal BOOLEAN;
  admitted_duplicate BOOLEAN;
BEGIN
  IF to_regclass('public.distributor_price_code_mappings') IS NULL THEN
    RAISE EXCEPTION 'distributor_price_code_mappings was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'vendor_price_observations'
       AND column_name = 'price_code_mapping_id'
  ) THEN
    RAISE EXCEPTION
      'vendor_price_observations.price_code_mapping_id is missing; a row admitted by a mapping would have nowhere to name it';
  END IF;

  -- No default on the meaning, at the one layer that can enforce it.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'distributor_price_code_mappings'
       AND column_name = 'price_basis'
       AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'distributor_price_code_mappings.price_basis has acquired a DEFAULT; a default trade level is this product naming a price it was never told';
  END IF;

  SELECT user_id INTO probe_user FROM public.users LIMIT 1;
  SELECT id INTO probe_restaurant FROM public.restaurants LIMIT 1;

  IF probe_user IS NULL OR probe_restaurant IS NULL THEN
    RAISE NOTICE
      'no user or restaurant row exists here, so the CHECKs and the live-uniqueness index were created but not exercised. They are exercised by the PGlite probe and by the jest suite against the same predicates.';
  ELSE
    -- (a) A blank meaning is refused.
    BEGIN
      INSERT INTO public.distributor_price_code_mappings
        (restaurant_id, distributor_key, code_field, price_code, price_basis,
         evidence, declared_by, declared_by_name)
      VALUES (probe_restaurant, 'probe-distributor', 'edi_832_ctp02', 'PRB',
              '   ', 'probe', probe_user, 'Probe Manager');
      admitted_blank := true;
    EXCEPTION WHEN check_violation THEN
      admitted_blank := false;
    END;
    IF admitted_blank THEN
      RAISE EXCEPTION
        'a mapping was admitted with a blank price_basis; an empty meaning is not a meaning';
    END IF;

    -- (b) An un-normalised code is refused, so one code cannot wear two rows.
    BEGIN
      INSERT INTO public.distributor_price_code_mappings
        (restaurant_id, distributor_key, code_field, price_code, price_basis,
         evidence, declared_by, declared_by_name)
      VALUES (probe_restaurant, 'probe-distributor', 'edi_832_ctp02', 'prb',
              'probe basis', 'probe', probe_user, 'Probe Manager');
      admitted_lowercase := true;
    EXCEPTION WHEN check_violation THEN
      admitted_lowercase := false;
    END;
    IF admitted_lowercase THEN
      RAISE EXCEPTION
        'a lowercase price_code was admitted; ''con'' and ''CON'' would become two live mappings for one code';
    END IF;

    -- (c) A live mapping, then its duplicate, refused by the partial index.
    INSERT INTO public.distributor_price_code_mappings
      (restaurant_id, distributor_key, code_field, price_code, price_basis,
       evidence, declared_by, declared_by_name)
    VALUES (probe_restaurant, 'probe-distributor', 'edi_832_ctp02', 'PRB',
            'probe basis', 'probe evidence', probe_user, 'Probe Manager')
    RETURNING id INTO first_id;

    BEGIN
      INSERT INTO public.distributor_price_code_mappings
        (restaurant_id, distributor_key, code_field, price_code, price_basis,
         evidence, declared_by, declared_by_name)
      VALUES (probe_restaurant, 'probe-distributor', 'edi_832_ctp02', 'PRB',
              'a second meaning', 'probe evidence', probe_user, 'Probe Manager');
      admitted_duplicate := true;
    EXCEPTION WHEN unique_violation THEN
      admitted_duplicate := false;
    END;
    IF admitted_duplicate THEN
      RAISE EXCEPTION
        'two live mappings were admitted for one code; the parser would then have to choose a trade level, which is the thing it must never do';
    END IF;

    -- (d) A half-withdrawal is refused.
    BEGIN
      UPDATE public.distributor_price_code_mappings
         SET withdrawn_at = NOW()
       WHERE id = first_id;
      admitted_half_withdrawal := true;
    EXCEPTION WHEN check_violation THEN
      admitted_half_withdrawal := false;
    END;
    IF admitted_half_withdrawal THEN
      RAISE EXCEPTION
        'a mapping was withdrawn with no withdrawer and no reason; a row that stopped working must say why';
    END IF;

    -- (e) A whole withdrawal is accepted AND frees the key for a new statement.
    UPDATE public.distributor_price_code_mappings
       SET withdrawn_at = NOW(),
           withdrawn_by = probe_user,
           withdrawn_reason = 'probe'
     WHERE id = first_id;

    INSERT INTO public.distributor_price_code_mappings
      (restaurant_id, distributor_key, code_field, price_code, price_basis,
       evidence, declared_by, declared_by_name)
    VALUES (probe_restaurant, 'probe-distributor', 'edi_832_ctp02', 'PRB',
            'the corrected meaning', 'probe evidence', probe_user, 'Probe Manager')
    RETURNING id INTO second_id;

    DELETE FROM public.distributor_price_code_mappings
     WHERE id IN (first_id, second_id);
  END IF;

  RAISE NOTICE
    'distributor_price_code_mappings created (RLS on, anon/authenticated revoked, no default on price_basis, one LIVE mapping per code, a withdrawal is whole); vendor_price_observations.price_code_mapping_id added ON DELETE RESTRICT.';
END
$$;
