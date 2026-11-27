-- ===========================================================================
-- A settled delivery cost says whether tax is inside it, so Price signals
-- compares two costs only when they hold tax the same way (r108 inventory-1,
-- DD-r108-34 / DD-r107-45).
-- ===========================================================================
--
-- WHAT WAS WRONG. Price signals (r104 g3) compares a good's last two settled
-- delivery costs, read from `inventory_lot_revaluations`. On this tree the
-- settled cost IS the invoice line's unit price as the paper printed it
-- (`finaliseAtVerified` -> finalise_delivery_cost). A supermarket receipt
-- prints prices with KDV inside; a wholesaler's e-invoice prints them before.
-- Two deliveries of the same good at the same real price, one on each kind
-- of paper, read as a 10-20 % move. Nothing kept which kind a cost was.
--
-- WHAT THIS FILE DOES. Additive and nullable, no backfill: every existing row
-- reads NULL ("not stated"), and Price signals compares nothing it cannot
-- vouch for.
--   1. inventory_lot_revaluations.cost_tax_basis: net | gross_cost | NULL.
--      The same words ADR 0359 C3 (#1459) gives inventory_lots.cost_tax_basis.
--      On the revaluation row because that row outlives the lot (a used-up
--      lot is deleted and this row's lot_id goes NULL), and it is the row
--      Price signals reads.
--   2. public.stamp_settled_cost_tax_basis(...): after finalise_delivery_cost,
--      stamps the revaluation rows that call wrote for one delivery's lots of
--      one item at exactly that cost. The gateway decides the word from the
--      paper's own stated totals (lines summing to the total before tax, or
--      to the total with it); an ambiguous paper is not stamped.
--
-- WHY NOT A NEW ARGUMENT ON finalise_delivery_cost. Open branches redefine
-- it (#1459's header names three); a fourth definition would overwrite or be
-- overwritten by merge order. A failed stamp leaves NULL, the honest default.
--
-- Rejected: a per-paper `prices_include_tax` column (it says how the paper
-- PRINTED, not what the cost HOLDS; once landed cost applies the house's
-- reclaim rule, a gross paper settles a net cost and the flag would mislabel
-- it); the house's own basis (the house's list-price answer says nothing
-- about how a vendor printed a paper); a per-line column (one paper prints
-- one way; and the chip never reads lines).
-- ===========================================================================

BEGIN;

ALTER TABLE public.inventory_lot_revaluations
  ADD COLUMN IF NOT EXISTS cost_tax_basis TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'inventory_lot_revaluations_cost_tax_basis_is_known'
  ) THEN
    ALTER TABLE public.inventory_lot_revaluations
      ADD CONSTRAINT inventory_lot_revaluations_cost_tax_basis_is_known
      CHECK (cost_tax_basis IS NULL OR cost_tax_basis IN ('net', 'gross_cost'));
  END IF;
END $$;

COMMENT ON COLUMN public.inventory_lot_revaluations.cost_tax_basis IS
  'Whether new_unit_cost holds tax: net (before tax) or gross_cost (with it), as the paper that settled it showed. NULL = not stated, never assumed from the house or the country. r108 inventory-1.';

CREATE OR REPLACE FUNCTION public.stamp_settled_cost_tax_basis(
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
  IF p_restaurant_id IS NULL OR p_delivery_id IS NULL OR p_inventory_id IS NULL OR p_unit_cost IS NULL THEN
    RAISE EXCEPTION 'stamp_settled_cost_tax_basis: the house, the delivery, the item and the cost are all required'
      USING ERRCODE = '22023';
  END IF;
  IF p_cost_tax_basis IS NULL OR p_cost_tax_basis NOT IN ('net', 'gross_cost') THEN
    RAISE EXCEPTION 'stamp_settled_cost_tax_basis: a stamp is net or gross_cost (got %)', p_cost_tax_basis
      USING ERRCODE = '22023';
  END IF;

  SELECT restaurant_id INTO v_house FROM restaurant_inventory WHERE id = p_inventory_id;
  IF v_house IS NULL OR v_house <> p_restaurant_id THEN
    RAISE EXCEPTION 'stamp_settled_cost_tax_basis: item % is not this house''s', p_inventory_id
      USING ERRCODE = '42501';
  END IF;

  -- Only rows this house wrote for this delivery's lots of this item at this
  -- very cost, and only ones not yet stamped: a row already stated is never
  -- restated by a later paper.
  UPDATE inventory_lot_revaluations r
     SET cost_tax_basis = p_cost_tax_basis
   WHERE r.restaurant_id = p_restaurant_id
     AND r.inventory_id  = p_inventory_id
     AND r.new_unit_cost = p_unit_cost
     AND r.cost_tax_basis IS NULL
     AND r.lot_id IN (
       SELECT l.id FROM inventory_lots l
        WHERE l.restaurant_id = p_restaurant_id
          AND l.inventory_id  = p_inventory_id
          AND l.delivery_id   = p_delivery_id
     );
  GET DIAGNOSTICS v_stamped = ROW_COUNT;

  RETURN jsonb_build_object('rows_stamped', v_stamped, 'cost_tax_basis', p_cost_tax_basis);
END;
$$;

COMMENT ON FUNCTION public.stamp_settled_cost_tax_basis(uuid, uuid, uuid, numeric, text) IS
  'r108 inventory-1: after finalise_delivery_cost, say whether the settled cost of one delivery''s lots of one item holds tax. Stamps only unstamped revaluation rows of this house at exactly p_unit_cost; idempotent; returns rows_stamped.';

REVOKE ALL ON FUNCTION public.stamp_settled_cost_tax_basis(uuid, uuid, uuid, numeric, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_settled_cost_tax_basis(uuid, uuid, uuid, numeric, text)
  TO service_role;

COMMIT;
