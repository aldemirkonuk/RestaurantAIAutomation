-- a_sale_row_carries_the_weighted_cost_of_its_lots (r103, DD-r102-21, approved).
--
-- WRONG BEFORE: a sale's depletion row in inventory_transactions carried
-- cost_total (the money of the bottles that left, a_sale_carries_its_cost) and
-- the draws said which lots, but the row's own unit_cost was still whatever the
-- caller passed: NULL for every till sale. Five bottles taken from 3 at 12.00
-- and 2 at 14.00 left a row that said nothing about its per-bottle cost.
--
-- NOW: when a sale's depletion row has every bottle priced, its unit_cost is
-- the quantity-weighted cost of the lots it drew: (3*12 + 2*14) / 5 = 12.80.
-- Which lots is the row's inventory_lot_draws (txn_id). The figure is
-- cost_total / bottles, so the row can never disagree with its own total.
--
-- Rules, each pinned by supabase/tests/20271210100000_..._test.sql:
--   * only a negative 'sale' row; a waste, comp, count or return keeps the
--     unit_cost its caller gave (those rows are not the till's cost).
--   * only when no bottle left unpriced (unpriced_qty = 0). With any unpriced
--     bottle the weighted cost of the whole row is unknown, never a lower
--     number from the priced part (ADR 0067): unit_cost stays as given (NULL).
--   * six places, like cost_total (20270512100000), so a 10.0049 bottle is not
--     printed as 10.00. unit_cost widens from numeric(10,2) to numeric(14,6).
--   * rows written before this migration are never back-filled: their cost was
--     stamped (or not) by the older rules and stays as it was.
--   * a trigger, not a copy of apply_stock_movement: that function is
--     re-created by several open PRs of this stack; a BEFORE INSERT trigger
--     reads what any version of it writes (cost_total, unpriced_qty).
--
-- Not done here: wine_consumption_log.cost_at_sale (open PR #1815) prices a
-- line from the recorded WAC, not from the lots a sale drew, so the two are
-- different figures until that writer reads this row. See the r103 invoices
-- note; not asserted equal here because that column does not exist in this
-- stack.

BEGIN;

ALTER TABLE public.inventory_transactions ALTER COLUMN unit_cost TYPE numeric(14,6);

COMMENT ON COLUMN public.inventory_transactions.unit_cost IS
  'Per bottle. On a stock-adding row: the price of the lot it made. On a till sale that took bottles out of priced lots: the quantity-weighted cost of the lots it drew, stamped when it left (cost_total / bottles, six places); NULL when any bottle left unpriced. On other rows: what the caller gave.';

CREATE OR REPLACE FUNCTION public.a_sale_row_carries_the_weighted_cost_of_its_lots() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
BEGIN
  IF NEW.transaction_type = 'sale'
     AND NEW.quantity_change < 0
     AND NEW.cost_total IS NOT NULL
     AND NEW.unpriced_qty = 0 THEN
    NEW.unit_cost := round(NEW.cost_total / (-NEW.quantity_change), 6);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.a_sale_row_carries_the_weighted_cost_of_its_lots() IS
  'BEFORE INSERT on inventory_transactions: a fully priced till sale carries cost_total / bottles as its unit_cost (r103, DD-r102-21).';

DROP TRIGGER IF EXISTS trg_a_sale_row_carries_the_weighted_cost ON public.inventory_transactions;
CREATE TRIGGER trg_a_sale_row_carries_the_weighted_cost
  BEFORE INSERT ON public.inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public.a_sale_row_carries_the_weighted_cost_of_its_lots();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.inventory_transactions'::regclass
                    AND tgname = 'trg_a_sale_row_carries_the_weighted_cost' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'trg_a_sale_row_carries_the_weighted_cost is missing';
  END IF;
  IF (SELECT numeric_scale FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'inventory_transactions' AND column_name = 'unit_cost') <> 6 THEN
    RAISE EXCEPTION 'inventory_transactions.unit_cost is not at six places';
  END IF;
END;
$$;

COMMIT;
