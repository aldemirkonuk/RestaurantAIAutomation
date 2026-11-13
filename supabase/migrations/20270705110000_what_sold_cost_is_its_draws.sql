-- what_sold_cost_is_its_draws: the cost of what the till sold is the cost its
-- bottles carried when they left their lots (cost-math lane 3.1, proposal
-- fork F1; ADR 0298 option 5, which that record names "the long-term answer").
--
-- WRONG BEFORE: /reports, the export, the MCP financial tool and the
-- consultant evidence printed "Cost of goods" as the sum of delivered
-- procurement orders (analytics.service.ts loadDeliveredOrders), so a month
-- with a big buy and few sales showed the buy, and an order with no recorded
-- cost added 0 to it. Since a_sale_carries_its_cost (draws),
-- a_sale_settles_its_cost (settlements) and a_void_gives_back_its_cost
-- (negative draws) every till movement carries its own cost; nothing read it.
--
-- ADDS public.pos_cost_of_goods(house, since), one jsonb value. Over this
-- house's ledger rows with source 'pos', type 'sale' or 'return', stock
-- 'live', dated at or after p_since (the same rows pos_item_sales counts as
-- bottles_out), per item:
--   bottles_out      bottles the till took out (sale rows, glass pours'
--                    opened bottles included).
--   bottles_back     bottles a void gave back (return rows).
--   cost             what the rows' draws stamped when the bottles left
--                    (inventory_transactions.cost_total), plus
--                    settled_after_sale. A matched void's row is negative, so
--                    a sale and its void net to the cost of what stayed sold.
--                    Six places, never rounded here: sum, then round once
--                    (a_settlement_keeps_six_places). Only rows sold in the
--                    window, so cost is the cost of the same sales the
--                    window's revenue counts.
--   settled_after_sale  the settlements (inventory_lot_draw_settlements
--                    .difference) on this item's till rows sold in the window,
--                    whenever the invoice was verified: a late price is part
--                    of the cost of the sale it priced.
--   settled_on_earlier_sales  the settlements MADE at or after p_since on
--                    this item's till rows sold BEFORE p_since. Not in cost:
--                    those bottles' sales are not in this window's revenue,
--                    so adding their price to cost would skew every ratio
--                    (batch review 2026-11-11, finding 1). It is reported by
--                    name so the correction is still seen in the period it
--                    became known (proposal fork F6), feeding no ratio. An
--                    item with only such a settlement is listed with 0
--                    bottles and cost 0.
--   uncosted_out     bottles that left with no known cost:
--                    a row never stamped (unpriced_qty NULL: written before
--                    a_sale_carries_its_cost, or a glass pour #809 has not
--                    taught to stamp yet) counts all its bottles; a stamped
--                    row counts the larger of its unpriced bottles still
--                    unsettled and the bottles no lot was found for.
--   uncosted_back    bottles a void gave back with no known cost: a return
--                    that matched no sale (no sale_key, or the sale has no
--                    draw) counts all its bottles; a matched one counts what
--                    exceeded the sale's draws plus its unpriced draws.
--   in_house         the item is this house's (as pos_item_sales says it).
-- Then cost, settled_after_sale and settled_on_earlier_sales summed over
-- in_house items at six places (the reader rounds once), rows,
-- rows_unstamped and first_move_at.
--
-- AN UNKNOWN IS NEVER 0. cost holds only priced bottles; the reader must not
-- print it as the cost of goods unless every moved item's uncosted_out and
-- uncosted_back are 0 (ADR 0298 decision 1, founder 2026-10-04: "Withhold,
-- say N of M"). The function returns the counts; it does not decide.
--
-- A FUNCTION, because PostgREST max_rows cannot cut one value (ADR 0292): a
-- year of a busy till is far past 1,000 ledger rows. SECURITY INVOKER,
-- service_role only, like pos_item_sales; p_restaurant_id is trusted, so pass
-- the tenant-checked house. The self-check refuses SECURITY DEFINER, a wider
-- grant, and RLS off on a relation it reads.

BEGIN;

CREATE OR REPLACE FUNCTION public.pos_cost_of_goods(p_restaurant_id uuid, p_since timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH rows_ AS (
    SELECT t.id,
           t.inventory_id,
           t.quantity_change AS qc,
           t.unpriced_qty,
           t.cost_total,
           t.transaction_date
      FROM public.inventory_transactions t
     WHERE t.restaurant_id = p_restaurant_id
       AND t.transaction_date >= p_since
       AND t.source = 'pos'
       AND t.transaction_type IN ('sale', 'return')
       AND t.stock_type = 'live'
       AND t.quantity_change <> 0
  ),
  drawn AS (
    SELECT d.txn_id, sum(abs(d.qty)) AS qty
      FROM public.inventory_lot_draws d
     WHERE d.restaurant_id = p_restaurant_id
       AND d.txn_id IN (SELECT id FROM rows_)
     GROUP BY d.txn_id
  ),
  costed AS (
    SELECT r.inventory_id,
           r.transaction_date,
           r.unpriced_qty IS NULL AS unstamped,
           CASE WHEN r.qc < 0 THEN -r.qc ELSE 0 END AS out_,
           CASE WHEN r.qc > 0 THEN r.qc ELSE 0 END AS back_,
           coalesce(r.cost_total, 0) AS cost,
           CASE
             WHEN r.unpriced_qty IS NULL THEN abs(r.qc)
             WHEN r.qc < 0 THEN greatest(coalesce(v.unpriced_qty_remaining, 0),
                                         -r.qc - coalesce(dr.qty, 0))
             ELSE greatest(r.qc - coalesce(dr.qty, 0), 0) + coalesce(v.unpriced_qty_remaining, 0)
           END AS uncosted,
           r.qc
      FROM rows_ r
      LEFT JOIN public.inventory_transaction_settled_cost v ON v.txn_id = r.id
      LEFT JOIN drawn dr ON dr.txn_id = r.id
  ),
  moved AS (
    SELECT c.inventory_id,
           sum(c.out_) AS bottles_out,
           sum(c.back_) AS bottles_back,
           sum(c.cost) AS cost,
           sum(c.uncosted) FILTER (WHERE c.qc < 0) AS uncosted_out,
           sum(c.uncosted) FILTER (WHERE c.qc > 0) AS uncosted_back,
           min(c.transaction_date) AS first_at
      FROM costed c
     GROUP BY c.inventory_id
  ),
  settled AS (
    -- A settlement on a row sold in the window is part of that sale's cost,
    -- whenever it was made (it is always made after the sale). One made in
    -- the window on a row sold before it is named apart and costs nothing here.
    SELECT t.inventory_id,
           sum(s.difference) FILTER (WHERE t.transaction_date >= p_since) AS on_window,
           sum(s.difference) FILTER (WHERE t.transaction_date < p_since
                                       AND s.created_at >= p_since) AS on_earlier
      FROM public.inventory_lot_draw_settlements s
      JOIN public.inventory_transactions t ON t.id = s.txn_id
     WHERE s.restaurant_id = p_restaurant_id
       AND t.restaurant_id = p_restaurant_id
       AND (t.transaction_date >= p_since OR s.created_at >= p_since)
       AND t.source = 'pos'
       AND t.transaction_type IN ('sale', 'return')
       AND t.stock_type = 'live'
     GROUP BY t.inventory_id
  ),
  per_item AS (
    SELECT coalesce(m.inventory_id, s.inventory_id) AS inventory_id,
           coalesce(m.bottles_out, 0) AS bottles_out,
           coalesce(m.bottles_back, 0) AS bottles_back,
           coalesce(m.cost, 0) + coalesce(s.on_window, 0) AS cost,
           coalesce(s.on_window, 0) AS settled_after_sale,
           coalesce(s.on_earlier, 0) AS settled_on_earlier_sales,
           m.uncosted_out,
           m.uncosted_back,
           m.first_at
      FROM moved m
      FULL JOIN settled s ON s.inventory_id = m.inventory_id
  ),
  hi AS (
    SELECT p.*, (h.id IS NOT NULL) AS in_house
      FROM per_item p
      LEFT JOIN public.restaurant_inventory h
        ON h.id = p.inventory_id
       AND h.restaurant_id = p_restaurant_id
  )
  SELECT jsonb_build_object(
    'items', coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
                'inventory_id', p.inventory_id,
                'bottles_out', p.bottles_out,
                'bottles_back', p.bottles_back,
                'cost', p.cost,
                'settled_after_sale', p.settled_after_sale,
                'settled_on_earlier_sales', p.settled_on_earlier_sales,
                'uncosted_out', coalesce(p.uncosted_out, 0),
                'uncosted_back', coalesce(p.uncosted_back, 0),
                'in_house', p.in_house) ORDER BY p.inventory_id)
         FROM hi p),
      '[]'::jsonb),
    'cost', (SELECT sum(cost) FROM hi WHERE in_house),
    'settled_after_sale', (SELECT sum(settled_after_sale) FROM hi WHERE in_house),
    'settled_on_earlier_sales', (SELECT sum(settled_on_earlier_sales) FROM hi WHERE in_house),
    'rows', (SELECT count(*) FROM costed),
    'rows_unstamped', (SELECT count(*) FROM costed WHERE unstamped),
    'first_move_at', (SELECT min(first_at) FROM per_item)
  )
$$;

COMMENT ON FUNCTION public.pos_cost_of_goods(uuid, timestamptz) IS
  'Cost-math lane 3.1. Per stock item since p_since, over the till''s sale and '
  'return ledger rows (the rows pos_item_sales counts as bottles_out): bottles '
  'out and back, the cost their draws stamped (six places, a matched void '
  'negative) plus the settlements on those same rows (settled_after_sale), '
  'the settlements made in the window on till rows sold before it, apart and '
  'not in cost (settled_on_earlier_sales, proposal F6), and the bottles whose cost '
  'is unknown (uncosted_out, uncosted_back). cost holds priced bottles only: '
  'never print it as cost of goods while any uncosted count is above 0 (ADR '
  '0298 d1). Pass the tenant-checked house.';

REVOKE ALL ON FUNCTION public.pos_cost_of_goods(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_cost_of_goods(uuid, timestamptz) TO service_role;

DO $$
DECLARE
  v_oid oid;
BEGIN
  v_oid := to_regprocedure('public.pos_cost_of_goods(uuid, timestamptz)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'public.pos_cost_of_goods was not created';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'public.pos_cost_of_goods must stay SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'public.pos_cost_of_goods is executable by anon or authenticated';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relrowsecurity
         AND c.relname IN ('inventory_transactions', 'inventory_lot_draws',
                           'inventory_lot_draw_settlements', 'restaurant_inventory')) <> 4 THEN
    RAISE EXCEPTION 'a relation public.pos_cost_of_goods reads is missing or has RLS off';
  END IF;
END $$;

COMMIT;
