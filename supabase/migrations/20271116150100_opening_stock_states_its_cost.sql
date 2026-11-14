-- Opening stock states its cost (r36 invoices audit R1, 2026-11-13).
--
-- WHY. Stock that arrives without an invoice gets a lot with no cost: the
-- shelf a house already has on day 1, a menu-scan import, an item added with
-- no price, a count that finds more than the system thought. Only a
-- delivery's lots are ever settled (finalise_delivery_cost, at VERIFIED) and
-- only an order's lots are ever restated (revalue_lot, at /orders verify).
-- Nothing let a person say what the other lots cost. Sales draw the oldest
-- lot first, so a new house's first sales take exactly those lots, and its
-- cost of goods is withheld until every pre-Mudavym bottle is gone.
--
-- WHAT. state_opening_lot_cost(house, item, cost) settles the item's lots
-- that came from NO delivery and NO order and carry no settled cost
-- (cost_state = 'provisional' or unit_cost IS NULL). Each such lot is
-- restated at the stated cost per one of the item's unit, provenance
-- 'manual', cost_state 'final', with its prior cost kept in
-- inventory_lot_revaluations. Every draw that already left the lot unpriced
-- or provisional is settled exactly as finalise_delivery_cost settles one
-- (a_sale_settles_its_cost, a_settlement_keeps_six_places): one
-- inventory_lot_draw_settlements row, qty x the six-place cost, nothing
-- rounded. So the bottles sold before the cost was known are costed too.
--
-- WHAT IT NEVER TOUCHES.
--   * A delivery's lot or an order's lot: their paper settles them, and a
--     stated guess must not overwrite an invoice.
--   * A lot that already carries a final cost, typed or settled: this states
--     a missing cost; it does not correct one. A retry therefore restates
--     nothing (lots_stated = 0), and that is reported, not hidden.
--   * Another house's item: the item is read under the caller's house, and
--     an item of another house reads as not found.
--   * A cost of nothing: refused. A free bottle is a sample, not this.
--
-- DEPENDS ON fix/a-part-move-keeps-its-delivery (20271116150000). Until it
-- lands, transfer_stock splits a delivery's lot into one with no
-- delivery_id, which this function would read as stock from no delivery.
--
-- Same row lock as apply_stock_movement and finalise_delivery_cost (the
-- item row, then the lots), so a sale and a stated cost serialise.

CREATE OR REPLACE FUNCTION public.state_opening_lot_cost(
    p_restaurant_id uuid,
    p_inventory_id uuid,
    p_unit_cost numeric,
    p_performed_by uuid DEFAULT NULL::uuid,
    p_reason text DEFAULT NULL::text,
    p_stock_state text DEFAULT 'live'::text
) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_restaurant uuid;
  v_lot record;
  v_draw record;
  v_prior numeric;
  v_reval uuid;
  v_settled numeric(14,6);
  v_lots_stated int := 0;
  v_units_stated int := 0;
  v_empty_lots_stated int := 0;
  v_draws_settled int := 0;
BEGIN
  IF p_restaurant_id IS NULL OR p_inventory_id IS NULL THEN
    RAISE EXCEPTION 'state_opening_lot_cost: the house and the item are both required'
      USING ERRCODE = '22023';
  END IF;

  IF p_unit_cost IS NULL OR NOT (p_unit_cost > 0) THEN
    RAISE EXCEPTION 'state_opening_lot_cost: a stated cost must be more than nothing (got %). A free bottle is a sample, not an opening cost.', p_unit_cost
      USING ERRCODE = '22023';
  END IF;

  IF p_stock_state NOT IN ('live','shadow') THEN
    RAISE EXCEPTION 'invalid stock_state %', p_stock_state;
  END IF;

  v_settled := round(p_unit_cost, 6);
  IF NOT (v_settled > 0) THEN
    RAISE EXCEPTION 'state_opening_lot_cost: % rounds to nothing at six places', p_unit_cost
      USING ERRCODE = '22023';
  END IF;

  SELECT restaurant_id INTO v_restaurant
    FROM restaurant_inventory
   WHERE id = p_inventory_id AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF v_restaurant IS NULL THEN
    RAISE EXCEPTION 'inventory % not found', p_inventory_id;
  END IF;

  FOR v_lot IN
    SELECT id, restaurant_id, qty, unit_cost, cost_provenance
      FROM inventory_lots
     WHERE inventory_id    = p_inventory_id
       AND restaurant_id   = p_restaurant_id
       AND stock_state     = p_stock_state
       AND delivery_id     IS NULL
       AND source_order_id IS NULL
       AND (cost_state = 'provisional' OR unit_cost IS NULL)
     ORDER BY received_at ASC, created_at ASC
     FOR UPDATE
  LOOP
    INSERT INTO inventory_lot_revaluations
      (restaurant_id, inventory_id, lot_id, source_order_id, qty_at_revaluation,
       prior_unit_cost, prior_cost_provenance, new_unit_cost, new_cost_provenance,
       performed_by, reason)
    VALUES
      (v_lot.restaurant_id, p_inventory_id, v_lot.id, NULL, v_lot.qty,
       v_lot.unit_cost, v_lot.cost_provenance, v_settled, 'manual',
       p_performed_by, COALESCE(p_reason, 'opening stock cost stated (r36 R1)'))
    RETURNING id INTO v_reval;

    UPDATE inventory_lots
       SET unit_cost       = v_settled,
           cost_provenance = 'manual',
           cost_state      = 'final',
           updated_at      = now()
     WHERE id = v_lot.id;

    v_lots_stated  := v_lots_stated + 1;
    v_units_stated := v_units_stated + v_lot.qty;
    IF v_lot.qty = 0 THEN
      v_empty_lots_stated := v_empty_lots_stated + 1;
    END IF;

    -- What already left this lot on no price, or on an estimate, owes the
    -- difference to the stated cost, exactly as at VERIFIED.
    FOR v_draw IN
      SELECT d.id, d.txn_id, d.inventory_id, d.qty, d.unit_cost
        FROM inventory_lot_draws d
       WHERE d.lot_id = v_lot.id
         AND (d.cost_state = 'provisional' OR d.unit_cost IS NULL)
       ORDER BY d.created_at, d.id
    LOOP
      SELECT s.settled_unit_cost INTO v_prior
        FROM inventory_lot_draw_settlements s
       WHERE s.draw_id = v_draw.id
       ORDER BY s.created_at DESC, s.seq DESC
       LIMIT 1;
      IF NOT FOUND THEN
        v_prior := v_draw.unit_cost;
      END IF;
      CONTINUE WHEN v_prior IS NOT DISTINCT FROM v_settled;

      INSERT INTO inventory_lot_draw_settlements
        (restaurant_id, draw_id, lot_id, txn_id, inventory_id, revaluation_id, qty,
         prior_unit_cost, settled_unit_cost, prior_total, settled_total, difference)
      VALUES
        (v_lot.restaurant_id, v_draw.id, v_lot.id, v_draw.txn_id, v_draw.inventory_id, v_reval, v_draw.qty,
         v_prior, v_settled, v_draw.qty * v_prior, v_draw.qty * v_settled,
         v_draw.qty * v_settled - COALESCE(v_draw.qty * v_prior, 0));
      v_draws_settled := v_draws_settled + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'inventory_id',      p_inventory_id,
    'stock_state',       p_stock_state,
    'unit_cost',         v_settled,
    'lots_stated',       v_lots_stated,
    'units_stated',      v_units_stated,
    'empty_lots_stated', v_empty_lots_stated,
    'draws_settled',     v_draws_settled
  );
END;
$$;

COMMENT ON FUNCTION public.state_opening_lot_cost(uuid, uuid, numeric, uuid, text, text) IS
  'r36 R1: state what an item''s stock from no delivery and no order cost '
  '(opening shelf, menu-scan import, item added without a price, a count that '
  'found more). Restates only those lots with no settled cost, at the stated '
  'cost per one of the item''s unit, provenance manual, cost_state final; '
  'keeps the prior cost in inventory_lot_revaluations; settles every unpriced '
  'or provisional draw from them exactly as finalise_delivery_cost does. Never '
  'touches a delivery''s or an order''s lot, nor a lot with a final cost. '
  'Scoped to p_restaurant_id. Idempotent: a retry states nothing.';

REVOKE ALL ON FUNCTION public.state_opening_lot_cost(uuid, uuid, numeric, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.state_opening_lot_cost(uuid, uuid, numeric, uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.state_opening_lot_cost(uuid, uuid, numeric, uuid, text, text) TO service_role;
