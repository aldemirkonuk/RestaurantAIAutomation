-- COST OF GOODS READS WHAT SOLD, AND SALES READ THE TILL. ADR 0298 (A-046,
-- A-018): cost of goods summed purchases, and revenue and its Gini read shelf
-- value; none of them read a sale.
--
-- ADDS public.pos_item_sales(house, since): one jsonb value, per stock item
--   sales, units, lines  lines naming the item (inventory_id, stamped at
--                        ingest) on this house's checks CLOSED at or after
--                        p_since and NOT voided. sales = sum(price x qty),
--                        with price as WHAT A LINE IS says. units is qty as
--                        rung (glasses or bottles), not bottles (ADR 0297).
--   bottles_out          -sum(quantity_change) of this house's ledger rows
--                        with source 'pos', type 'sale' or 'return', stock
--                        'live', since p_since. A void's 'return' nets out; a
--                        glass pour writes one 'sale' per bottle it opened.
--                        Manual, count, waste and purchase rows are excluded
--                        (ADR 0298 option 1 of decision 1, and its "Not in
--                        these figures"), and so are 'shadow' rows, which
--                        move shadow_stock (migration baseline_from_production).
--   mapped               a pos_item_mappings row of this house points at the
--                        item and the item is this house's. A mapped item that
--                        neither sold nor moved is listed with zeros, so a
--                        reader weighs "could sell, sold nothing" as 0 and
--                        never a row the till cannot sell (A-013).
-- plus checks, lines, unmapped_lines, unmapped_sales (lines naming no stock
-- item), unreadable_lines (a stock line whose price, qty or id is not a number
-- or uuid, or a line that is not an object: counted, not raised), and three
-- clocks: first_check_at (sales start), first_move_at (cost of goods starts),
-- first_sale_at (the earlier).
--
-- WHAT A LINE IS. The gateway writes pos_checks in one place, pos-hub.service.ts
-- (upsert at :1090). It builds each line at :1045-1061 with qty, price and
-- inventory_id at the top level; claim POS-LINE-KEYS-AT-TOP-LEVEL fails the
-- build if that changes. price is ONE unit's list price in major units, before
-- modifiers and discounts, so price x qty is the line's sale (CanonicalItem,
-- pos-types.ts:17). Each adapter in pos-adapters.ts writes it that way:
--   generic, csv_import  the canonical shape, read as sent (:106-107)
--   square               base_price_money, "for a single unit" (:154-157)
--   clover               price per unit; unitQty in thousandths (:53-56, :211-213)
--   toast                receiptLinePrice, not the selection total (:66-70, :258)
-- Measured on production on 2026-11-01, which holds only csv_import and
-- generic_webhook checks: of the 2,006 checks with a qty other than 1,
-- sum(price x qty) equals the subtotal on 2,005 and sum(price) on none. A tax
-- the menu price includes stays in price (Square and Toast say so); the house's
-- tax basis (founder, 2026-10-12) is not applied here. Modifiers and line
-- discounts are left out (tech-debt.d, fix-pos-lines-carry-unit-price).
--
-- WHAT CAN RAISE. Nothing the ingest writes: the adapters coerce price and qty
-- to finite numbers. A numeric string or product past numeric's range, written
-- directly, raises for the whole call: a failed read, never a smaller figure
-- (ADR 0067).
--
-- WHAT IT ASSUMES. A void is a whole check (pos_checks.voided, with the
-- ledger's 'return' rows), so both halves drop it together.
--
-- WHAT A CALLER CHECKS. p_restaurant_id is trusted (service_role reads past
-- RLS): pass the tenant-checked house, never a body or tool argument. An item
-- id is proved this house's only where mapped is true; check any other against
-- the house's items before naming it. NOT NULL pos_checks.voided and
-- inventory_transactions.inventory_id are leaned on; the SQL test pins both.
--
-- WHY A FUNCTION. One jsonb value cannot be cut by PostgREST max_rows (ADR
-- 0292). SECURITY INVOKER, executable by service_role only: a wider grant or
-- SECURITY DEFINER would leave p_restaurant_id the only boundary, so the
-- self-check refuses both, and RLS off on a relation read here. The index
-- covers the closed_at window. No table, no write, no RLS change.
--
-- THE INDEX LOCK. A plain CREATE INDEX holds writes to pos_checks while it
-- builds. Measured 2026-11-01: production's pos_checks is 4,197 rows (12 MB
-- heap); the same index over 4,197 rows builds in 3 to 13 ms on PGlite. The
-- ingest writes through PostgREST, whose login role (authenticator) sets
-- lock_timeout 8s, so a write waits out the build rather than failing.

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
  mp AS (
    SELECT DISTINCT m.inventory_id
      FROM public.pos_item_mappings m
      JOIN public.restaurant_inventory ri
        ON ri.id = m.inventory_id
       AND ri.restaurant_id = p_restaurant_id
     WHERE m.restaurant_id = p_restaurant_id
  ),
  ids AS (
    SELECT inventory_id FROM sold
    UNION
    SELECT inventory_id FROM moved
    UNION
    SELECT inventory_id FROM mp
  ),
  per_item AS (
    SELECT i.inventory_id,
           coalesce(s.sales, 0) AS sales,
           coalesce(s.units, 0) AS units,
           coalesce(s.lines, 0) AS lines,
           coalesce(mv.bottles_out, 0) AS bottles_out,
           (k.inventory_id IS NOT NULL) AS mapped
      FROM ids i
      LEFT JOIN sold s ON s.inventory_id = i.inventory_id
      LEFT JOIN moved mv ON mv.inventory_id = i.inventory_id
      LEFT JOIN mp k ON k.inventory_id = i.inventory_id
  )
  SELECT jsonb_build_object(
    'items', coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
                'inventory_id', p.inventory_id,
                'sales', p.sales,
                'units', p.units,
                'lines', p.lines,
                'bottles_out', p.bottles_out,
                'mapped', p.mapped) ORDER BY p.inventory_id)
         FROM per_item p),
      '[]'::jsonb),
    'checks', (SELECT count(*) FROM chk),
    'lines', (SELECT count(*) FROM cls),
    'unmapped_lines', (SELECT count(*) FROM cls WHERE kind = 'unmapped'),
    'unmapped_sales', (SELECT coalesce(sum(price * qty), 0) FROM cls
                        WHERE kind = 'unmapped' AND price IS NOT NULL AND qty IS NOT NULL),
    'unreadable_lines', (SELECT count(*) FROM cls WHERE kind = 'unreadable'),
    'first_sale_at', least((SELECT min(closed_at) FROM chk), (SELECT min(first_at) FROM moved)),
    'first_check_at', (SELECT min(closed_at) FROM chk),
    'first_move_at', (SELECT min(first_at) FROM moved)
  )
$$;

COMMENT ON FUNCTION public.pos_item_sales(uuid, timestamptz) IS
  'ADR 0298. Per stock item since p_since: till sales (price x qty on closed, '
  'non-voided checks), bottles the POS moved, and whether a mapping of this '
  'house points at it (mapped items with neither are listed with zeros). units '
  'is qty as rung, not bottles. An unreadable line is counted, not raised; a '
  'value past numeric''s range written directly raises for the whole call. An '
  'item id is proved this house''s only where mapped is true. Pass the '
  'tenant-checked house. A second per-item till reader should call this.';

REVOKE ALL ON FUNCTION public.pos_item_sales(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_item_sales(uuid, timestamptz) TO service_role;

CREATE INDEX IF NOT EXISTS idx_pos_checks_restaurant_closed
  ON public.pos_checks (restaurant_id, closed_at DESC)
  WHERE closed_at IS NOT NULL;

DO $$
DECLARE
  v_oid oid;
BEGIN
  v_oid := to_regprocedure('public.pos_item_sales(uuid, timestamptz)');
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
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relrowsecurity
         AND c.relname IN ('pos_checks', 'pos_item_mappings',
                           'inventory_transactions', 'restaurant_inventory')) <> 4 THEN
    RAISE EXCEPTION 'a relation public.pos_item_sales reads is missing or has RLS off';
  END IF;
END $$;
