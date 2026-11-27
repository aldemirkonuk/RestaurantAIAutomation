-- A sale costed from a hand-agreed, final lot cost names that basis.
--
-- SaleCostBasis (apps/api-gateway/src/pos-hub/sale-cost.ts) gained
-- 'agreed_lot_wac' for the cost reader the inventory chain adds
-- (analytics/inventory-cost.ts). The CHECK from 20271201100000 lists only three
-- bases, so the insert of such a line would be refused, and a refused insert
-- is only logged: the demand series would silently lose the event.

ALTER TABLE public.wine_consumption_log
  DROP CONSTRAINT IF EXISTS wine_consumption_log_cost_basis_check;
ALTER TABLE public.wine_consumption_log
  ADD CONSTRAINT wine_consumption_log_cost_basis_check
  CHECK (cost_basis IS NULL OR cost_basis IN
    ('invoice_lot_wac', 'invoice_lot_wac_partial', 'agreed_lot_wac', 'last_purchase_price'));

COMMENT ON COLUMN public.wine_consumption_log.cost_basis IS
  'What the cost was read from at sale: invoice_lot_wac, invoice_lot_wac_partial, agreed_lot_wac or last_purchase_price.';
