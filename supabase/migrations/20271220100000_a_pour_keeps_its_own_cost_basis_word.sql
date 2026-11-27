-- a_pour_keeps_its_own_cost_basis_word (r105, DD-r104-10, approved).
--
-- WHY. A whole-bottle line's cost_at_sale now reads its ledger row (the lots the
-- sale really drew). A glass pour has no such row: record_glass_pour writes no
-- draws, so a pour stays on the recorded weighted cost. The two must not share
-- a word, or a reader cannot tell a measured figure from a recorded one.
--
-- WHAT. wine_consumption_log.cost_basis may also say pour_lot_wac and
-- pour_lot_wac_partial. Nothing else changes: restate_sale_cost still moves only
-- last_purchase_price rows, and a pour costed at the last price paid keeps that
-- word so a verified invoice can still restate it.
--
-- The list is the whole set of seven words on purpose. Several open PRs each
-- re-add this CHECK (agreed_lot_wac, invoice_restated, the pour words), a migration
-- is numbered at merge, and the last one to run owns the list: a shorter list
-- would take another PR's words back out and the database would refuse those
-- sales. Guarded by pos-hub/cost-basis-check-lists-every-word.spec.ts.

ALTER TABLE public.wine_consumption_log
  DROP CONSTRAINT IF EXISTS wine_consumption_log_cost_basis_check;
ALTER TABLE public.wine_consumption_log
  ADD CONSTRAINT wine_consumption_log_cost_basis_check
  CHECK (cost_basis IS NULL OR cost_basis IN
    ('invoice_lot_wac', 'invoice_lot_wac_partial', 'agreed_lot_wac', 'last_purchase_price',
     'invoice_restated', 'pour_lot_wac', 'pour_lot_wac_partial'));

COMMENT ON COLUMN public.wine_consumption_log.cost_basis IS
  'What the cost was read from at sale: invoice_lot_wac, invoice_lot_wac_partial, agreed_lot_wac, last_purchase_price, pour_lot_wac or pour_lot_wac_partial (a pour has no ledger row, r105); invoice_restated once a verified invoice moved it.';
