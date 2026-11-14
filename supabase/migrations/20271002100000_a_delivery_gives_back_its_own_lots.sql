-- a_delivery_gives_back_its_own_lots (r28 invoices audit, G2).
--
-- A rejected delivery is reversed, and a door count corrected downward gives
-- the difference back, as one negative apply_stock_movement naming the
-- delivery (p_reference_type = 'delivery'). The negative branch drew every
-- lot of the item oldest first with no delivery filter, so:
--
--   12 bottles of an item are on the shelf, costed at 10.00 (a verified
--   delivery). Delivery D books 6 more: a provisional, unpriced lot. D is
--   rejected (WRONG_VENUE). The reversal of -6 took 6 of the costed bottles
--   and left D's own lot live at 6, uncosted, and never costable, because D
--   is REJECTED and will never be verified. Inventory value turns unknown,
--   and when the till reaches that lot, cost of goods is withheld for good.
--
-- Invariant: a movement that names a delivery and takes stock away takes it
-- from that delivery's own lots first. Anything beyond what the delivery
-- still holds (its bottles were already sold) comes first-in-first-out from
-- the rest, as before. A movement that names no delivery (a sale, a count, a
-- waste) draws exactly as before: oldest first.
--
-- The body is a_void_gives_back_its_cost's apply_stock_movement verbatim
-- except the one marked ORDER BY, so this migration must stay ordered after
-- that one. The signature is unchanged, so this is CREATE OR REPLACE and the
-- grants stand. No other definition of the function follows that one on main
-- or in any open PR (checked 2026-11-13); a later redefinition must carry this
-- ORDER BY forward (claim R28-G2-OWN-LOTS-FIRST checks the last definition).

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_stock_movement(
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
    p_cost_provenance text DEFAULT NULL::text,
    p_reference_type text DEFAULT NULL::text,
    p_reference_id uuid DEFAULT NULL::uuid,
    p_pos_transaction_id text DEFAULT NULL::text,
    p_notes text DEFAULT NULL::text,
    p_metadata jsonb DEFAULT NULL::jsonb,
    p_restaurant_id uuid DEFAULT NULL::uuid,
    p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone
) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_restaurant uuid; v_wine uuid;
  v_before int; v_after int; v_remaining int; v_txn uuid; v_lot record;
  v_provenance text;
  v_delivery uuid;
  v_cost_state text;
  v_owned boolean;
  v_take int;
  v_cost_total numeric;  -- a_sale_keeps_six_places: no rounding while it sums
  v_unpriced int;
  v_draw_lot uuid[] := '{}';
  v_draw_qty int[] := '{}';
  v_draw_cost numeric[] := '{}';
  v_draw_state text[] := '{}';
  v_draw_prov text[] := '{}';
  v_sale uuid;
  v_back record;
  v_unmatched int;
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  IF p_delta = 0 THEN RETURN NULL; END IF;
  IF p_stock_state NOT IN ('live','shadow') THEN RAISE EXCEPTION 'invalid stock_state %', p_stock_state; END IF;

  -- ADR 0141: the house is checked before the idempotency lookup, again under the lock below (20260912163000).
  IF p_restaurant_id IS NOT NULL THEN
    SELECT true INTO v_owned FROM restaurant_inventory
      WHERE id = p_inventory_id AND restaurant_id = p_restaurant_id;
    IF v_owned IS NOT TRUE THEN
      RAISE EXCEPTION
        'apply_stock_movement: item % is not an item of restaurant %, so no stock was moved and no ledger row was written. A stock movement names the house it is for, and this one does not match the item.',
        p_inventory_id, p_restaurant_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_cost_provenance IS NOT NULL
     AND p_cost_provenance NOT IN ('invoice','estimated','manual','sample') THEN
    RAISE EXCEPTION 'invalid cost_provenance %', p_cost_provenance;
  END IF;

  IF p_delta > 0 AND p_unit_cost IS NOT NULL AND p_cost_provenance IS NULL THEN
    RAISE EXCEPTION
      'apply_stock_movement: p_unit_cost was given without p_cost_provenance. '
      'A price that becomes a lot must say what kind of price it is: '
      '''invoice'' (a document was read), ''manual'' (a person typed it), '
      '''estimated'' (nobody has verified it) or ''sample'' (it was free). '
      'This used to default to ''invoice'', which stamped unverified prices as '
      'invoice-verified. See ADR 0078.'
      USING ERRCODE = '22023';
  END IF;

  -- No inference: a lot with no price is 'estimated' (ADR 0078).
  v_provenance := COALESCE(p_cost_provenance, 'estimated');

  -- ADR 0103 A1: a delivery's lots are provisional until it is verified.
  v_delivery := CASE WHEN p_reference_type = 'delivery' THEN p_reference_id ELSE NULL END;
  v_cost_state := CASE
    WHEN v_delivery IS NOT NULL THEN 'provisional'
    WHEN p_unit_cost IS NOT NULL AND v_provenance IN ('invoice','manual') THEN 'final'
    ELSE 'provisional'
  END;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_txn FROM inventory_transactions WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_txn IS NOT NULL THEN RETURN v_txn; END IF;
  END IF;

  SELECT restaurant_id, master_wine_id INTO v_restaurant, v_wine
    FROM restaurant_inventory WHERE id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL THEN RAISE EXCEPTION 'inventory % not found', p_inventory_id; END IF;

  -- ADR 0141: the authoritative comparison, under the row lock.
  IF p_restaurant_id IS NOT NULL AND v_restaurant <> p_restaurant_id THEN
    RAISE EXCEPTION
      'apply_stock_movement: item % is not an item of restaurant %, so no stock was moved and no ledger row was written. A stock movement names the house it is for, and this one does not match the item.',
      p_inventory_id, p_restaurant_id
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(qty),0) INTO v_before FROM inventory_lots
    WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state;
  v_after := v_before + p_delta;
  IF v_after < 0 THEN RAISE EXCEPTION 'stock would go negative: % + %', v_before, p_delta; END IF;

  IF p_delta > 0 THEN
    v_remaining := p_delta;
    -- A return naming its sale (metadata sale_key) gives bottles back to the
    -- sale's lots, last-drawn first, capped by what earlier voids of that key
    -- gave back, at the sale draw's cost; under the item lock.
    IF p_transaction_type = 'return' AND (p_metadata ->> 'sale_key') IS NOT NULL THEN
      SELECT t.id INTO v_sale FROM inventory_transactions t
       WHERE t.idempotency_key = p_metadata ->> 'sale_key'
         AND t.restaurant_id = v_restaurant
         AND t.inventory_id = p_inventory_id
         AND t.transaction_type = 'sale'
         AND t.quantity_change < 0
         AND t.stock_type = p_stock_state
         AND EXISTS (SELECT 1 FROM inventory_lot_draws d WHERE d.txn_id = t.id AND d.qty > 0);
    END IF;
    IF v_sale IS NOT NULL THEN
      v_unpriced := 0;
      FOR v_back IN
        SELECT d.lot_id,
               d.qty - COALESCE((SELECT sum(-r.qty)
                                   FROM inventory_lot_draws r
                                   JOIN inventory_transactions rt ON rt.id = r.txn_id
                                  WHERE r.lot_id = d.lot_id AND r.qty < 0
                                    AND rt.transaction_type = 'return'
                                    AND rt.metadata ->> 'sale_key' = p_metadata ->> 'sale_key'), 0) AS open_qty,
               COALESCE((SELECT s.settled_unit_cost FROM inventory_lot_draw_settlements s
                          WHERE s.draw_id = d.id ORDER BY s.created_at DESC, s.seq DESC LIMIT 1),
                        d.unit_cost) AS unit_cost,
               d.cost_state, d.cost_provenance
          FROM inventory_lot_draws d
          JOIN inventory_lots l ON l.id = d.lot_id
         WHERE d.txn_id = v_sale AND d.qty > 0
         ORDER BY l.received_at DESC, l.created_at DESC, l.id DESC
      LOOP
        EXIT WHEN v_remaining <= 0;
        CONTINUE WHEN v_back.open_qty <= 0;
        v_take := LEAST(v_back.open_qty, v_remaining)::int;
        UPDATE inventory_lots SET qty = qty + v_take, updated_at = now() WHERE id = v_back.lot_id;
        v_draw_lot := v_draw_lot || v_back.lot_id;
        v_draw_qty := v_draw_qty || (-v_take);
        v_draw_cost := v_draw_cost || v_back.unit_cost;
        v_draw_state := v_draw_state || v_back.cost_state;
        v_draw_prov := v_draw_prov || v_back.cost_provenance;
        IF v_back.unit_cost IS NULL THEN
          v_unpriced := v_unpriced + v_take;
        ELSE
          v_cost_total := COALESCE(v_cost_total, 0) - v_take * v_back.unit_cost;
        END IF;
        v_remaining := v_remaining - v_take;
      END LOOP;
      v_unmatched := v_remaining;
      v_metadata := v_metadata || jsonb_build_object('bottles_not_matched_to_a_draw', v_unmatched);
    END IF;
    IF v_remaining > 0 THEN
      INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, unit_cost, cost_provenance, source_order_id, delivery_id, cost_state)
      VALUES (v_restaurant, p_inventory_id, v_wine, p_location_id, p_stock_state, v_remaining, p_unit_cost,
              v_provenance, p_order_id, v_delivery, v_cost_state);
    END IF;
  ELSE
    v_remaining := -p_delta;
    v_unpriced := 0;
    -- a_delivery_gives_back_its_own_lots (r28 G2): a movement that names a
    -- delivery (its reversal, or a lower recount) draws THAT delivery's lots
    -- first, then the rest first-in-first-out. A movement naming no delivery
    -- is unchanged: v_delivery is NULL and every lot sorts the same.
    FOR v_lot IN SELECT id, qty, unit_cost, cost_state, cost_provenance FROM inventory_lots
        WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state AND qty > 0
        ORDER BY (delivery_id IS NOT DISTINCT FROM v_delivery AND v_delivery IS NOT NULL) DESC,
                 received_at ASC, created_at ASC LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_lot.qty, v_remaining);
      v_draw_lot := v_draw_lot || v_lot.id;
      v_draw_qty := v_draw_qty || v_take;
      v_draw_cost := v_draw_cost || v_lot.unit_cost;
      v_draw_state := v_draw_state || v_lot.cost_state::text;
      v_draw_prov := v_draw_prov || v_lot.cost_provenance::text;
      IF v_lot.unit_cost IS NULL THEN
        v_unpriced := v_unpriced + v_take;
      ELSE
        v_cost_total := COALESCE(v_cost_total, 0) + v_take * v_lot.unit_cost;
      END IF;
      IF v_lot.qty <= v_remaining THEN
        v_remaining := v_remaining - v_lot.qty;
        -- R6: kept at 0, never deleted.
        UPDATE inventory_lots SET qty = 0, updated_at = now() WHERE id = v_lot.id;
      ELSE
        UPDATE inventory_lots SET qty = qty - v_remaining, updated_at = now() WHERE id = v_lot.id;
        v_remaining := 0;
      END IF;
    END LOOP;
    v_unpriced := v_unpriced + GREATEST(v_remaining, 0);
  END IF;

  INSERT INTO inventory_transactions
    (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change, quantity_before, quantity_after,
     stock_type, unit_cost, performed_by, performed_by_type, reason, order_id, idempotency_key, transaction_date,
     reference_type, reference_id, pos_transaction_id, notes, metadata, delivery_id,
     cost_total, unpriced_qty)
  VALUES
    (v_restaurant, p_inventory_id, v_wine, p_transaction_type::inventory_transaction_type, p_source::inventory_transaction_source,
     p_delta, v_before, v_after, p_stock_state, p_unit_cost, p_performed_by,
     CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
     p_reason, p_order_id, p_idempotency_key,
     -- ADR 0281: dated when it happened, never later than now.
     LEAST(COALESCE(p_occurred_at, now()), now()),
     p_reference_type, p_reference_id, p_pos_transaction_id, p_notes, v_metadata, v_delivery,
     v_cost_total, v_unpriced)
  RETURNING id INTO v_txn;

  -- One draw per lot touched (negative for a matched return).
  IF cardinality(v_draw_lot) > 0 THEN
    INSERT INTO inventory_lot_draws
      (restaurant_id, txn_id, lot_id, inventory_id, qty, unit_cost, cost_state, cost_provenance)
    SELECT v_restaurant, v_txn, d.lot_id, p_inventory_id, d.qty, d.unit_cost, d.cost_state, d.cost_provenance
      FROM unnest(v_draw_lot, v_draw_qty, v_draw_cost, v_draw_state, v_draw_prov)
           AS d(lot_id, qty, unit_cost, cost_state, cost_provenance);
  END IF;

  RETURN v_txn;
END;
$$;

COMMENT ON FUNCTION public.apply_stock_movement IS
  'Single stock write primitive (SimPOS testbed plan, decision A1). Locks the '
  'inventory row, creates a lot or draws lots, writes the ledger row, and is '
  'idempotent on p_idempotency_key. A caller naming p_reference_type = ''delivery'' '
  'stamps the delivery on the lot and the row (ADR 0103 A1, provisional until '
  'finalise_delivery_cost), and a NEGATIVE movement naming a delivery draws that '
  'delivery''s own lots first, then first-in-first-out (a_delivery_gives_back_its_own_lots). '
  'Every other negative movement draws first-in-first-out, oldest received first. '
  'p_restaurant_id names the house and a mismatch RAISES 42501 (ADR 0141). '
  'p_occurred_at dates the movement (ADR 0281). A return naming its sale gives '
  'bottles back to the sale''s lots (a_void_gives_back_its_cost). Lots are kept '
  'at 0, never deleted (R6). Use revalue_lot or finalise_delivery_cost to '
  'correct a cost: this function only ever creates or consumes quantity.';

COMMIT;
