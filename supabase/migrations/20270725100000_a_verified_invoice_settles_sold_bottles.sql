-- a_verified_invoice_settles_sold_bottles (cost-math walk, 2026-11-11):
-- the order-receiving verify priced the bottles still on the shelf and left
-- the bottles already sold at no cost, or at the estimate, for good.
--
-- WHAT WAS WRONG, measured on a local stack built from these migrations:
--   6 bottles booked unpriced against an order, 2 sold through the till, then
--   verifyReceipt -> revalue_lot(..., 25.00, 'invoice'). The 4 lots-on-hand
--   bottles read 25.00; the 2 sold draws kept unit_cost NULL and got no
--   inventory_lot_draw_settlements row (count 0), so pos_cost_of_goods kept
--   uncosted_out = 2 and the till's cost of goods stayed withheld for every
--   window holding those sales. The same with a sale before the verify and
--   one after: the earlier bottle never got a cost at all.
--
-- Cause: 20260902150000 revalue_lot predates the settlements
-- (20270502100100). finalise_delivery_cost, its twin keyed on a delivery,
-- learned to settle the draws; revalue_lot, keyed on an order and called by
-- ProcurementService.verifyReceipt (procurement.service.ts, "THE CORRECTION
-- ITSELF"), did not. Two smaller faults ride along:
--   (a) it left cost_state alone, so a lot restated at an invoice price kept
--       'provisional' against the column's own rule (20260906233000: final iff
--       a price and an invoice/manual provenance stand behind it), and every
--       later sale from it was stamped provisional;
--   (b) it looped only lots with qty > 0, so a delivery sold out before its
--       invoice was verified matched nothing and no sold bottle was costed.
--
-- The session's call under the 2026-11-07 /goal (no founder question asked):
-- revalue_lot settles exactly as finalise_delivery_cost does, so the two
-- verify paths cost a sold bottle the same way. This is #1025 decision 4
-- ("a verify that changes a sold bottle's cost is an adjusting entry dated
-- when it was made") reaching the path that receives most orders.
--   1. Per restated lot, the revaluation row is written first and its id kept;
--      every draw from that lot that is provisional or unpriced settles to the
--      new cost at six places (prior = its latest settlement, else its own
--      stamp; no row when the cost does not change).
--   2. The lot's cost_state follows the column rule: final for an invoice or
--      manual price, provisional otherwise.
--   3. A sold-out lot still provisional is restated too, so its sold bottles
--      settle; lots_matched / bottles_matched still count only lots with
--      bottles on hand, and empty_lots_revalued says how many were empty.
--   4. Idempotent as before, and now also when the state is already right: a
--      lot restated by the old body (price set, still provisional) heals on
--      the next verify of the same price.
-- Rejected:
--   - verifyReceipt calling finalise_delivery_cost: it keys on delivery_id,
--     and an order-received lot has none (20260906233000: lots booked before
--     deliveries had a stock writer carry only source_order_id).
--   - a second write from the service after revalue_lot: two writes, one of
--     which can fail after the other committed; the lot price and the sold
--     bottles' cost would disagree.
--   - backfilling the sales the old body left unsettled: the row count on the
--     live tenant is not measured (this session never queries production),
--     and an unmeasured write to a money ledger from a migration is not
--     reviewable. The harm ages out with the sales window, and a re-verify
--     heals any lot (point 4). The count query is in the PR body.
--   - re-settling draws stamped final (an invoice price at the door): same as
--     finalise_delivery_cost, final means settled.
--
-- Signature, grants and the jsonb receipt's existing keys are unchanged;
-- the receipt gains cost_state, empty_lots_revalued and draws_settled.

BEGIN;

CREATE OR REPLACE FUNCTION public.revalue_lot(
    p_inventory_id uuid,
    p_source_order_id uuid,
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
  v_lots_revalued int := 0;
  v_bottles_revalued int := 0;
  -- a_verified_invoice_settles_sold_bottles
  v_state text;
  v_reval uuid;
  v_draw record;
  v_prior numeric;
  v_settled numeric(14,6);
  v_empty_lots_revalued int := 0;
  v_draws_settled int := 0;
BEGIN
  IF p_cost_provenance IS NULL
     OR p_cost_provenance NOT IN ('invoice','estimated','manual','sample') THEN
    RAISE EXCEPTION 'revalue_lot: p_cost_provenance must be one of invoice, estimated, manual, sample (got %)', p_cost_provenance
      USING ERRCODE = '22023';
  END IF;

  IF p_unit_cost IS NULL THEN
    RAISE EXCEPTION 'revalue_lot: p_unit_cost is required — a revaluation to "unknown" would destroy a recorded price'
      USING ERRCODE = '22023';
  END IF;

  IF p_source_order_id IS NULL THEN
    RAISE EXCEPTION 'revalue_lot: p_source_order_id is required. A correction must name the delivery it corrects; guessing which lot to restate is the defect this function exists to remove.'
      USING ERRCODE = '22023';
  END IF;

  IF p_stock_state NOT IN ('live','shadow') THEN
    RAISE EXCEPTION 'invalid stock_state %', p_stock_state;
  END IF;

  -- The cost_state rule of 20260906233000, the same one apply_stock_movement
  -- stamps at booking.
  v_state := CASE WHEN p_cost_provenance IN ('invoice','manual') THEN 'final' ELSE 'provisional' END;
  -- The cost at settled_unit_cost's scale (a_settlement_keeps_six_places).
  v_settled := round(p_unit_cost, 6);

  -- Same row lock apply_stock_movement takes, so a concurrent movement and a
  -- revaluation of the same wine serialise instead of interleaving.
  SELECT restaurant_id INTO v_restaurant
    FROM restaurant_inventory WHERE id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL THEN
    RAISE EXCEPTION 'inventory % not found', p_inventory_id;
  END IF;

  FOR v_lot IN
    SELECT id, qty, unit_cost, cost_provenance, cost_state
      FROM inventory_lots
     WHERE inventory_id    = p_inventory_id
       AND source_order_id = p_source_order_id
       AND stock_state     = p_stock_state
       AND (qty > 0 OR cost_state = 'provisional')
     ORDER BY received_at ASC, created_at ASC
     FOR UPDATE
  LOOP
    IF v_lot.qty > 0 THEN
      v_lots_matched    := v_lots_matched + 1;
      v_bottles_matched := v_bottles_matched + v_lot.qty;
    END IF;

    -- Idempotent: verifyReceipt can be retried from an offline outbox, and a
    -- lot already carrying this exact price, provenance and state is not a
    -- correction. Skipping it also keeps the history free of no-op rows.
    CONTINUE WHEN v_lot.unit_cost IS NOT DISTINCT FROM p_unit_cost
              AND v_lot.cost_provenance IS NOT DISTINCT FROM p_cost_provenance
              AND v_lot.cost_state IS NOT DISTINCT FROM v_state;

    INSERT INTO inventory_lot_revaluations
      (restaurant_id, inventory_id, lot_id, source_order_id, qty_at_revaluation,
       prior_unit_cost, prior_cost_provenance, new_unit_cost, new_cost_provenance,
       performed_by, reason)
    VALUES
      (v_restaurant, p_inventory_id, v_lot.id, p_source_order_id, v_lot.qty,
       v_lot.unit_cost, v_lot.cost_provenance, p_unit_cost, p_cost_provenance,
       p_performed_by, p_reason)
    RETURNING id INTO v_reval;

    UPDATE inventory_lots
       SET unit_cost       = p_unit_cost,
           cost_provenance = p_cost_provenance,
           cost_state      = v_state,
           updated_at      = now()
     WHERE id = v_lot.id;

    v_lots_revalued    := v_lots_revalued + 1;
    v_bottles_revalued := v_bottles_revalued + v_lot.qty;
    IF v_lot.qty = 0 THEN
      v_empty_lots_revalued := v_empty_lots_revalued + 1;
    END IF;

    -- Every bottle that left this lot on a price not yet settled owes the
    -- difference to the verified price, exactly (finalise_delivery_cost's
    -- loop, a_settlement_keeps_six_places).
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
        (v_restaurant, v_draw.id, v_lot.id, v_draw.txn_id, v_draw.inventory_id, v_reval, v_draw.qty,
         v_prior, v_settled, v_draw.qty * v_prior, v_draw.qty * v_settled,
         v_draw.qty * v_settled - COALESCE(v_draw.qty * v_prior, 0));
      v_draws_settled := v_draws_settled + 1;
    END LOOP;
  END LOOP;

  -- The receipt. `lots_matched = 0` is a real and reportable answer: the
  -- delivery's bottles have all been poured. draws_settled says whether the
  -- poured bottles' cost was settled even so.
  RETURN jsonb_build_object(
    'inventory_id',        p_inventory_id,
    'source_order_id',     p_source_order_id,
    'stock_state',         p_stock_state,
    'lots_matched',        v_lots_matched,
    'bottles_matched',     v_bottles_matched,
    'lots_revalued',       v_lots_revalued,
    'bottles_revalued',    v_bottles_revalued,
    'unit_cost',           p_unit_cost,
    'cost_provenance',     p_cost_provenance,
    'cost_state',          v_state,
    'empty_lots_revalued', v_empty_lots_revalued,
    'draws_settled',       v_draws_settled
  );
END;
$$;

COMMENT ON FUNCTION public.revalue_lot(uuid, uuid, numeric, text, uuid, text, text) IS
  'Restate the cost of the lots an order created, without creating a rival lot or moving a bottle (ADR 0078). '
  'Targets lots by source_order_id. Writes the prior cost to inventory_lot_revaluations before overwriting it, '
  'writes NO inventory_transactions row, and is idempotent. Since a_verified_invoice_settles_sold_bottles it sets '
  'cost_state by the column rule (final for invoice/manual), restates a sold-out provisional lot, and writes one '
  'inventory_lot_draw_settlements row per provisional or unpriced draw whose cost the new price changes '
  '(draws_settled), exactly as finalise_delivery_cost does for a delivery.';

COMMIT;
