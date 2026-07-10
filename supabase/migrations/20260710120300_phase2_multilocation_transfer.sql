-- Phase 2 multi-location: a wine can hold live lots in many locations at once.
-- Applied to prod exzueerziesmczwlhomd on 2026-07-10 (also via MCP migration history).
-- Drop the legacy one-wine-one-location constraint (wine_location_mappings is superseded by lots).
ALTER TABLE wine_location_mappings DROP CONSTRAINT IF EXISTS wine_location_mappings_restaurant_id_wine_id_key;

-- Per-wine per-location breakdown (bar: 3, cellar: 20, ...), with per-location WAC.
CREATE OR REPLACE VIEW inventory_location_breakdown AS
SELECT
  inventory_id, restaurant_id, master_wine_id, location_id, stock_state,
  SUM(qty) AS qty,
  CASE WHEN COALESCE(SUM(qty) FILTER (WHERE unit_cost IS NOT NULL),0) > 0
       THEN ROUND(SUM(qty*unit_cost) FILTER (WHERE unit_cost IS NOT NULL)
                  / SUM(qty) FILTER (WHERE unit_cost IS NOT NULL), 2) END AS wac
FROM inventory_lots
GROUP BY inventory_id, restaurant_id, master_wine_id, location_id, stock_state;

COMMENT ON VIEW inventory_location_breakdown IS 'Phase 2 multi-location: per-wine per-location live/shadow quantities derived from inventory_lots.';

-- Move N bottles of a wine between locations (NULL location = unassigned), preserving cost layers
-- (FIFO from source), writing a balanced transfer pair to the ledger.
CREATE OR REPLACE FUNCTION transfer_stock(
  p_inventory_id    uuid,
  p_from_location_id uuid,
  p_to_location_id  uuid,
  p_qty             int,
  p_performed_by    uuid DEFAULT NULL,
  p_reason          text DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_restaurant uuid; v_wine uuid;
  v_src_before int; v_dst_before int; v_remaining int; v_move int;
  v_lot record; v_group uuid := gen_random_uuid();
BEGIN
  IF p_qty <= 0 THEN RAISE EXCEPTION 'transfer qty must be > 0'; END IF;
  IF p_from_location_id IS NOT DISTINCT FROM p_to_location_id THEN RETURN; END IF;

  SELECT restaurant_id, master_wine_id INTO v_restaurant, v_wine
    FROM restaurant_inventory WHERE id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL THEN RAISE EXCEPTION 'inventory % not found', p_inventory_id; END IF;

  SELECT COALESCE(SUM(qty),0) INTO v_src_before FROM inventory_lots
    WHERE inventory_id = p_inventory_id AND stock_state='live' AND location_id IS NOT DISTINCT FROM p_from_location_id;
  SELECT COALESCE(SUM(qty),0) INTO v_dst_before FROM inventory_lots
    WHERE inventory_id = p_inventory_id AND stock_state='live' AND location_id IS NOT DISTINCT FROM p_to_location_id;
  IF v_src_before < p_qty THEN
    RAISE EXCEPTION 'not enough stock at source location (% available, % requested)', v_src_before, p_qty;
  END IF;

  v_remaining := p_qty;
  FOR v_lot IN SELECT id, qty, unit_cost, cost_provenance, vintage, source_order_id FROM inventory_lots
      WHERE inventory_id = p_inventory_id AND stock_state='live' AND qty > 0
        AND location_id IS NOT DISTINCT FROM p_from_location_id
      ORDER BY received_at ASC, created_at ASC LOOP
    EXIT WHEN v_remaining <= 0;
    v_move := LEAST(v_lot.qty, v_remaining);
    IF v_lot.qty <= v_move THEN
      DELETE FROM inventory_lots WHERE id = v_lot.id;
    ELSE
      UPDATE inventory_lots SET qty = qty - v_move, updated_at = now() WHERE id = v_lot.id;
    END IF;
    INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, unit_cost, cost_provenance, vintage, source_order_id)
    VALUES (v_restaurant, p_inventory_id, v_wine, p_to_location_id, 'live', v_move, v_lot.unit_cost, v_lot.cost_provenance, v_lot.vintage, v_lot.source_order_id);
    v_remaining := v_remaining - v_move;
  END LOOP;

  -- Balanced ledger pair (location-scoped before/after satisfy the CHECK; total is unchanged).
  INSERT INTO inventory_transactions (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change, quantity_before, quantity_after, stock_type, from_location_id, to_location_id, performed_by, performed_by_type, reason, metadata, transaction_date)
  VALUES
    (v_restaurant, p_inventory_id, v_wine, 'transfer', 'manual', -p_qty, v_src_before, v_src_before - p_qty, 'live', p_from_location_id, p_to_location_id, p_performed_by, CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END, COALESCE(p_reason,'location transfer'), jsonb_build_object('transfer_group', v_group, 'leg', 'out'), now()),
    (v_restaurant, p_inventory_id, v_wine, 'transfer', 'manual',  p_qty, v_dst_before, v_dst_before + p_qty, 'live', p_from_location_id, p_to_location_id, p_performed_by, CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END, COALESCE(p_reason,'location transfer'), jsonb_build_object('transfer_group', v_group, 'leg', 'in'), now());
END;
$$ LANGUAGE plpgsql;
