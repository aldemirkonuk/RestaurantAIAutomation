-- the_settled_cost_reads_only_its_rows: the settled-cost view reads only the
-- ledger rows it is asked about (r41 invoices audit, gap 5).
--
-- WRONG BEFORE: inventory_transaction_settled_cost (a_settlement_keeps_six_places)
-- joined each ledger row to two GROUPED subqueries: the sum of every
-- settlement in the database by txn_id, and the sum of every settled unpriced
-- draw in the database by txn_id. Postgres cannot push a join key into a
-- grouped subquery, so any read of the view built both sums for EVERY house
-- and all time before keeping the rows it was asked for. pos_cost_of_goods
-- (what_sold_cost_is_its_draws) joins the view to one house's till rows on
-- every /reports load: in the audit's EXPLAIN, a house with 200 sales read
-- 200,200 ledger rows, 200,200 draws and 100,148 settlements, because the
-- other house had 200,000 sales. The cost grows with every house's history,
-- not with the window being read.
--
-- NOW: the same columns, the same values, computed per ledger row with two
-- LATERAL sums keyed on txn_id (idx_inventory_lot_draw_settlements_txn,
-- idx_inventory_lot_draws_txn) and the draw-was-settled test keyed on
-- draw_id (inventory_lot_draw_settlements_once leads with draw_id). The view
-- has no top-level grouping, so it folds into the caller's query and a join
-- or filter on txn_id reaches the ledger row first: a read of N rows sums
-- only those N rows' settlements and draws.
--
-- Nothing else changes: the column list, names, types (settled_difference and
-- settled_cost_total stay numeric(16,6)), security_invoker and the grants are
-- the same, and supabase/tests/20271120141100_..._test.sql checks the new
-- definition row for row against the old one over two houses.
--
-- JIT OFF FOR pos_cost_of_goods. A SQL function's body is planned without
-- its arguments' values, so the planner guesses how many till rows one house
-- has and prices the per-row sums on that guess. On a measured bench (two
-- houses, 200 and 50,000 settled sales) the guess put the plan's cost past
-- jit_above_cost (100,000), and compiling it took about 40 ms of a call whose
-- work takes 2 to 3 ms. One house's window is never a long analytical query,
-- so the function runs with jit off; nothing else about it changes.
--
-- "No settlement" was `s.txn_id IS NULL` on the outer join; the lateral sum
-- always returns one row, so it is `s.n = 0` here. A settlement row whose
-- difference is NULL still counts as a settlement, as before.

BEGIN;

CREATE OR REPLACE VIEW public.inventory_transaction_settled_cost
WITH (security_invoker = true) AS
SELECT t.id AS txn_id,
       t.restaurant_id,
       t.inventory_id,
       t.cost_total,
       COALESCE(s.difference, 0)::numeric(16,6) AS settled_difference,
       (CASE WHEN t.cost_total IS NULL AND s.n = 0 THEN NULL
             ELSE COALESCE(t.cost_total, 0) + COALESCE(s.difference, 0)
        END)::numeric(16,6) AS settled_cost_total,
       t.unpriced_qty,
       (t.unpriced_qty - COALESCE(u.qty, 0))::integer AS unpriced_qty_remaining
  FROM public.inventory_transactions t
  CROSS JOIN LATERAL (
        SELECT sum(x.difference) AS difference, count(*) AS n
          FROM public.inventory_lot_draw_settlements x
         WHERE x.txn_id = t.id) s
  CROSS JOIN LATERAL (
        SELECT sum(abs(d.qty)) AS qty
          FROM public.inventory_lot_draws d
         WHERE d.txn_id = t.id
           AND d.unit_cost IS NULL
           AND EXISTS (SELECT 1 FROM public.inventory_lot_draw_settlements x2
                        WHERE x2.draw_id = d.id)) u;

COMMENT ON VIEW public.inventory_transaction_settled_cost IS
  'A ledger row''s cost with its settlements added (a_sale_settles_its_cost). cost_total is what was stamped when the bottles left; settled_difference is the sum of inventory_lot_draw_settlements.difference; settled_cost_total is the two together, NULL only when nothing was ever priced or settled. Both exact at six places (a_settlement_keeps_six_places): sum them, then round once. unpriced_qty_remaining is unpriced_qty less the bottles of unpriced draws that have since been settled. Each row sums only its own settlements and draws (the_settled_cost_reads_only_its_rows), so a read of some rows never sums every house''s.';

REVOKE ALL ON public.inventory_transaction_settled_cost FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.inventory_transaction_settled_cost TO service_role;

ALTER FUNCTION public.pos_cost_of_goods(uuid, timestamptz) SET jit = off;

-- Structural assertions (catalogs only).
DO $$
DECLARE
  r record;
  v_def text;
BEGIN
  FOR r IN
    SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS t
      FROM pg_attribute a
     WHERE a.attrelid = 'public.inventory_transaction_settled_cost'::regclass
       AND a.attname IN ('settled_difference', 'settled_cost_total')
  LOOP
    IF r.t <> 'numeric(16,6)' THEN
      RAISE EXCEPTION 'the_settled_cost_reads_only_its_rows: % is %, not numeric(16,6)', r.attname, r.t;
    END IF;
  END LOOP;
  SELECT pg_get_viewdef('public.inventory_transaction_settled_cost'::regclass) INTO v_def;
  IF position('GROUP BY' in upper(v_def)) > 0 THEN
    RAISE EXCEPTION 'the_settled_cost_reads_only_its_rows: the view groups again, so a read sums every house';
  END IF;
  IF NOT (SELECT coalesce((SELECT 'security_invoker=true' = ANY (reloptions)
                             FROM pg_class WHERE oid = 'public.inventory_transaction_settled_cost'::regclass), false)) THEN
    RAISE EXCEPTION 'the_settled_cost_reads_only_its_rows: the view lost security_invoker';
  END IF;
  IF NOT coalesce((SELECT 'jit=off' = ANY (proconfig) FROM pg_proc
                    WHERE oid = 'public.pos_cost_of_goods(uuid, timestamptz)'::regprocedure), false) THEN
    RAISE EXCEPTION 'the_settled_cost_reads_only_its_rows: pos_cost_of_goods does not run with jit off';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.pos_cost_of_goods(uuid, timestamptz)'::regprocedure) THEN
    RAISE EXCEPTION 'the_settled_cost_reads_only_its_rows: pos_cost_of_goods must stay SECURITY INVOKER';
  END IF;
  IF has_table_privilege('anon', 'public.inventory_transaction_settled_cost', 'SELECT')
     OR has_table_privilege('authenticated', 'public.inventory_transaction_settled_cost', 'SELECT') THEN
    RAISE EXCEPTION 'the_settled_cost_reads_only_its_rows: the settled view is reachable by a client role';
  END IF;
END;
$$;

COMMIT;
