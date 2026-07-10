-- Phase 2 (2c) by-the-glass: inventory_lots.open_bottle_ml is the source of truth for open bottles.
-- A pour depletes the open bottle in ml; when it can't cover a pour, a sealed bottle is opened
-- (qty--) and a bottle-level 'sale' ledger row is written. stock_live stays = sealed bottles.
-- Applied to prod exzueerziesmczwlhomd on 2026-07-10 (also via MCP migration history).

-- Expose open ml on the rollup (sealed count stays live_qty).
CREATE OR REPLACE VIEW inventory_lot_rollup AS
SELECT
  inventory_id, restaurant_id, master_wine_id,
  COALESCE(SUM(qty) FILTER (WHERE stock_state = 'live'), 0)   AS live_qty,
  COALESCE(SUM(qty) FILTER (WHERE stock_state = 'shadow'), 0) AS shadow_qty,
  CASE WHEN COALESCE(SUM(qty) FILTER (WHERE stock_state = 'live' AND unit_cost IS NOT NULL),0) > 0
       THEN ROUND(SUM(qty*unit_cost) FILTER (WHERE stock_state = 'live' AND unit_cost IS NOT NULL)
                  / SUM(qty) FILTER (WHERE stock_state = 'live' AND unit_cost IS NOT NULL), 2)
       ELSE NULL END AS wac,
  bool_or(cost_provenance = 'invoice') FILTER (WHERE stock_state = 'live') AS has_invoice_cost,
  count(*) FILTER (WHERE stock_state = 'live') AS live_lot_count,
  count(DISTINCT location_id) FILTER (WHERE stock_state = 'live' AND location_id IS NOT NULL) AS live_location_count,
  COALESCE(SUM(open_bottle_ml) FILTER (WHERE stock_state = 'live'), 0) AS open_ml
FROM inventory_lots
GROUP BY inventory_id, restaurant_id, master_wine_id;

CREATE OR REPLACE FUNCTION record_glass_pour(
  p_inventory_id    uuid,
  p_pours           int  DEFAULT 1,
  p_pour_ml         int  DEFAULT NULL,   -- NULL -> inventory pour_size_ml (fallback 150)
  p_location_id     uuid DEFAULT NULL,   -- prefer a lot at this location
  p_source          text DEFAULT 'pos',
  p_performed_by    uuid DEFAULT NULL,
  p_reason          text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_restaurant uuid; v_wine uuid; v_bottle_ml int; v_pour_ml int;
  v_lot inventory_lots%ROWTYPE; v_bottles_opened int := 0; v_g int; v_need int;
  v_before int; v_after int; v_txn uuid;
BEGIN
  IF p_pours <= 0 THEN RETURN jsonb_build_object('poured', 0); END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_txn FROM inventory_transactions WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_txn IS NOT NULL THEN RETURN jsonb_build_object('idempotent', true, 'txn', v_txn); END IF;
  END IF;

  SELECT ri.restaurant_id, ri.master_wine_id, COALESCE(ri.bottle_size_ml, 750),
         COALESCE(p_pour_ml, ri.pour_size_ml, 150)
    INTO v_restaurant, v_wine, v_bottle_ml, v_pour_ml
    FROM restaurant_inventory ri WHERE ri.id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL THEN RAISE EXCEPTION 'inventory % not found', p_inventory_id; END IF;

  v_before := (SELECT COALESCE(SUM(qty),0) FROM inventory_lots WHERE inventory_id=p_inventory_id AND stock_state='live');

  FOR v_g IN 1..p_pours LOOP
    SELECT * INTO v_lot FROM inventory_lots
      WHERE inventory_id=p_inventory_id AND stock_state='live'
        AND (p_location_id IS NULL OR location_id IS NOT DISTINCT FROM p_location_id)
        AND (open_bottle_ml > 0 OR qty > 0)
      ORDER BY (open_bottle_ml > 0) DESC, received_at ASC, created_at ASC LIMIT 1;
    IF v_lot.id IS NULL THEN
      SELECT * INTO v_lot FROM inventory_lots
        WHERE inventory_id=p_inventory_id AND stock_state='live' AND (open_bottle_ml>0 OR qty>0)
        ORDER BY (open_bottle_ml>0) DESC, received_at ASC, created_at ASC LIMIT 1;
    END IF;
    IF v_lot.id IS NULL THEN RAISE EXCEPTION 'no stock to pour for inventory %', p_inventory_id; END IF;

    IF v_lot.open_bottle_ml >= v_pour_ml THEN
      UPDATE inventory_lots SET open_bottle_ml = open_bottle_ml - v_pour_ml, updated_at=now() WHERE id=v_lot.id;
    ELSIF v_lot.qty >= 1 THEN
      v_need := v_pour_ml - v_lot.open_bottle_ml;
      UPDATE inventory_lots SET qty = qty - 1, open_bottle_ml = v_bottle_ml - v_need, updated_at=now() WHERE id=v_lot.id;
      v_bottles_opened := v_bottles_opened + 1;
    ELSE
      RAISE EXCEPTION 'insufficient stock for a full pour on inventory %', p_inventory_id;
    END IF;
  END LOOP;

  v_after := (SELECT COALESCE(SUM(qty),0) FROM inventory_lots WHERE inventory_id=p_inventory_id AND stock_state='live');

  IF v_bottles_opened > 0 THEN
    INSERT INTO inventory_transactions
      (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change, quantity_before, quantity_after,
       stock_type, performed_by, performed_by_type, reason, idempotency_key, metadata, transaction_date)
    VALUES
      (v_restaurant, p_inventory_id, v_wine, 'sale', p_source::inventory_transaction_source, -v_bottles_opened, v_before, v_after,
       'live', p_performed_by, CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
       COALESCE(p_reason, 'by-the-glass pours'), p_idempotency_key,
       jsonb_build_object('pours', p_pours, 'pour_ml', v_pour_ml, 'bottles_opened', v_bottles_opened), now())
    RETURNING id INTO v_txn;
  END IF;

  RETURN jsonb_build_object(
    'pours', p_pours, 'pour_ml', v_pour_ml, 'bottles_opened', v_bottles_opened,
    'sealed_now', v_after,
    'open_ml_now', (SELECT COALESCE(SUM(open_bottle_ml),0) FROM inventory_lots WHERE inventory_id=p_inventory_id AND stock_state='live'),
    'txn', v_txn);
END;
$$ LANGUAGE plpgsql;
