-- ===========================================================================
-- A house says whether it reclaims the tax it pays, and a lot's cost says
-- whether tax is inside it (ADR 0359 C2 and C3, cost-math lane 3.5a).
-- ===========================================================================
--
-- WHAT WAS WRONG. `paper-landed-cost.ts` costs every invoice line through
-- `landedCost`, which already knows the rule: a house that reclaims the tax it
-- pays costs a line before tax (`net`), and a house that does not costs it with
-- tax (`gross_cost`). But nothing could tell it which house is which:
-- `houseTaxForLotCost()` answered `unset` for every house, because no column
-- held the answer. So a house that reclaims KDV paid 110 for something that
-- cost it 100, and its lot said 110. And `landedCost` worked out what each cost
-- holds and nothing kept it, so no later reader could tell a net cost from a
-- gross one (founder, 2026-10-12, F3: "stamp cost basis").
--
-- WHAT THIS FILE DOES. Additive. Every existing house reads `unset` and every
-- existing lot reads NULL, so nothing costs differently until a house answers
-- (F2: only from now, no backfill).
--
--   1. restaurants.tax_basis: unset | prices_include_tax | prices_exclude_tax
--      | not_vat_charging, NOT NULL DEFAULT 'unset'. Never defaulted from the
--      country (ADR 0359 C2).
--      restaurants.reclaims_input_tax: yes/no, NULL until answered.
--      restaurants.tax_basis_set_by / _set_at: who answered, and when.
--      restaurants.tax_basis_since: the switch date, the first time any basis
--      was stated. A later answer never moves it (C2: "Re-sending the same
--      answer does not move it"), and a trigger keeps it.
--   2. inventory_lots.cost_tax_basis: net | gross_cost | NULL.
--      A trigger clears it whenever a write changes `unit_cost` without
--      restating it, so a stamp never outlives the cost it described (a hand
--      revaluation, an /orders re-cost, a later finalise at another price).
--   3. public.stamp_delivery_cost_tax_basis(...): stamps the lots one delivery
--      booked for one item, and only those whose cost is the one the stamp is
--      about.
--
-- WHY A SEPARATE FUNCTION AND NOT A NEW ARGUMENT ON finalise_delivery_cost.
-- Three open branches redefine finalise_delivery_cost (the cost-of-goods
-- chain: 20270502100100, 20270615100000). A fourth definition here would
-- either overwrite theirs or be overwritten, depending on the merge order, and
-- either way one of the two behaviours silently disappears. The stamp is a
-- claim about a cost, and its absence is the honest default: if the stamp
-- call fails after the cost posted, the lot reads "not stated", which is what
-- every lot reads today. Rejected: a trigger that infers the stamp (it cannot
-- know the house's answer at the moment of the cost), and writing the stamp
-- from the gateway with a plain UPDATE (it would skip the house check).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The house's answers
-- ---------------------------------------------------------------------------
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS tax_basis TEXT NOT NULL DEFAULT 'unset',
  ADD COLUMN IF NOT EXISTS reclaims_input_tax BOOLEAN,
  ADD COLUMN IF NOT EXISTS tax_basis_set_by UUID
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS tax_basis_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tax_basis_since TIMESTAMPTZ;

COMMENT ON COLUMN public.restaurants.tax_basis IS
  'ADR 0359 C2. Whether the house''s own prices include tax: unset (nobody has said), prices_include_tax (KDV/VAT inside the price), prices_exclude_tax (tax added on top), not_vat_charging (the house charges no VAT). Never defaulted from the country.';
COMMENT ON COLUMN public.restaurants.reclaims_input_tax IS
  'ADR 0359 C2. Whether the house gets back the tax it pays on its purchases. NULL until answered. A reclaiming house costs a purchase before tax (net); one that does not costs it with tax (gross_cost). Read only when tax_basis is not unset.';
COMMENT ON COLUMN public.restaurants.tax_basis_set_by IS
  'Who last stated tax_basis / reclaims_input_tax, public.users(user_id), never auth.users.';
COMMENT ON COLUMN public.restaurants.tax_basis_since IS
  'ADR 0359 C2 / F2: the switch date, the first moment a basis was stated. Lots costed before it carry no stamp. A later answer never moves it (trigger restaurants_tax_basis_since_holds).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurants_tax_basis_is_known'
       AND conrelid = to_regclass('public.restaurants')
  ) THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_tax_basis_is_known
      CHECK (tax_basis IN ('unset','prices_include_tax','prices_exclude_tax','not_vat_charging'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurants_tax_basis_names_its_author'
       AND conrelid = to_regclass('public.restaurants')
  ) THEN
    -- Either nobody has answered (and no reclaim answer stands alone), or the
    -- basis, the person and the moment are one fact.
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_tax_basis_names_its_author
      CHECK (
        (tax_basis = 'unset'
          AND reclaims_input_tax IS NULL
          AND tax_basis_set_by IS NULL
          AND tax_basis_set_at IS NULL)
        OR
        (tax_basis <> 'unset'
          AND tax_basis_set_by IS NOT NULL
          AND tax_basis_set_at IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurants_no_vat_reclaims_nothing'
       AND conrelid = to_regclass('public.restaurants')
  ) THEN
    -- A house that charges no VAT has none to set against what it pays.
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_no_vat_reclaims_nothing
      CHECK (NOT (tax_basis = 'not_vat_charging' AND reclaims_input_tax IS TRUE));
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.restaurants_tax_basis_since_holds()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.tax_basis_since IS NOT NULL THEN
    NEW.tax_basis_since := OLD.tax_basis_since;
  ELSIF NEW.tax_basis <> 'unset' AND NEW.tax_basis_since IS NULL THEN
    NEW.tax_basis_since := COALESCE(NEW.tax_basis_set_at, now());
  ELSIF NEW.tax_basis = 'unset' THEN
    NEW.tax_basis_since := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restaurants_tax_basis_since_holds ON public.restaurants;
CREATE TRIGGER restaurants_tax_basis_since_holds
  BEFORE INSERT OR UPDATE OF tax_basis, tax_basis_since ON public.restaurants
  FOR EACH ROW EXECUTE FUNCTION public.restaurants_tax_basis_since_holds();

-- ---------------------------------------------------------------------------
-- 2. What a lot's cost holds
-- ---------------------------------------------------------------------------
ALTER TABLE public.inventory_lots
  ADD COLUMN IF NOT EXISTS cost_tax_basis TEXT;

COMMENT ON COLUMN public.inventory_lots.cost_tax_basis IS
  'ADR 0359 C3. net = the cost is before tax, because the house reclaims it; gross_cost = the cost carries the tax, because the house does not reclaim it; NULL = not stated (house unset, lot costed before the switch, or the paper does not say enough). Cleared by trigger whenever unit_cost changes without it.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'inventory_lots_cost_tax_basis_is_known'
       AND conrelid = to_regclass('public.inventory_lots')
  ) THEN
    ALTER TABLE public.inventory_lots
      ADD CONSTRAINT inventory_lots_cost_tax_basis_is_known
      CHECK (cost_tax_basis IS NULL OR cost_tax_basis IN ('net','gross_cost'));
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.lot_cost_tax_basis_follows_its_cost()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- A new figure with the old stamp is not known to be on the old basis.
  IF NEW.unit_cost IS DISTINCT FROM OLD.unit_cost
     AND NEW.cost_tax_basis IS NOT DISTINCT FROM OLD.cost_tax_basis THEN
    NEW.cost_tax_basis := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lot_cost_tax_basis_follows_its_cost ON public.inventory_lots;
CREATE TRIGGER lot_cost_tax_basis_follows_its_cost
  BEFORE UPDATE OF unit_cost ON public.inventory_lots
  FOR EACH ROW EXECUTE FUNCTION public.lot_cost_tax_basis_follows_its_cost();

-- ---------------------------------------------------------------------------
-- 3. The stamp
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stamp_delivery_cost_tax_basis(
    p_restaurant_id uuid,
    p_delivery_id uuid,
    p_inventory_id uuid,
    p_unit_cost numeric,
    p_cost_tax_basis text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_house uuid;
  v_stamped int := 0;
BEGIN
  IF p_restaurant_id IS NULL OR p_delivery_id IS NULL OR p_inventory_id IS NULL THEN
    RAISE EXCEPTION 'stamp_delivery_cost_tax_basis: the house, the delivery and the item are all required'
      USING ERRCODE = '22023';
  END IF;
  IF p_unit_cost IS NULL THEN
    RAISE EXCEPTION 'stamp_delivery_cost_tax_basis: a stamp describes one cost, so the cost is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_cost_tax_basis IS NOT NULL AND p_cost_tax_basis NOT IN ('net','gross_cost') THEN
    RAISE EXCEPTION 'stamp_delivery_cost_tax_basis: a cost is net, gross_cost or not stated (got %)', p_cost_tax_basis
      USING ERRCODE = '22023';
  END IF;

  SELECT restaurant_id INTO v_house FROM restaurant_inventory WHERE id = p_inventory_id;
  IF v_house IS NULL OR v_house <> p_restaurant_id THEN
    RAISE EXCEPTION 'stamp_delivery_cost_tax_basis: item % is not this house''s', p_inventory_id
      USING ERRCODE = '42501';
  END IF;

  -- Only the lots finalise_delivery_cost settled at this very cost: a lot
  -- revalued since, still provisional, or poured out is not what the stamp is
  -- about.
  UPDATE inventory_lots
     SET cost_tax_basis = p_cost_tax_basis
   WHERE restaurant_id = p_restaurant_id
     AND inventory_id  = p_inventory_id
     AND delivery_id   = p_delivery_id
     AND stock_state   = 'live'
     AND cost_state    = 'final'
     AND qty > 0
     AND unit_cost     = p_unit_cost
     AND cost_tax_basis IS DISTINCT FROM p_cost_tax_basis;
  GET DIAGNOSTICS v_stamped = ROW_COUNT;

  RETURN jsonb_build_object(
    'delivery_id', p_delivery_id,
    'inventory_id', p_inventory_id,
    'cost_tax_basis', p_cost_tax_basis,
    'lots_stamped', v_stamped
  );
END;
$$;

COMMENT ON FUNCTION public.stamp_delivery_cost_tax_basis(uuid, uuid, uuid, numeric, text) IS
  'ADR 0359 C3: after finalise_delivery_cost, say what the cost of one delivery''s lots of one item holds for tax. Stamps only live, final lots of this house at exactly p_unit_cost; idempotent; returns lots_stamped.';

REVOKE ALL ON FUNCTION public.stamp_delivery_cost_tax_basis(uuid, uuid, uuid, numeric, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_delivery_cost_tax_basis(uuid, uuid, uuid, numeric, text)
  TO service_role;

COMMIT;
