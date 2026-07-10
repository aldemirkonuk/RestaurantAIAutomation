-- Phase 2 write-path cutover: inventory_lots is the SOURCE OF TRUTH for quantity;
-- restaurant_inventory.stock_live / shadow_stock are PROJECTIONS maintained by a lots->inventory
-- trigger. All stock writes go through apply_stock_movement (delta-based, version-locked via
-- FOR UPDATE, idempotent, negative-guarded, ledger-writing). Applied to prod exzueerziesmczwlhomd
-- on 2026-07-10 (also via MCP migration history). See .planning/INVENTORY_SOTA_PLAN.md §6b.

-- 1. Idempotency key on the ledger (blocks double-applied movements: retried webhooks, double counts).
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_transactions_idem
  ON inventory_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 2. Invert the transition trigger: drop the dual-run mirror (inventory->lots) from the read
--    cutover, add the projection (lots->inventory). Also drop the legacy auto-logger
--    (migration 006) which, now that stock_live is a projection, only double-writes ledger noise.
DROP TRIGGER IF EXISTS trg_sync_lots_from_inventory ON restaurant_inventory;
DROP TRIGGER IF EXISTS inventory_change_logger ON restaurant_inventory;

CREATE OR REPLACE FUNCTION project_stock_from_lots() RETURNS TRIGGER AS $$
DECLARE v_inv uuid;
BEGIN
  v_inv := COALESCE(NEW.inventory_id, OLD.inventory_id);
  IF v_inv IS NOT NULL THEN
    UPDATE restaurant_inventory ri SET
      stock_live   = (SELECT COALESCE(SUM(qty),0) FROM inventory_lots WHERE inventory_id = v_inv AND stock_state = 'live'),
      shadow_stock = (SELECT COALESCE(SUM(qty),0) FROM inventory_lots WHERE inventory_id = v_inv AND stock_state = 'shadow')
    WHERE ri.id = v_inv;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_stock_from_lots ON inventory_lots;
CREATE TRIGGER trg_project_stock_from_lots
  AFTER INSERT OR UPDATE OR DELETE ON inventory_lots
  FOR EACH ROW EXECUTE FUNCTION project_stock_from_lots();

-- 3. The single write primitive. Positive delta = new cost lot (FIFO layer); negative = consume
--    oldest lots first. transaction_type/source are enums -> cast the text params.
CREATE OR REPLACE FUNCTION apply_stock_movement(
  p_inventory_id     uuid,
  p_stock_state      text,
  p_delta            int,
  p_transaction_type text,
  p_source           text,
  p_performed_by     uuid    DEFAULT NULL,
  p_reason           text    DEFAULT NULL,
  p_unit_cost        numeric DEFAULT NULL,
  p_location_id      uuid    DEFAULT NULL,
  p_order_id         uuid    DEFAULT NULL,
  p_idempotency_key  text    DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_restaurant uuid; v_wine uuid;
  v_before int; v_after int; v_remaining int; v_txn uuid; v_lot record;
BEGIN
  IF p_delta = 0 THEN RETURN NULL; END IF;                          -- ledger CHECK: quantity_change <> 0
  IF p_stock_state NOT IN ('live','shadow') THEN RAISE EXCEPTION 'invalid stock_state %', p_stock_state; END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_txn FROM inventory_transactions WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_txn IS NOT NULL THEN RETURN v_txn; END IF;                 -- already applied: no-op
  END IF;

  SELECT restaurant_id, master_wine_id INTO v_restaurant, v_wine
    FROM restaurant_inventory WHERE id = p_inventory_id FOR UPDATE; -- serialize writers on this wine
  IF v_restaurant IS NULL THEN RAISE EXCEPTION 'inventory % not found', p_inventory_id; END IF;

  SELECT COALESCE(SUM(qty),0) INTO v_before FROM inventory_lots
    WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state;
  v_after := v_before + p_delta;
  IF v_after < 0 THEN RAISE EXCEPTION 'stock would go negative: % + %', v_before, p_delta; END IF;

  IF p_delta > 0 THEN
    INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, unit_cost, cost_provenance, source_order_id)
    VALUES (v_restaurant, p_inventory_id, v_wine, p_location_id, p_stock_state, p_delta, p_unit_cost,
            CASE WHEN p_unit_cost IS NOT NULL THEN 'invoice' ELSE 'estimated' END, p_order_id);
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
$$ LANGUAGE plpgsql;
