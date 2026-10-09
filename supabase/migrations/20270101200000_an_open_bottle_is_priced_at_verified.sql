-- ===========================================================================
-- F-443 — an open bottle of a delivery is repriced when the delivery is VERIFIED
-- ===========================================================================
--
-- WHAT WAS WRONG. finalise_delivery_cost (newest and only definition:
-- 20260906233000_stock_at_the_door_cost_at_verified.sql:285-386) selects the
-- delivery's lots with `AND qty > 0` (:339). A lot whose sealed bottles have
-- all been poured or counted out but whose open bottle still stands is kept at
-- qty 0 with its open_bottle_ml (record_glass_pour; and since
-- a_moved_bottle_keeps_its_lot, apply_stock_movement and transfer_stock too).
-- At VERIFIED such a lot was skipped: its ml kept the provisional (estimated or
-- missing) price and cost_state 'provisional' for good, so the glasses still
-- to be poured from it were costed at a price nobody agreed.
--
-- WHAT THIS MIGRATION DOES. The lot filter becomes
-- `AND (qty > 0 OR open_bottle_ml > 0)`. Nothing else changes: the body is the
-- 20260906233000 one verbatim apart from that line and two comments, the
-- signature is the same (CREATE OR REPLACE, no overload, ACL kept), and the
-- receipt keeps its keys. A qty-0 lot counts in lots_matched/lots_finalised
-- and adds 0 to bottles_matched/bottles_finalised, which count sealed bottles;
-- its revaluation row has qty_at_revaluation = 0. A lot with neither sealed
-- bottles nor open ml (none should survive, they are deleted) is still skipped.
--
-- NOT APPLIED BY HAND. The Supabase GitHub integration applies migrations on
-- merge, keyed by this filename.

BEGIN;

CREATE OR REPLACE FUNCTION public.finalise_delivery_cost(
    p_delivery_id uuid,
    p_inventory_id uuid,
    p_unit_cost numeric,
    p_cost_provenance text,
    p_performed_by uuid DEFAULT NULL::uuid,
    p_reason text DEFAULT NULL::text,
    p_stock_state text DEFAULT 'live'::text
) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_restaurant uuid;
  v_lot record;
  v_lots_matched int := 0;
  v_bottles_matched int := 0;
  v_lots_finalised int := 0;
  v_bottles_finalised int := 0;
BEGIN
  IF p_delivery_id IS NULL THEN
    RAISE EXCEPTION 'finalise_delivery_cost: p_delivery_id is required. A cost that names no delivery cannot say which bottles it settles.'
      USING ERRCODE = '22023';
  END IF;

  IF p_cost_provenance IS NULL
     OR p_cost_provenance NOT IN ('invoice','estimated','manual','sample') THEN
    RAISE EXCEPTION 'finalise_delivery_cost: p_cost_provenance must be one of invoice, estimated, manual, sample (got %)', p_cost_provenance
      USING ERRCODE = '22023';
  END IF;

  -- An agreed price is the whole point of VERIFIED. Finalising to NULL would
  -- stamp `final` on a cost nobody established — the exact shape of finding 2,
  -- reintroduced by its own fix.
  IF p_unit_cost IS NULL THEN
    RAISE EXCEPTION 'finalise_delivery_cost: p_unit_cost is required. A lot with no agreed price stays provisional; it does not become a final cost of nothing.'
      USING ERRCODE = '22023';
  END IF;

  IF p_stock_state NOT IN ('live','shadow') THEN
    RAISE EXCEPTION 'invalid stock_state %', p_stock_state;
  END IF;

  SELECT restaurant_id INTO v_restaurant
    FROM restaurant_inventory WHERE id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL THEN
    RAISE EXCEPTION 'inventory % not found', p_inventory_id;
  END IF;

  FOR v_lot IN
    SELECT id, qty, unit_cost, cost_provenance, cost_state, source_order_id
      FROM inventory_lots
     WHERE inventory_id = p_inventory_id
       AND delivery_id  = p_delivery_id
       AND stock_state  = p_stock_state
       -- F-443: a lot whose sealed bottles are gone but whose open bottle
       -- still stands (qty 0, open_bottle_ml > 0) is stock of this delivery
       -- too, and its ml are still costed at this lot's price.
       AND (qty > 0 OR open_bottle_ml > 0)
     ORDER BY received_at ASC, created_at ASC
     FOR UPDATE
  LOOP
    v_lots_matched    := v_lots_matched + 1;
    v_bottles_matched := v_bottles_matched + v_lot.qty;

    -- Idempotent: a re-verify of the same delivery at the same agreed price is
    -- not a correction, and a no-op row in the history would say it was.
    CONTINUE WHEN v_lot.unit_cost IS NOT DISTINCT FROM p_unit_cost
              AND v_lot.cost_provenance IS NOT DISTINCT FROM p_cost_provenance
              AND v_lot.cost_state = 'final';

    INSERT INTO inventory_lot_revaluations
      (restaurant_id, inventory_id, lot_id, source_order_id, qty_at_revaluation,
       prior_unit_cost, prior_cost_provenance, new_unit_cost, new_cost_provenance,
       performed_by, reason)
    VALUES
      (v_restaurant, p_inventory_id, v_lot.id, v_lot.source_order_id, v_lot.qty,
       v_lot.unit_cost, v_lot.cost_provenance, p_unit_cost, p_cost_provenance,
       p_performed_by, COALESCE(p_reason, 'delivery ' || p_delivery_id::text || ' verified (ADR 0103 A1)'));

    UPDATE inventory_lots
       SET unit_cost       = p_unit_cost,
           cost_provenance = p_cost_provenance,
           cost_state      = 'final',
           updated_at      = now()
     WHERE id = v_lot.id;

    v_lots_finalised    := v_lots_finalised + 1;
    v_bottles_finalised := v_bottles_finalised + v_lot.qty;
  END LOOP;

  -- `lots_matched = 0` is a real answer, returned rather than swallowed: the
  -- delivery booked nothing for this item, or the bottles have all been poured.
  -- A lot held only as an open bottle counts in lots_matched/lots_finalised and
  -- adds 0 to the bottle counts, which count sealed bottles.
  RETURN jsonb_build_object(
    'delivery_id',        p_delivery_id,
    'inventory_id',       p_inventory_id,
    'stock_state',        p_stock_state,
    'lots_matched',       v_lots_matched,
    'bottles_matched',    v_bottles_matched,
    'lots_finalised',     v_lots_finalised,
    'bottles_finalised',  v_bottles_finalised,
    'unit_cost',          p_unit_cost,
    'cost_provenance',    p_cost_provenance
  );
END;
$$;

COMMENT ON FUNCTION public.finalise_delivery_cost IS
  'ADR 0103 A1, the VERIFIED half: restate the cost of the lots ONE delivery '
  'booked at the door and flip them from provisional to final. Keyed on '
  'inventory_lots.delivery_id, not source_order_id — an UNORDERED delivery has '
  'no order and a split shipment has one order for two deliveries (A2). Writes '
  'the prior price to inventory_lot_revaluations before overwriting it, writes '
  'NO inventory_transactions row (money moved, quantity did not), refuses a '
  'NULL price rather than stamping final on nothing, and is idempotent. '
  'Returns a receipt whose lots_matched lets the caller see that a '
  'finalisation reached nothing rather than assume it reached everything.';

GRANT EXECUTE ON FUNCTION public.finalise_delivery_cost(uuid, uuid, numeric, text, uuid, text, text)
  TO anon, authenticated, service_role;

COMMIT;
