-- ===========================================================================
-- A settled delivery cost keeps the tax basis its lot was stamped with, so
-- Price signals compares two costs only when they hold tax the same way
-- (r108 inventory-1, r109 inventory-1; DD-r108-34, DD-r108-84).
-- ===========================================================================
--
-- WHAT WAS WRONG. Price signals (r104 g3) compares a good's last two settled
-- delivery costs, read from `inventory_lot_revaluations`. Nothing on that row
-- says whether tax is inside the cost, so a cost with tax and one without
-- read as a 10-20 % move.
--
-- WHERE THE BASIS IS DECIDED. Once, by ADR 0359 C3 (#1459/#1461): at VERIFIED
-- `finaliseAtVerified` costs each invoice line from the header and house
-- reads it already makes (the house's own answer on reclaiming tax, and what
-- the paper prints), and `stamp_delivery_cost_tax_basis` writes the result on
-- `inventory_lots.cost_tax_basis`. A house that has not answered stamps
-- nothing, so its costs read "not stated". This file adds no second decision
-- and no second read of the paper.
--
-- WHY THE REVALUATION ROW TOO. The lot is today's state: a used-up lot is
-- deleted (the revaluation row's lot_id goes NULL, ON DELETE SET NULL) and a
-- new cost clears the lot's stamp by trigger. The revaluation row is the
-- settlement's history, and the row Price signals reads. So the lot's stamp
-- is copied, in the same statement, onto the settlement it describes.
--
-- WHAT THIS FILE DOES. Additive and nullable, no backfill (founder
-- 2026-10-12 F2): every existing row reads NULL ("not stated").
--   1. inventory_lot_revaluations.cost_tax_basis: net | gross_cost | NULL,
--      the words ADR 0359 C3 gives inventory_lots.cost_tax_basis.
--   2. Trigger settled_cost_keeps_its_lots_tax_basis on inventory_lots: when a
--      lot is stamped with a basis, the lot's NEWEST revaluation row takes it,
--      only when that row is an invoice settlement at the lot's very cost and
--      states nothing yet. A stated row is never restated; a NULL stamp writes
--      nothing; a hand or estimated cost is never stamped.
--
-- WHY A TRIGGER AND NOT A SECOND RPC. One writer, one decision: the copy
-- cannot drift from the lot, cannot half-fail after the lot is stamped, and
-- needs no extra read or call in the gateway. Redefining
-- stamp_delivery_cost_tax_basis here was rejected: it is #1459's, still open,
-- and two definitions would race on merge order.
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
  'Whether new_unit_cost holds tax: net (before tax) or gross_cost (with it), copied from the lot''s ADR 0359 C3 stamp when the settlement was stamped. NULL = not stated. r109 inventory-1.';

CREATE OR REPLACE FUNCTION public.settled_cost_keeps_its_lots_tax_basis()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.cost_tax_basis IS NULL
     OR NEW.cost_tax_basis IS NOT DISTINCT FROM OLD.cost_tax_basis THEN
    RETURN NULL;
  END IF;
  UPDATE inventory_lot_revaluations r
     SET cost_tax_basis = NEW.cost_tax_basis
   WHERE r.id = (
           SELECT n.id FROM inventory_lot_revaluations n
            WHERE n.lot_id = NEW.id
              AND n.restaurant_id = NEW.restaurant_id
            ORDER BY n.created_at DESC, n.id DESC
            LIMIT 1)
     AND r.new_unit_cost = NEW.unit_cost
     AND r.new_cost_provenance = 'invoice'
     AND r.cost_tax_basis IS NULL;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.settled_cost_keeps_its_lots_tax_basis() IS
  'r109 inventory-1: copy a lot''s ADR 0359 C3 tax-basis stamp onto its newest invoice revaluation row at the same cost, once.';

DROP TRIGGER IF EXISTS settled_cost_keeps_its_lots_tax_basis ON public.inventory_lots;
CREATE TRIGGER settled_cost_keeps_its_lots_tax_basis
  AFTER UPDATE OF cost_tax_basis ON public.inventory_lots
  FOR EACH ROW EXECUTE FUNCTION public.settled_cost_keeps_its_lots_tax_basis();

REVOKE ALL ON FUNCTION public.settled_cost_keeps_its_lots_tax_basis() FROM PUBLIC, anon, authenticated;

COMMIT;
