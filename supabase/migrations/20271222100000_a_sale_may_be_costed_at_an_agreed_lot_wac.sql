-- DD-r104-16: a sale priced from a final, hand-agreed lot cost reads
-- "agreed_lot_wac" (analytics/inventory-cost.ts), and the gateway's
-- SaleCostBasis now names it (#2019). The CHECK from 20271201100000 listed only
-- three bases, so the database refused such a sale's row. Drop and re-add it
-- with the fourth. Existing rows hold one of the first three, so every one
-- passes.
--
-- The list is the whole set of seven words. #1984 (invoice_restated) and #2063
-- (pour_lot_wac, pour_lot_wac_partial) carry the same seven, so whichever of the
-- three merges last leaves the full list in place. Guarded by
-- pos-hub/cost-basis-check-lists-every-word.spec.ts, which fails when the newest
-- migration to set this CHECK leaves a word out.

ALTER TABLE public.wine_consumption_log
  DROP CONSTRAINT IF EXISTS wine_consumption_log_cost_basis_check;
ALTER TABLE public.wine_consumption_log
  ADD CONSTRAINT wine_consumption_log_cost_basis_check
  CHECK (cost_basis IS NULL OR cost_basis IN
    ('invoice_lot_wac', 'invoice_lot_wac_partial', 'agreed_lot_wac', 'last_purchase_price',
     'invoice_restated', 'pour_lot_wac', 'pour_lot_wac_partial'));

COMMENT ON COLUMN public.wine_consumption_log.cost_basis IS
  'What the cost was read from at sale: invoice_lot_wac, invoice_lot_wac_partial, agreed_lot_wac, last_purchase_price, pour_lot_wac or pour_lot_wac_partial; invoice_restated once a verified invoice moved it.';
