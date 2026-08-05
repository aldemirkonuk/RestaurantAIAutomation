-- Phase 2 POS→pour: pour_events = glass-level depletion log AND the idempotency store for pours
-- (a pour from an already-open bottle writes no ledger row, so the ledger alone can't dedupe it).
-- Also the per-glass velocity data that later unblocks safety-stock / ABC / forecasting.
-- Applied to prod exzueerziesmczwlhomd on 2026-07-10 (also via MCP migration history).
CREATE TABLE IF NOT EXISTS pour_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   uuid NOT NULL,
  inventory_id    uuid NOT NULL,
  master_wine_id  uuid,
  pours           int  NOT NULL,
  pour_ml         int  NOT NULL,
  bottles_opened  int  NOT NULL DEFAULT 0,
  location_id     uuid,
  source          varchar(20) NOT NULL DEFAULT 'pos',
  performed_by    uuid,
  idempotency_key text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pour_events_ri ON pour_events(restaurant_id, inventory_id, created_at DESC);
ALTER TABLE pour_events ENABLE ROW LEVEL SECURITY;

-- record_glass_pour now logs to pour_events (idempotency source of truth for pours).
CREATE OR REPLACE FUNCTION record_glass_pour(
  p_inventory_id    uuid,
  p_pours           int  DEFAULT 1,
  p_pour_ml         int  DEFAULT NULL,
  p_location_id     uuid DEFAULT NULL,
  p_source          text DEFAULT 'pos',
  p_performed_by    uuid DEFAULT NULL,
  p_reason          text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_restaurant uuid; v_wine uuid; v_bottle_ml int; v_pour_ml int;
  v_lot inventory_lots%ROWTYPE; v_bottles_opened int := 0; v_g int; v_need int;
  v_before int; v_after int; v_txn uuid; v_existing uuid;
BEGIN
  IF p_pours <= 0 THEN RETURN jsonb_build_object('poured', 0); END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM pour_events WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('idempotent', true, 'pour_event', v_existing); END IF;
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
       stock_type, performed_by, performed_by_type, reason, metadata, transaction_date)
    VALUES
      (v_restaurant, p_inventory_id, v_wine, 'sale', p_source::inventory_transaction_source, -v_bottles_opened, v_before, v_after,
       'live', p_performed_by, CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
       COALESCE(p_reason, 'by-the-glass pours'),
       jsonb_build_object('pours', p_pours, 'pour_ml', v_pour_ml, 'bottles_opened', v_bottles_opened), now())
    RETURNING id INTO v_txn;
  END IF;

  INSERT INTO pour_events (restaurant_id, inventory_id, master_wine_id, pours, pour_ml, bottles_opened, location_id, source, performed_by, idempotency_key)
  VALUES (v_restaurant, p_inventory_id, v_wine, p_pours, v_pour_ml, v_bottles_opened, p_location_id, p_source, p_performed_by, p_idempotency_key);

  RETURN jsonb_build_object(
    'pours', p_pours, 'pour_ml', v_pour_ml, 'bottles_opened', v_bottles_opened,
    'sealed_now', v_after,
    'open_ml_now', (SELECT COALESCE(SUM(open_bottle_ml),0) FROM inventory_lots WHERE inventory_id=p_inventory_id AND stock_state='live'),
    'txn', v_txn);
END;
$$ LANGUAGE plpgsql;
