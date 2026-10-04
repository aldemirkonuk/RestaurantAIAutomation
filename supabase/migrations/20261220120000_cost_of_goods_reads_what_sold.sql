-- COST OF GOODS READS WHAT SOLD, AND SALES READ THE TILL.
-- ADR 0298. Analytics-walk findings A-046 and A-018 (AW16 registry with them).
--
-- WHAT WAS WRONG. AnalyticsService.getFinancialSummary called the sum of
-- DELIVERED purchase orders over 365 days "cogs", and menu price x bottles on
-- hand "revenue". /reports printed the first as "Cost of goods (365d)" and
-- divided cost by the second. getRiskProfile computed the revenue Gini and SKU
-- HHI over menu price x bottles on hand. None of those numbers reads a sale.
-- The owner-quarter sim's analytics walk (2026-10-03, read-only) measured
-- Tuzlu Ruzgar: purchases of $39,302 shown as cost of goods against about
-- $47,914 of goods that sold in Jul-Aug, $28,889 of shelf value shown as
-- revenue, and a Gini of 0.78 where the till's per-item sales give 0.5651.
--
-- WHAT THIS FILE ADDS. One read, public.pos_item_sales(house, since), that
-- returns one jsonb value with two independent measures per stock item:
--
--   sales, units, lines  from pos_checks.items: the lines that name a stock
--                        item (inventory_id, stamped at ingest), on this
--                        house's checks that CLOSED at or after p_since and
--                        are NOT voided. sales = sum(price x qty). price is the
--                        line's unit price before tax and surcharge.
--   bottles_out          from inventory_transactions: this house's rows with
--                        source 'pos', type 'sale' or 'return', stock 'live',
--                        dated at or after p_since; bottles_out =
--                        -sum(quantity_change). A POS void writes a 'return'
--                        of +qty, so it nets out. A glass pour writes one
--                        'sale' of -bottles_opened. Manual, count, waste,
--                        purchase and system rows are excluded on purpose:
--                        this is the stock the till moved.
--
-- plus the counts a reader needs to say what it could not read: checks,
-- lines, unmapped_lines and unmapped_sales (lines naming no stock item; the
-- sales sum covers the readable ones), unreadable_lines (lines naming a stock
-- item whose price, qty or id cannot be read; never raised), and
-- first_sale_at (the earliest closed check or POS ledger row in the window).
--
-- WHY A FUNCTION. One jsonb value cannot be cut by PostgREST max_rows (ADR
-- 0292's row cap), the aggregation stays in the database, and the output is
-- bounded by the house's item count. SECURITY INVOKER: it reads with the
-- caller's rights; only service_role may execute it.
--
-- THE INDEX. The window is on closed_at; pos_checks had indexes on opened_at
-- and on open checks only, so a year of closed checks was a heap scan per
-- house. The ledger window already has idx_inv_txn_restaurant_date.
--
-- No table, no write, no RLS change.

CREATE OR REPLACE FUNCTION public.pos_item_sales(p_restaurant_id uuid, p_since timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH chk AS (
    SELECT c.closed_at, c.items
      FROM public.pos_checks c
     WHERE c.restaurant_id = p_restaurant_id
       AND c.closed_at IS NOT NULL
       AND c.closed_at >= p_since
       AND NOT c.voided
  ),
  ln AS (
    SELECT e.line, jsonb_typeof(e.line) = 'object' AS is_obj
      FROM chk
     CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(chk.items) = 'array' THEN chk.items ELSE '[]'::jsonb END
           ) AS e(line)
  ),
  typed AS (
    SELECT ln.is_obj,
           CASE WHEN ln.is_obj THEN ln.line -> 'inventory_id' END AS inv_j,
           CASE WHEN ln.is_obj
                 AND (jsonb_typeof(ln.line -> 'price') = 'number'
                      OR (jsonb_typeof(ln.line -> 'price') = 'string'
                          AND (ln.line ->> 'price') ~ '^\s*[-+]?[0-9]+(\.[0-9]+)?\s*$'))
                THEN (ln.line ->> 'price')::numeric END AS price,
           CASE WHEN ln.is_obj
                 AND (jsonb_typeof(ln.line -> 'qty') = 'number'
                      OR (jsonb_typeof(ln.line -> 'qty') = 'string'
                          AND (ln.line ->> 'qty') ~ '^\s*[-+]?[0-9]+(\.[0-9]+)?\s*$'))
                THEN (ln.line ->> 'qty')::numeric END AS qty
      FROM ln
  ),
  cls AS (
    SELECT t.price,
           t.qty,
           CASE
             WHEN NOT t.is_obj THEN 'unreadable'
             WHEN t.inv_j IS NULL OR jsonb_typeof(t.inv_j) = 'null' THEN 'unmapped'
             WHEN jsonb_typeof(t.inv_j) <> 'string'
               OR (t.inv_j #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               THEN 'unreadable'
             WHEN t.price IS NULL OR t.qty IS NULL THEN 'unreadable'
             ELSE 'mapped'
           END AS kind,
           CASE WHEN jsonb_typeof(t.inv_j) = 'string'
                 AND (t.inv_j #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (t.inv_j #>> '{}')::uuid END AS inventory_id
      FROM typed t
  ),
  sold AS (
    SELECT inventory_id, sum(price * qty) AS sales, sum(qty) AS units, count(*) AS lines
      FROM cls
     WHERE kind = 'mapped'
     GROUP BY inventory_id
  ),
  moved AS (
    SELECT t.inventory_id, -sum(t.quantity_change) AS bottles_out, min(t.transaction_date) AS first_at
      FROM public.inventory_transactions t
     WHERE t.restaurant_id = p_restaurant_id
       AND t.transaction_date >= p_since
       AND t.source = 'pos'
       AND t.transaction_type IN ('sale', 'return')
       AND t.stock_type = 'live'
     GROUP BY t.inventory_id
  ),
  per_item AS (
    SELECT coalesce(s.inventory_id, m.inventory_id) AS inventory_id,
           coalesce(s.sales, 0) AS sales,
           coalesce(s.units, 0) AS units,
           coalesce(s.lines, 0) AS lines,
           coalesce(m.bottles_out, 0) AS bottles_out
      FROM sold s
      FULL JOIN moved m ON m.inventory_id = s.inventory_id
  )
  SELECT jsonb_build_object(
    'items', coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
                'inventory_id', p.inventory_id,
                'sales', p.sales,
                'units', p.units,
                'lines', p.lines,
                'bottles_out', p.bottles_out) ORDER BY p.inventory_id)
         FROM per_item p),
      '[]'::jsonb),
    'checks', (SELECT count(*) FROM chk),
    'lines', (SELECT count(*) FROM cls),
    'unmapped_lines', (SELECT count(*) FROM cls WHERE kind = 'unmapped'),
    'unmapped_sales', (SELECT coalesce(sum(price * qty), 0) FROM cls
                        WHERE kind = 'unmapped' AND price IS NOT NULL AND qty IS NOT NULL),
    'unreadable_lines', (SELECT count(*) FROM cls WHERE kind = 'unreadable'),
    'first_sale_at', least((SELECT min(closed_at) FROM chk), (SELECT min(first_at) FROM moved))
  )
$$;

COMMENT ON FUNCTION public.pos_item_sales(uuid, timestamptz) IS
  'ADR 0298. Per stock item since p_since: till sales (price x qty of lines '
  'naming the item on closed, non-voided checks) and bottles the POS moved '
  '(-sum of source pos sale/return ledger rows). One jsonb value; never raises '
  'on a malformed line, counts it. Read by AnalyticsService (cost of goods, '
  'sales, revenue concentration). A second per-item till reader should call '
  'this rather than aggregate pos_checks.items again.';

REVOKE ALL ON FUNCTION public.pos_item_sales(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_item_sales(uuid, timestamptz) TO service_role;

CREATE INDEX IF NOT EXISTS idx_pos_checks_restaurant_closed
  ON public.pos_checks (restaurant_id, closed_at DESC)
  WHERE closed_at IS NOT NULL;

DO $$
DECLARE
  v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pos_item_sales';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'public.pos_item_sales was not created';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'public.pos_item_sales must stay SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'public.pos_item_sales is executable by anon or authenticated';
  END IF;
END $$;
