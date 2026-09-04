-- The house item is the ledger's key, and it is the row the house already has.
--
-- *** GATED. DO NOT APPLY. ***
-- ----------------------------
-- This file is PHASE 1 of ADR 0115, whose status is `Proposed`. It lands only
-- when the founder locks that ADR **and** the phase-2 code below is in the same
-- change. Applying it alone is not merely premature, it is unsafe for one
-- concrete reason named at the bottom of this header.
--
-- WHAT THIS DOES
-- --------------
-- OD-113, the non-wine inventory identity axis, decided 2026-09-03: **one house
-- item id across all beverages** — the house item is the key for stock, par,
-- counts and orders, and a wine's library link becomes an attribute.
--
-- The measurement that chose the shape: that key already exists. Stock is
-- `restaurant_inventory.stock_live`, par is `.threshold_min`, a count is
-- `stock_counts.inventory_id`, an order is `procurement_order_items.inventory_id`
-- / `procurement_orders.inventory_id` / `recurring_orders.inventory_id` /
-- `rfq_requests.inventory_id`, and the POS bridge maps to `inventory_id` on 239
-- of its 254 production rows. All four of the founder's nouns key on
-- `restaurant_inventory.id` today. The only thing keeping a keg out of it is
--
--     master_wine_id uuid NOT NULL
--     (20260805000000_baseline_from_production.sql:3262)
--
-- and nothing else. So this migration does not build a second key beside a key
-- that already does the job. It relaxes the one that does, and gives the row the
-- four facts it needs to describe something that is not a wine.
--
-- WHY THERE IS NO NEW TABLE
-- -------------------------
-- A `house_items` table was the leading shape and did not survive its own
-- adversarial pass. It requires a `house_item_id` on eighteen foreign-key
-- dependents and a dual-write window across 199 gateway call sites, 19 database
-- functions and 6 views — a period in which a write path that sets one key and
-- forgets the other produces a row that looks correct and is invisible to half
-- the readers. That is this repo's named cardinal fault, industrialised. The
-- naming win it buys is bought here for nothing by a view (§6 below).
-- `beverages` as the parent was refused on four grounds; see ADR 0115 §H2.
--
-- WHAT WAS MEASURED, NOT REASONED
-- -------------------------------
-- Executed against a full local build of every migration file (0 failures),
-- inside a transaction, then rolled back:
--
--   * DROP NOT NULL on restaurant_inventory.master_wine_id succeeds.
--   * TWO rows with a NULL master_wine_id insert cleanly for one restaurant --
--     the existing UNIQUE (restaurant_id, master_wine_id) treats NULLs as
--     distinct, so it keeps its one-row-per-wine guarantee AND admits non-wine
--     rows with no constraint change at all. Nothing here drops it.
--   * project_stock_from_lots keys on inventory_id alone; untouched by a NULL.
--   * sync_sku_to_new_inventory does SELECT ... INTO from master_wine_library
--     and with a NULL id sets NULL rather than raising.
--   * unit_type DEFAULT 'BOTTLE' silently applied to the inserted keg. That is
--     the hazard this file answers with a trigger instead of a default (§4).
--
-- WHAT PHASE 2 DOES (app code, a separate dispatch, SAME CHANGE AS THIS FILE)
-- --------------------------------------------------------------------------
--   1. apps/api-gateway/src/inventory/inventory.service.ts:69 --
--      `row.master_wine_library?.bottle_size_ml ?? 750` invents a 750 ml bottle
--      for any row with no library row behind it, and then divides by the pour
--      size to publish a glasses-per-bottle figure. A keg would be reported as
--      five glasses. THIS is why the migration is gated: it is one line, it is
--      in the read path every inventory surface uses, and it turns an additive
--      migration into a fabricated number. It must become an em dash first.
--   2. database.service.ts:46 embeds master_wine_library as a LEFT join, so a
--      keg returns `master_wine_library: null`; every consumer of that shape is
--      read before this lands.
--   3. A write path that supplies kind / uom / display_name /
--      identity_provenance, and the intake vocabulary widened to match ADR 0070
--      (the receiving door still has no mass unit and 15 @IsInt() fields).
--   4. `unit_type` documented as superseded by `uom` and stopped being read.
--   5. Nothing needed for low-stock alerts: low-stock-alerts.service.ts:683-690
--      already reads stock_live and threshold_min off whatever row it is given.
--
-- WHAT PHASE 3 DOES (a separate dispatch, gated on a green guard)
-- --------------------------------------------------------------
--   * inventory_lots.master_wine_id and inventory_transactions.wine_id resolve
--     through inventory_id and are dropped.
--   * Consider renaming restaurant_inventory to house_items with a compatibility
--     view in the other direction.
--
-- ROLLBACK FOR THIS PHASE
-- -----------------------
--   DELETE FROM public.restaurant_inventory WHERE master_wine_id IS NULL;
--   ALTER TABLE public.restaurant_inventory ALTER COLUMN master_wine_id SET NOT NULL;
--   DROP VIEW public.house_items;
--   DROP TRIGGER set_house_item_identity ON public.restaurant_inventory;
--   DROP FUNCTION public.set_house_item_identity();
--   DROP INDEX public.restaurant_inventory_house_beverage_uidx,
--              public.restaurant_inventory_house_declared_uidx;
--   ALTER TABLE public.restaurant_inventory
--     DROP COLUMN kind, DROP COLUMN uom, DROP COLUMN display_name,
--     DROP COLUMN beverage_id, DROP COLUMN identity_provenance;
--   ALTER TABLE public.inventory_lots ALTER COLUMN master_wine_id SET NOT NULL;
--   ALTER TABLE public.inventory_transactions ALTER COLUMN wine_id SET NOT NULL;
--
-- Reversible ONLY while no non-wine row exists -- which is true for exactly as
-- long as phase 2 has not shipped. Stated because it is the phase boundary that
-- matters.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 0. Refuse to guess. Every existing row must be a wine, or the backfill below
--    would be inventing a kind and a unit for something it cannot read.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  n_orphan integer;
  n_unnamed integer;
BEGIN
  SELECT count(*) INTO n_orphan
  FROM public.restaurant_inventory
  WHERE master_wine_id IS NULL;

  IF n_orphan > 0 THEN
    RAISE EXCEPTION
      'restaurant_inventory already holds % row(s) with no master_wine_id. This migration derives kind and uom FROM the library link; without one it would be inventing them. Give those rows a kind and a uom by hand first.',
      n_orphan;
  END IF;

  -- Every row must have SOMETHING to be called. Measured on production
  -- 2026-09-03: 53 of 206 rows carry a blank wine_name, and all 206 resolve to
  -- a named master_wine_library row, so the fallback below covers every one.
  SELECT count(*) INTO n_unnamed
  FROM public.restaurant_inventory ri
  LEFT JOIN public.master_wine_library w ON w.id = ri.master_wine_id
  WHERE coalesce(nullif(btrim(ri.wine_name), ''),
                 nullif(btrim(w.name), ''),
                 nullif(btrim(w.producer), '')) IS NULL;

  IF n_unnamed > 0 THEN
    RAISE EXCEPTION
      '% inventory row(s) have no name in wine_name and none in the library either. display_name is NOT NULL and there is nothing honest to put in it.',
      n_unnamed;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The library link stops being the key and becomes an attribute.
-- ---------------------------------------------------------------------------

ALTER TABLE public.restaurant_inventory
  ALTER COLUMN master_wine_id DROP NOT NULL;

-- The two ledger columns that would otherwise make a non-wine lot and a
-- non-wine movement unwritable. NEITHER HAS A FOREIGN KEY -- verified against
-- pg_constraint on production, 2026-09-03 -- so nothing was enforcing them and
-- an FK-based dependency analysis reports both tables as untouched by this
-- change. That is why scripts/check_house_item_invariants.py exists.
ALTER TABLE public.inventory_lots
  ALTER COLUMN master_wine_id DROP NOT NULL;

ALTER TABLE public.inventory_transactions
  ALTER COLUMN wine_id DROP NOT NULL;

COMMENT ON COLUMN public.restaurant_inventory.master_wine_id IS
  'The wine library link. An ATTRIBUTE, not the key (ADR 0115 / OD-113). NULL '
  'on every row that is not a wine. UNIQUE (restaurant_id, master_wine_id) '
  'still holds for wines because Postgres treats NULLs as distinct.';

-- ---------------------------------------------------------------------------
-- 2. What the row is, in its own words.
--
--    NO COLUMN HERE HAS A DEFAULT, and that is the whole point. A default is
--    precisely how a keg becomes a bottle: `unit_type DEFAULT 'BOTTLE'` was
--    measured doing exactly that to a test insert. The BEFORE INSERT trigger in
--    §4 derives these for the wine path so no existing caller breaks; anything
--    that is not a wine has to say what it is.
-- ---------------------------------------------------------------------------

ALTER TABLE public.restaurant_inventory
  ADD COLUMN IF NOT EXISTS kind                text,
  ADD COLUMN IF NOT EXISTS uom                 text,
  ADD COLUMN IF NOT EXISTS display_name        text,
  ADD COLUMN IF NOT EXISTS beverage_id         uuid,
  ADD COLUMN IF NOT EXISTS identity_provenance text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'restaurant_inventory_beverage_id_fkey'
      AND conrelid = 'public.restaurant_inventory'::regclass
  ) THEN
    -- SET NULL, not CASCADE: a shared reference catalogue must never be able to
    -- delete a house's stock. (The wine FK is still ON DELETE CASCADE and that
    -- is a founder question in ADR 0115, deliberately not changed here.)
    ALTER TABLE public.restaurant_inventory
      ADD CONSTRAINT restaurant_inventory_beverage_id_fkey
      FOREIGN KEY (beverage_id) REFERENCES public.beverages(id) ON DELETE SET NULL;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Backfill. Every existing row is a wine -- asserted in §0, not assumed.
-- ---------------------------------------------------------------------------

UPDATE public.restaurant_inventory ri
SET kind = 'wine'
WHERE ri.kind IS NULL;

-- lower(unit_type) maps the existing vocabulary {BOTTLE, CASE, SHOT, GLASS}
-- (…baseline…:3324) onto the new one exactly. The 'bottle' fallback applies
-- only where unit_type is NULL, and is derived rather than invented: a row that
-- came from master_wine_library is bottles by construction -- that table is
-- what carries bottle_size_ml.
UPDATE public.restaurant_inventory ri
SET uom = coalesce(lower(nullif(btrim(ri.unit_type), '')), 'bottle')
WHERE ri.uom IS NULL;

UPDATE public.restaurant_inventory ri
SET display_name = coalesce(
      nullif(btrim(ri.wine_name), ''),
      (SELECT nullif(btrim(w.name), '') FROM public.master_wine_library w WHERE w.id = ri.master_wine_id),
      (SELECT nullif(btrim(w.producer), '') FROM public.master_wine_library w WHERE w.id = ri.master_wine_id)
    )
WHERE ri.display_name IS NULL;

-- 'backfill' rather than 'wine_library': it says how the row got its name --
-- derived by this migration -- rather than claiming a person or a matcher chose
-- it. ADR 0016: a ledger must be able to express what it does not know.
UPDATE public.restaurant_inventory ri
SET identity_provenance = 'backfill'
WHERE ri.identity_provenance IS NULL;

ALTER TABLE public.restaurant_inventory
  ALTER COLUMN kind                SET NOT NULL,
  ALTER COLUMN uom                 SET NOT NULL,
  ALTER COLUMN display_name        SET NOT NULL,
  ALTER COLUMN identity_provenance SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'restaurant_inventory_kind_check'
                   AND conrelid = 'public.restaurant_inventory'::regclass) THEN
    -- `food` and `supply` are here from the start so the ledger does not need a
    -- second migration when bakery arrives (INVENTORY_SOTA_PLAN.md:338
    -- sequences wine -> beverages -> bakery -> kitchen). Widening a CHECK later
    -- is cheap; getting the axis wrong is not.
    ALTER TABLE public.restaurant_inventory
      ADD CONSTRAINT restaurant_inventory_kind_check CHECK (kind IN (
        'wine', 'beer', 'whiskey', 'spirit', 'liqueur', 'cocktail', 'sake',
        'cider', 'non_alcoholic', 'soft_drink', 'food', 'supply', 'other'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'restaurant_inventory_uom_check'
                   AND conrelid = 'public.restaurant_inventory'::regclass) THEN
    -- Container units plus ADR 0070's mass and volume base units. ADR 0070:
    -- quantities stay integer and the unit belongs to the item, which is this
    -- column. mg and ml are in the vocabulary from the start because the
    -- ingredient class that needs them (saffron at 0.1-0.5 g) is unrepresentable
    -- at a 1 g floor and extending later is a CHECK change against live rows.
    ALTER TABLE public.restaurant_inventory
      ADD CONSTRAINT restaurant_inventory_uom_check CHECK (uom IN (
        'bottle', 'case', 'keg', 'pack', 'each', 'glass', 'shot',
        'ml', 'l', 'mg', 'g', 'kg'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'restaurant_inventory_identity_provenance_check'
                   AND conrelid = 'public.restaurant_inventory'::regclass) THEN
    ALTER TABLE public.restaurant_inventory
      ADD CONSTRAINT restaurant_inventory_identity_provenance_check
      CHECK (identity_provenance IN
        ('wine_library', 'beverage_catalogue', 'house_declared', 'backfill'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'restaurant_inventory_one_catalogue_check'
                   AND conrelid = 'public.restaurant_inventory'::regclass) THEN
    -- One row, one catalogue. A row claiming both a wine and a beverage entry
    -- is two identities wearing one id, which is the thing this whole decision
    -- exists to stop.
    ALTER TABLE public.restaurant_inventory
      ADD CONSTRAINT restaurant_inventory_one_catalogue_check
      CHECK (master_wine_id IS NULL OR beverage_id IS NULL);
  END IF;
END
$$;

COMMENT ON COLUMN public.restaurant_inventory.kind IS
  'What this house item IS. NO DEFAULT, deliberately: a default is how a keg '
  'becomes a bottle. Derived for the wine path by set_house_item_identity().';
COMMENT ON COLUMN public.restaurant_inventory.uom IS
  'The item''s canonical unit (ADR 0070: quantities stay integer, the unit '
  'belongs to the item). NO DEFAULT. Supersedes unit_type, which keeps its '
  'DEFAULT ''BOTTLE'' until phase 2 stops reading it.';
COMMENT ON COLUMN public.restaurant_inventory.display_name IS
  'What the house calls this. Backfilled from wine_name, else the library name, '
  'else the library producer -- all three measured to cover every production row.';
COMMENT ON COLUMN public.restaurant_inventory.beverage_id IS
  'The shared beverage catalogue link for a non-wine, ON DELETE SET NULL: '
  'somebody else''s catalogue may not delete this house''s stock.';
COMMENT ON COLUMN public.restaurant_inventory.identity_provenance IS
  'How this row got its name: wine_library | beverage_catalogue | '
  'house_declared | backfill. Never inferred at read time.';

-- ---------------------------------------------------------------------------
-- 4. A trigger, not a default.
--
--    The legacy wine path always supplies master_wine_id and never supplies
--    kind or uom, so it would 500 on four new NOT NULL columns. A DEFAULT would
--    fix that and characterise every future keg as a bottle of wine. A trigger
--    derives what is derivable and RAISES on what is not -- silent where the
--    answer is forced, loud where nobody could know.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_house_item_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.kind IS NOT NULL AND NEW.uom IS NOT NULL
     AND NEW.display_name IS NOT NULL AND NEW.identity_provenance IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.master_wine_id IS NULL THEN
    RAISE EXCEPTION
      'restaurant_inventory: a house item with no master_wine_id must state kind, uom, display_name and identity_provenance. Nothing here is derivable and a default would file this as a bottle of wine (ADR 0115 / OD-113).'
      USING ERRCODE = '23502';
  END IF;

  NEW.kind := coalesce(NEW.kind, 'wine');
  NEW.uom  := coalesce(NEW.uom, lower(nullif(btrim(NEW.unit_type), '')), 'bottle');
  NEW.identity_provenance := coalesce(NEW.identity_provenance, 'wine_library');

  IF NEW.display_name IS NULL THEN
    SELECT coalesce(nullif(btrim(NEW.wine_name), ''),
                    nullif(btrim(w.name), ''),
                    nullif(btrim(w.producer), ''))
      INTO NEW.display_name
    FROM public.master_wine_library w
    WHERE w.id = NEW.master_wine_id;
  END IF;

  IF NEW.display_name IS NULL THEN
    RAISE EXCEPTION
      'restaurant_inventory: library row % carries no name and no producer, so there is no honest display_name for this house item (ADR 0115).',
      NEW.master_wine_id
      USING ERRCODE = '23502';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.set_house_item_identity IS
  'BEFORE INSERT on restaurant_inventory. Derives kind/uom/display_name/'
  'identity_provenance for a row that carries a master_wine_id; RAISES for one '
  'that does not. Exists so the four new columns can be NOT NULL with no '
  'DEFAULT without breaking any existing caller (ADR 0115).';

DROP TRIGGER IF EXISTS set_house_item_identity ON public.restaurant_inventory;
-- INSERT only. On UPDATE the NOT NULL constraints already refuse to let a row
-- lose its kind, and a BEFORE UPDATE derivation would quietly re-fill a column
-- somebody meant to clear.
CREATE TRIGGER set_house_item_identity
  BEFORE INSERT ON public.restaurant_inventory
  FOR EACH ROW EXECUTE FUNCTION public.set_house_item_identity();

-- ---------------------------------------------------------------------------
-- 5. Nothing stops a non-wine duplicating. UNIQUE (restaurant_id,
--    master_wine_id) covers wine and, because NULLs are distinct, covers
--    nothing else -- measured, two NULL rows inserted cleanly.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_inventory_house_beverage_uidx
  ON public.restaurant_inventory (restaurant_id, beverage_id)
  WHERE beverage_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_inventory_house_declared_uidx
  ON public.restaurant_inventory (restaurant_id, lower(display_name))
  WHERE master_wine_id IS NULL AND beverage_id IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS restaurant_inventory_kind_idx
  ON public.restaurant_inventory (restaurant_id, kind)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 6. The noun, without the churn.
--
--    ADR 0115 rejected a `house_items` TABLE because of the dual-write window
--    it needs. The name is still right, and a view buys it for nothing.
--    security_invoker is not optional: without it a view runs with the
--    definer's rights and reads straight past restaurant_inventory's RLS.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS public.house_items;
CREATE VIEW public.house_items
  WITH (security_invoker = true)
AS
SELECT
  ri.id,
  ri.restaurant_id,
  ri.kind,
  ri.display_name,
  ri.uom,
  ri.master_wine_id,
  ri.beverage_id,
  ri.identity_provenance,
  ri.stock_live,
  ri.threshold_min,
  ri.is_active,
  ri.is_optional_tracking,
  ri.deleted_at,
  ri.created_at,
  ri.updated_at
FROM public.restaurant_inventory ri;

COMMENT ON VIEW public.house_items IS
  'The house item, named. One row per thing this house carries, wine or not, '
  'keyed on restaurant_inventory.id -- which is already the key for stock, par, '
  'counts and orders (ADR 0115 / OD-113). security_invoker so the underlying '
  'table''s RLS still applies.';

REVOKE ALL ON public.house_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.house_items TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_nullable boolean;
  v_hasdef   boolean;
  c          text;
  n_bad      integer;
BEGIN
  -- 7a. The library link is an attribute now, on all three tables.
  FOR c IN SELECT unnest(ARRAY[
      'public.restaurant_inventory|master_wine_id',
      'public.inventory_lots|master_wine_id',
      'public.inventory_transactions|wine_id'])
  LOOP
    SELECT NOT attnotnull INTO v_nullable
    FROM pg_attribute
    WHERE attrelid = split_part(c, '|', 1)::regclass
      AND attname  = split_part(c, '|', 2);
    IF NOT coalesce(v_nullable, false) THEN
      RAISE EXCEPTION '% is still NOT NULL -- a non-wine still cannot be written', c;
    END IF;
  END LOOP;

  -- 7b. The four new columns are NOT NULL and carry NO DEFAULT. The default is
  --     the failure mode; asserting its absence is the point of this block.
  FOR c IN SELECT unnest(ARRAY['kind', 'uom', 'display_name', 'identity_provenance'])
  LOOP
    SELECT a.attnotnull, (d.adbin IS NOT NULL) INTO v_nullable, v_hasdef
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'public.restaurant_inventory'::regclass AND a.attname = c;

    IF NOT coalesce(v_nullable, false) THEN
      RAISE EXCEPTION 'restaurant_inventory.% is nullable -- a house item with no % is uninterpretable', c, c;
    END IF;
    IF v_hasdef THEN
      RAISE EXCEPTION
        'restaurant_inventory.% has a DEFAULT. That is exactly how a keg becomes a bottle; ADR 0115 forbids it.', c;
    END IF;
  END LOOP;

  -- 7c. The backfill left nothing behind.
  SELECT count(*) INTO n_bad FROM public.restaurant_inventory
  WHERE kind IS NULL OR uom IS NULL OR display_name IS NULL
     OR identity_provenance IS NULL;
  IF n_bad > 0 THEN
    RAISE EXCEPTION '% row(s) survived the backfill without a kind, uom, name or provenance', n_bad;
  END IF;

  -- 7d. Wine's guarantee is untouched.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'restaurant_inventory_restaurant_id_master_wine_id_key'
      AND conrelid = 'public.restaurant_inventory'::regclass
  ) THEN
    RAISE EXCEPTION
      'UNIQUE (restaurant_id, master_wine_id) is gone. Nothing here should have dropped it -- it still keeps one row per wine, and NULLs being distinct is what admits the non-wines.';
  END IF;

  -- 7e. The trigger and the indexes exist.
  IF to_regprocedure('public.set_house_item_identity()') IS NULL THEN
    RAISE EXCEPTION 'set_house_item_identity() was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgname = 'set_house_item_identity'
                   AND tgrelid = 'public.restaurant_inventory'::regclass
                   AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'the set_house_item_identity trigger is not attached';
  END IF;
  FOR c IN SELECT unnest(ARRAY['restaurant_inventory_house_beverage_uidx',
                               'restaurant_inventory_house_declared_uidx'])
  LOOP
    IF to_regclass('public.' || c) IS NULL THEN
      RAISE EXCEPTION 'index % is missing -- a non-wine could duplicate silently', c;
    END IF;
  END LOOP;

  -- 7f. The view exists, is security_invoker, and no browser role can read it.
  IF to_regclass('public.house_items') IS NULL THEN
    RAISE EXCEPTION 'the house_items view was not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.house_items'::regclass
      AND 'security_invoker=true' = ANY (reloptions)
  ) THEN
    RAISE EXCEPTION
      'house_items is not security_invoker -- it would read past restaurant_inventory''s RLS and hand one house another house''s items';
  END IF;
  IF has_table_privilege('anon', 'public.house_items', 'SELECT')
     OR has_table_privilege('authenticated', 'public.house_items', 'SELECT') THEN
    RAISE EXCEPTION 'house_items is readable by anon/authenticated -- that is a cross-tenant read';
  END IF;

  RAISE NOTICE 'restaurant_inventory is the house item: master_wine_id relaxed on 3 tables, kind/uom/display_name/identity_provenance NOT NULL with no default, trigger + 2 partial uniques + house_items view in place.';
END
$$;

-- ---------------------------------------------------------------------------
-- 8. Prove the trigger, do not describe it.
--
--    An assertion that the function EXISTS is not evidence it refuses anything.
--    This exercises both branches against a throwaway restaurant inside a
--    PL/pgSQL subtransaction, and unwinds it. PL/pgSQL variables survive a
--    subtransaction rollback; the rows do not.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_rid       uuid := gen_random_uuid();
  refused     boolean := false;
  derived_ok  boolean := false;
  v_kind      text;
  v_uom       text;
BEGIN
  BEGIN
    INSERT INTO public.restaurants (id, name, slug)
    VALUES (v_rid, '__adr0115_probe__', '__adr0115_probe_' || replace(v_rid::text, '-', ''));

    -- Branch 1: no library link and no declared kind must be REFUSED.
    BEGIN
      INSERT INTO public.restaurant_inventory (restaurant_id, master_wine_id)
      VALUES (v_rid, NULL);
    EXCEPTION
      WHEN not_null_violation THEN refused := true;
    END;

    -- Branch 2: a stated non-wine must be ACCEPTED, and must keep the unit it
    -- stated rather than the one unit_type would have defaulted it to.
    BEGIN
      INSERT INTO public.restaurant_inventory
        (restaurant_id, master_wine_id, kind, uom, display_name, identity_provenance)
      VALUES (v_rid, NULL, 'beer', 'keg', '__adr0115_probe_keg__', 'house_declared');

      SELECT kind, uom INTO v_kind, v_uom
      FROM public.restaurant_inventory
      WHERE restaurant_id = v_rid AND display_name = '__adr0115_probe_keg__';

      derived_ok := (v_kind = 'beer' AND v_uom = 'keg');
    END;

    RAISE EXCEPTION 'ADR0115_PROBE_UNWIND';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'ADR0115_PROBE_UNWIND' THEN
        RAISE;
      END IF;
  END;

  IF NOT refused THEN
    RAISE EXCEPTION
      'set_house_item_identity accepted a row with no master_wine_id and no kind. That row is uninterpretable and the trigger is the only thing standing between it and the ledger.';
  END IF;
  IF NOT derived_ok THEN
    RAISE EXCEPTION
      'a stated non-wine did not survive the trigger with its own kind and uom (got %/%). unit_type DEFAULT ''BOTTLE'' must not reach uom.',
      coalesce(v_kind, '(null)'), coalesce(v_uom, '(null)');
  END IF;

  IF EXISTS (SELECT 1 FROM public.restaurants WHERE id = v_rid) THEN
    RAISE EXCEPTION 'the probe restaurant survived its own subtransaction -- this migration has left rows behind';
  END IF;

  RAISE NOTICE 'set_house_item_identity proven: refuses an unstated non-wine, accepts a stated one with its own unit, and left no probe rows.';
END
$$;
