-- Free samples / consignment as a first-class cost provenance.
--
-- Problem: a distributor sample arrives at a real, deliberate cost of $0. The only two
-- ways to record it before this migration were both wrong:
--   * unit_cost = NULL  → provenance 'estimated', lot excluded from WAC, but also
--     indistinguishable from "we forgot to enter the price".
--   * unit_cost = 0     → provenance 'invoice' (the CASE below keyed off NULL-ness only),
--     which drags weighted-average cost toward zero and silently understates COGS.
--
-- Fix: 'sample' becomes a fourth allowed provenance, apply_stock_movement gains an explicit
-- override so a caller can *state* the provenance instead of having it inferred, and the WAC
-- rollup excludes sample lots from the cost average while still counting them as on-hand
-- (they are drinkable bottles — they belong in stock, not in cost).
--
-- Live-schema verified against project exzueerziesmczwlhomd on 2026-07-29 before writing:
-- constraint def, view def (incl. open_ml, which post-dates the original view migration),
-- and the full function body were read from pg_constraint / pg_get_viewdef / pg_get_functiondef.
-- See .planning/INVENTORY_ADD_REMOVE_SCENARIOS.md.

BEGIN;

-- 1. Allow 'sample' alongside the existing three provenances.
ALTER TABLE inventory_lots
  DROP CONSTRAINT IF EXISTS inventory_lots_cost_provenance_check;

ALTER TABLE inventory_lots
  ADD CONSTRAINT inventory_lots_cost_provenance_check
  CHECK (cost_provenance::text = ANY (ARRAY['invoice', 'estimated', 'manual', 'sample']::text[]));

COMMENT ON COLUMN inventory_lots.cost_provenance IS
  'How unit_cost was established: invoice (from a supplier document), manual (typed by a human), estimated (unknown, inferred), sample (deliberately zero-cost — free sample or consignment; excluded from WAC).';

-- 2. Rollup view: samples count as stock, never as cost.
--    Rebuilt from the LIVE definition, so open_ml survives; sample_qty is appended last
--    because CREATE OR REPLACE VIEW may only add columns at the end.
CREATE OR REPLACE VIEW inventory_lot_rollup AS
SELECT
  inventory_id,
  restaurant_id,
  master_wine_id,
  COALESCE(SUM(qty) FILTER (WHERE stock_state = 'live'), 0)   AS live_qty,
  COALESCE(SUM(qty) FILTER (WHERE stock_state = 'shadow'), 0) AS shadow_qty,
  CASE
    WHEN COALESCE(SUM(qty) FILTER (
      WHERE stock_state = 'live' AND unit_cost IS NOT NULL AND cost_provenance <> 'sample'
    ), 0) > 0
    THEN ROUND(
      SUM(qty * unit_cost) FILTER (
        WHERE stock_state = 'live' AND unit_cost IS NOT NULL AND cost_provenance <> 'sample'
      )
      / SUM(qty) FILTER (
        WHERE stock_state = 'live' AND unit_cost IS NOT NULL AND cost_provenance <> 'sample'
      ), 2)
    ELSE NULL
  END AS wac,
  bool_or(cost_provenance = 'invoice') FILTER (WHERE stock_state = 'live') AS has_invoice_cost,
  count(*) FILTER (WHERE stock_state = 'live') AS live_lot_count,
  count(DISTINCT location_id) FILTER (WHERE stock_state = 'live' AND location_id IS NOT NULL) AS live_location_count,
  COALESCE(SUM(open_bottle_ml) FILTER (WHERE stock_state = 'live'), 0) AS open_ml,
  COALESCE(SUM(qty) FILTER (WHERE stock_state = 'live' AND cost_provenance = 'sample'), 0) AS sample_qty
FROM inventory_lots
GROUP BY inventory_id, restaurant_id, master_wine_id;

COMMENT ON VIEW inventory_lot_rollup IS
  'Phase 2 read model: per-inventory live/shadow on-hand, WAC (over cost-known, non-sample live lots only), location spread, open-bottle ml, and free-sample quantity derived from inventory_lots.';

-- 3. apply_stock_movement: accept an explicit provenance instead of always inferring it.
--    DROP + CREATE rather than CREATE OR REPLACE: a new trailing argument would otherwise
--    produce a second, ambiguous overload. Every caller in the repo passes named arguments
--    (Supabase .rpc / postgrest), so the added optional parameter is backward compatible.
DROP FUNCTION IF EXISTS public.apply_stock_movement(uuid, text, integer, text, text, uuid, text, numeric, uuid, uuid, text);

CREATE FUNCTION public.apply_stock_movement(
  p_inventory_id uuid,
  p_stock_state text,
  p_delta integer,
  p_transaction_type text,
  p_source text,
  p_performed_by uuid DEFAULT NULL::uuid,
  p_reason text DEFAULT NULL::text,
  p_unit_cost numeric DEFAULT NULL::numeric,
  p_location_id uuid DEFAULT NULL::uuid,
  p_order_id uuid DEFAULT NULL::uuid,
  p_idempotency_key text DEFAULT NULL::text,
  p_cost_provenance text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_restaurant uuid; v_wine uuid;
  v_before int; v_after int; v_remaining int; v_txn uuid; v_lot record;
  v_provenance text;
BEGIN
  IF p_delta = 0 THEN RETURN NULL; END IF;
  IF p_stock_state NOT IN ('live','shadow') THEN RAISE EXCEPTION 'invalid stock_state %', p_stock_state; END IF;

  IF p_cost_provenance IS NOT NULL
     AND p_cost_provenance NOT IN ('invoice','estimated','manual','sample') THEN
    RAISE EXCEPTION 'invalid cost_provenance %', p_cost_provenance;
  END IF;

  -- Explicit provenance wins; otherwise fall back to the historical inference.
  v_provenance := COALESCE(
    p_cost_provenance,
    CASE WHEN p_unit_cost IS NOT NULL THEN 'invoice' ELSE 'estimated' END
  );

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_txn FROM inventory_transactions WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_txn IS NOT NULL THEN RETURN v_txn; END IF;
  END IF;

  SELECT restaurant_id, master_wine_id INTO v_restaurant, v_wine
    FROM restaurant_inventory WHERE id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL THEN RAISE EXCEPTION 'inventory % not found', p_inventory_id; END IF;

  SELECT COALESCE(SUM(qty),0) INTO v_before FROM inventory_lots
    WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state;
  v_after := v_before + p_delta;
  IF v_after < 0 THEN RAISE EXCEPTION 'stock would go negative: % + %', v_before, p_delta; END IF;

  IF p_delta > 0 THEN
    INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, unit_cost, cost_provenance, source_order_id)
    VALUES (v_restaurant, p_inventory_id, v_wine, p_location_id, p_stock_state, p_delta, p_unit_cost,
            v_provenance, p_order_id);
  ELSE
    v_remaining := -p_delta;
    FOR v_lot IN SELECT id, qty FROM inventory_lots
        WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state AND qty > 0
        ORDER BY received_at ASC, created_at ASC LOOP
      EXIT WHEN v_remaining <= 0;
      IF v_lot.qty <= v_remaining THEN
        v_remaining := v_remaining - v_lot.qty;
        DELETE FROM inventory_lots WHERE id = v_lot.id;
      ELSE
        UPDATE inventory_lots SET qty = qty - v_remaining, updated_at = now() WHERE id = v_lot.id;
        v_remaining := 0;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO inventory_transactions
    (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change, quantity_before, quantity_after,
     stock_type, unit_cost, performed_by, performed_by_type, reason, order_id, idempotency_key, transaction_date)
  VALUES
    (v_restaurant, p_inventory_id, v_wine, p_transaction_type::inventory_transaction_type, p_source::inventory_transaction_source,
     p_delta, v_before, v_after, p_stock_state, p_unit_cost, p_performed_by,
     CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
     p_reason, p_order_id, p_idempotency_key, now())
  RETURNING id INTO v_txn;

  RETURN v_txn;
END;
$function$;

COMMENT ON FUNCTION public.apply_stock_movement IS
  'Single write path for stock. Positive deltas create a lot; negative deltas consume lots FIFO by received_at. p_cost_provenance overrides the invoice/estimated inference — pass ''sample'' with p_unit_cost = 0 for free samples so the bottles count as stock but not toward WAC.';

-- DROP discards the ACL, so restore the grants the dropped signature carried
-- ({=X/postgres,postgres,anon,authenticated,service_role} read from pg_proc before the swap).
GRANT EXECUTE ON FUNCTION public.apply_stock_movement(uuid, text, integer, text, text, uuid, text, numeric, uuid, uuid, text, text)
  TO anon, authenticated, service_role;

COMMIT;
