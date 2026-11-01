-- COST OF GOODS READS WHAT SOLD, AND SALES READ THE TILL: ADR 0298 decision 8
-- (A-046, A-018).
--
-- ADDS public.pos_item_sales(house, since), one jsonb value. Per stock item:
--   sales, units, lines  lines naming the item (inventory_id) on this house's
--                        checks closed at or after p_since and not voided.
--                        sales = sum(price x qty), the basis ADR 0298 chose
--                        (net of tax and surcharge, AW17); units is qty as
--                        rung, not bottles (ADR 0297).
--   bottles_out          -sum(quantity_change) over this house's ledger rows
--                        with source 'pos', type 'sale' or 'return', stock
--                        'live', since p_since (decision 1). A void's 'return'
--                        nets out. Not clamped: a return whose sale predates
--                        p_since reads negative.
--   mapped               a mapping of this house points at the item, and the
--                        item is this house's. Such an item is listed with
--                        zeros if it neither sold nor moved.
--   in_house             the item is this house's. A line can name another
--                        house's item: name none whose in_house is false.
-- Then checks, lines, unmapped_lines and unmapped_sales (lines naming no item),
-- unreadable_lines (not an object, or a stock line whose price, qty or id is
-- not a number or uuid: counted, not raised), and the clocks first_check_at,
-- first_move_at and first_sale_at (the earlier of the two).
--
-- A LINE is the object the ingest builds in pos-hub.service.ts (the
-- check.items.map block; claim POS-LINE-KEYS-AT-TOP-LEVEL). price is one
-- unit's; which amount that is differs by adapter (OD-244).
--
-- RAISES only on what the ingest never writes (it coerces price and qty to
-- finite numbers): a numeric string past numeric's range, written directly,
-- fails the whole call. That is a failed read, never a smaller figure (ADR
-- 0067).
--
-- ASSUMES a void is a whole check (pos_checks.voided, with the ledger's
-- 'return' rows), and NOT NULL pos_checks.voided and
-- inventory_transactions.inventory_id (the test pins both). p_restaurant_id is
-- trusted, since service_role reads past RLS: pass the tenant-checked house.
--
-- A FUNCTION, because PostgREST max_rows cannot cut one value (ADR 0292).
-- SECURITY INVOKER, service_role only; the self-check refuses SECURITY
-- DEFINER, a wider grant, and RLS off on a relation it reads.
--
-- THE INDEX covers the closed-check window (the ledger's is
-- idx_inv_txn_restaurant_date). It holds SHARE on pos_checks until this
-- migration commits, so ingest writes wait: 4,197 rows on 2026-11-01, built in
-- 3 to 13 ms on PGlite, inside the 8 s lock_timeout past which one would abort.

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
           (k.inventory_id IS NOT NULL) AS mapped,
           (h.id IS NOT NULL) AS in_house
      FROM ids i
      LEFT JOIN sold s ON s.inventory_id = i.inventory_id
      LEFT JOIN moved mv ON mv.inventory_id = i.inventory_id
      LEFT JOIN mp k ON k.inventory_id = i.inventory_id
      LEFT JOIN public.restaurant_inventory h
        ON h.id = i.inventory_id
       AND h.restaurant_id = p_restaurant_id
  )
  SELECT jsonb_build_object(
    'items', coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
                'inventory_id', p.inventory_id,
                'sales', p.sales,
                'units', p.units,
                'lines', p.lines,
                'bottles_out', p.bottles_out,
                'mapped', p.mapped,
                'in_house', p.in_house) ORDER BY p.inventory_id)
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
  'ADR 0298 decision 8. Per stock item since p_since: till sales (price x qty on '
  'closed, non-voided checks; what a unit price counts differs by adapter, '
  'OD-244), bottles the POS moved, mapped and in_house. Name no item whose '
  'in_house is false. Pass the tenant-checked house. Another per-item reader '
  'of the till calls this (decision 8).';

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
