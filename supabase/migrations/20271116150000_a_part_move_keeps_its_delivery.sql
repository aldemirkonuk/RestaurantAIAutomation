-- A part move keeps where the stock came from (found during r36 invoices R1,
-- 2026-11-13).
--
-- WHY. transfer_stock splits a lot when only part of it moves, by inserting a
-- new lot for the part. The insert named no delivery_id, no cost_state (so the
-- column default, 'provisional') and no received_at (so now()). Moving 2 of a
-- delivery's 6 bottles to the bar therefore made a lot that reads as stock
-- from no delivery:
--   * finalise_delivery_cost settles lots by delivery_id, so VERIFIED never
--     reaches those 2 bottles; they and every sale drawn from them stay on
--     the door's estimate for good;
--   * FIFO orders by received_at, so the moved bottles are drawn last;
--   * anything that tells delivery stock from other stock by delivery_id
--     (the opening-cost function of feat/opening-stock-states-its-cost)
--     would take them for opening stock.
--
-- WHAT. The split now carries delivery_id, cost_state and received_at from
-- the lot it left. The rest of the body is copied verbatim from
-- 20270303100000_a_used_up_lot_is_kept (a whole lot still just changes
-- location_id). The sim lane's 20270101100000_a_moved_bottle_keeps_its_lot
-- made the same repair on branches with no PR; this is the same idea on the
-- train that merges.
--
-- NOT DONE. Lots already split before this have no delivery_id, and nothing
-- reliable ties them back to their delivery; they are left as they are.

CREATE OR REPLACE FUNCTION public.transfer_stock(p_inventory_id uuid, p_from_location_id uuid, p_to_location_id uuid, p_qty integer, p_performed_by uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
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
  FOR v_lot IN SELECT id, qty, unit_cost, cost_provenance, vintage, source_order_id, delivery_id, cost_state, received_at FROM inventory_lots
      WHERE inventory_id = p_inventory_id AND stock_state='live' AND qty > 0
        AND location_id IS NOT DISTINCT FROM p_from_location_id
      ORDER BY received_at ASC, created_at ASC LOOP
    EXIT WHEN v_remaining <= 0;
    v_move := LEAST(v_lot.qty, v_remaining);
    IF v_lot.qty <= v_move THEN
      -- a_used_up_lot_is_kept (R6): the same lot in a new place, keeping its
      -- id, received_at, delivery and cost_state (was: delete and copy).
      UPDATE inventory_lots SET location_id = p_to_location_id, updated_at = now() WHERE id = v_lot.id;
    ELSE
      UPDATE inventory_lots SET qty = qty - v_move, updated_at = now() WHERE id = v_lot.id;
      -- The part that moved is the same stock: it keeps the delivery that
      -- booked it, its cost_state and its received_at (r36 R1). Without
      -- them VERIFIED never settles it, FIFO dates it today, and it reads
      -- as stock from no delivery.
      INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, unit_cost, cost_provenance, vintage, source_order_id, delivery_id, cost_state, received_at)
      VALUES (v_restaurant, p_inventory_id, v_wine, p_to_location_id, 'live', v_move, v_lot.unit_cost, v_lot.cost_provenance, v_lot.vintage, v_lot.source_order_id, v_lot.delivery_id, v_lot.cost_state, v_lot.received_at);
    END IF;
    v_remaining := v_remaining - v_move;
  END LOOP;

  -- Balanced ledger pair (location-scoped before/after satisfy the CHECK; total is unchanged).
  INSERT INTO inventory_transactions (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change, quantity_before, quantity_after, stock_type, from_location_id, to_location_id, performed_by, performed_by_type, reason, metadata, transaction_date)
  VALUES
    (v_restaurant, p_inventory_id, v_wine, 'transfer', 'manual', -p_qty, v_src_before, v_src_before - p_qty, 'live', p_from_location_id, p_to_location_id, p_performed_by, CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END, COALESCE(p_reason,'location transfer'), jsonb_build_object('transfer_group', v_group, 'leg', 'out'), now()),
    (v_restaurant, p_inventory_id, v_wine, 'transfer', 'manual',  p_qty, v_dst_before, v_dst_before + p_qty, 'live', p_from_location_id, p_to_location_id, p_performed_by, CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END, COALESCE(p_reason,'location transfer'), jsonb_build_object('transfer_group', v_group, 'leg', 'in'), now());
END;
$$;

DO $$
BEGIN
  IF position('v_lot.delivery_id, v_lot.cost_state, v_lot.received_at' in
       (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'transfer_stock')) = 0 THEN
    RAISE EXCEPTION 'transfer_stock: a part move must keep its delivery, cost_state and received_at';
  END IF;
END;
$$;
