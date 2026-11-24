-- DD-r104-16: a sale priced from a final, hand-agreed lot cost reads
-- "agreed_lot_wac" (analytics/inventory-cost.ts), and the gateway's
-- SaleCostBasis now names it (#2019). The CHECK from 20271201100000 listed only
-- three bases, so the database refused such a sale's row. Drop and re-add it
-- with the fourth. Existing rows hold one of the first three, so every one
-- passes.
--
-- The list also keeps the words two other open PRs add to this same CHECK
-- (invoice_restated from #1984's 20271201300000; pour_lot_wac and
-- pour_lot_wac_partial from #2063's 20271220100000). This version sorts after
-- both, so a list of four would silently take their words back out and the
-- database would refuse a restated sale and every pour. A superset on main
-- today (no row holds them) and the right set after either lands.

ALTER TABLE public.wine_consumption_log
  DROP CONSTRAINT IF EXISTS wine_consumption_log_cost_basis_check;
ALTER TABLE public.wine_consumption_log
  ADD CONSTRAINT wine_consumption_log_cost_basis_check
  CHECK (cost_basis IS NULL OR cost_basis IN
    ('invoice_lot_wac', 'invoice_lot_wac_partial', 'agreed_lot_wac', 'last_purchase_price',
     'invoice_restated', 'pour_lot_wac', 'pour_lot_wac_partial'));

COMMENT ON COLUMN public.wine_consumption_log.cost_basis IS
  'What the cost was read from at sale: invoice_lot_wac, invoice_lot_wac_partial, agreed_lot_wac, last_purchase_price, pour_lot_wac or pour_lot_wac_partial; invoice_restated once a verified invoice moved it.';
