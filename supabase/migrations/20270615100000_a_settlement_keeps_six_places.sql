-- a_settlement_keeps_six_places (QA round 21, #932 residuals): a settlement
-- rounded each draw's totals to the cent while the cost it corrects keeps six
-- places, so the settled cost is neither the stamped cost nor the agreed one.
--
--   (1) An estimate of 9.230769 settled at 9.50: cost_total 9.230769 (six
--       places since 20270512100000), difference round(9.50, 2) -
--       round(9.230769, 2) = 0.27, settled 9.500769 a bottle; 13 sales settle
--       to 123.509997, not 13 x 9.50 = 123.50.
--   (2) An estimate of 10.00 settled at 10.0049, sold one bottle at a time:
--       difference round(10.0049, 2) - round(10.00, 2) = 0.00 per draw, so 200
--       singles settle to 2000.00 and lose 200 x 0.0049 = 0.98 (one 200-bottle
--       draw kept it). Already true before #932.
-- Cause: 20270502100100 finalise_delivery_cost, the settlement INSERT,
-- round(v_draw.qty * v_prior, 2) and round(v_draw.qty * p_unit_cost, 2) into
-- numeric(14,2) columns. No float is involved; the sums mix two scales.
--
-- The session's call under the 2026-11-07 /goal: a settlement is exact at the
-- ledger's scale. qty is an integer and both unit costs are numeric(14,6), so
-- qty x cost is exact at six places and needs no rounding; a money reader
-- rounds once, at its own total. Rejected: carrying a sub-cent residual from
-- draw to draw (order-dependent: which sale gets the cent depends on the order
-- the loop visits draws, and a re-verify chain must replay the carry); one
-- settlement row per revaluation with cents allotted by largest remainder
-- (changes what a row means, and a later void cannot find its draw's share).
--
-- 1. the settlement's totals widen to numeric(16,6), like cost_total;
-- 2. finalise_delivery_cost: 20270502100100's body, the settlement's totals
--    unrounded and priced at the cost the row stores (round(p_unit_cost, 6),
--    the scale of settled_unit_cost), so the row adds up to its own unit cost;
-- 3. inventory_transaction_settled_cost: 20270520100000's view with
--    settled_difference at numeric(16,6), and the whole settled_cost_total
--    CASE cast (its NULL branch left the column typmod-less numeric).

BEGIN;

-- 1. the totals keep six places (the view reads difference)

DROP VIEW IF EXISTS public.inventory_transaction_settled_cost;

ALTER TABLE public.inventory_lot_draw_settlements
  ALTER COLUMN prior_total TYPE numeric(16,6),
  ALTER COLUMN settled_total TYPE numeric(16,6),
  ALTER COLUMN difference TYPE numeric(16,6);

COMMENT ON COLUMN public.inventory_lot_draw_settlements.prior_total IS
  'qty x prior_unit_cost, exact at six places (a_settlement_keeps_six_places). NULL when the draw had no price.';
COMMENT ON COLUMN public.inventory_lot_draw_settlements.settled_total IS
  'qty x settled_unit_cost, exact at six places. Never rounded to the cent here: a reader of money rounds once, at its own total.';
COMMENT ON COLUMN public.inventory_lot_draw_settlements.difference IS
  'What the sale''s cost moves by: settled_total minus prior_total (an unpriced draw counts its whole settled_total). Six places, so one-bottle draws keep a sub-cent difference.';

-- 2. finalise_delivery_cost
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
  -- a_sale_settles_its_cost
  v_reval uuid;
  v_draw record;
  v_prior numeric;
  v_empty_lots_finalised int := 0;
  v_draws_settled int := 0;
  -- a_settlement_keeps_six_places: the agreed cost at settled_unit_cost's scale
  v_settled numeric(14,6);
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

  IF p_unit_cost IS NULL THEN
    RAISE EXCEPTION 'finalise_delivery_cost: p_unit_cost is required. A lot with no agreed price stays provisional; it does not become a final cost of nothing.'
      USING ERRCODE = '22023';
  END IF;

  IF p_stock_state NOT IN ('live','shadow') THEN
    RAISE EXCEPTION 'invalid stock_state %', p_stock_state;
  END IF;

  v_settled := round(p_unit_cost, 6);

  SELECT restaurant_id INTO v_restaurant
    FROM restaurant_inventory WHERE id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL THEN
    RAISE EXCEPTION 'inventory % not found', p_inventory_id;
  END IF;

  FOR v_lot IN
    SELECT id, restaurant_id, qty, unit_cost, cost_provenance, cost_state, source_order_id
      FROM inventory_lots
     WHERE inventory_id = p_inventory_id
       AND delivery_id  = p_delivery_id
       AND stock_state  = p_stock_state
       AND (qty > 0 OR cost_state = 'provisional')
     ORDER BY received_at ASC, created_at ASC
     FOR UPDATE
  LOOP
    IF v_lot.qty > 0 THEN
      v_lots_matched    := v_lots_matched + 1;
      v_bottles_matched := v_bottles_matched + v_lot.qty;
    END IF;

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
       p_performed_by, COALESCE(p_reason, 'delivery ' || p_delivery_id::text || ' verified (ADR 0103 A1)'))
    RETURNING id INTO v_reval;

    UPDATE inventory_lots
       SET unit_cost       = p_unit_cost,
           cost_provenance = p_cost_provenance,
           cost_state      = 'final',
           updated_at      = now()
     WHERE id = v_lot.id;

    v_lots_finalised    := v_lots_finalised + 1;
    v_bottles_finalised := v_bottles_finalised + v_lot.qty;
    IF v_lot.qty = 0 THEN
      v_empty_lots_finalised := v_empty_lots_finalised + 1;
    END IF;

    -- Every bottle that left this lot on a price not yet settled owes the
    -- difference to the agreed price, exactly: qty x a six-place cost is
    -- exact at six places, so nothing is rounded and nothing is lost.
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
    'delivery_id',        p_delivery_id,
    'inventory_id',       p_inventory_id,
    'stock_state',        p_stock_state,
    'lots_matched',       v_lots_matched,
    'bottles_matched',    v_bottles_matched,
    'lots_finalised',     v_lots_finalised,
    'bottles_finalised',  v_bottles_finalised,
    'unit_cost',          p_unit_cost,
    'cost_provenance',    p_cost_provenance,
    'empty_lots_finalised', v_empty_lots_finalised,
    'draws_settled',      v_draws_settled
  );
END;
$$;

COMMENT ON FUNCTION public.finalise_delivery_cost IS
  'ADR 0103 A1, the VERIFIED half: restate the cost of the lots ONE delivery '
  'booked at the door and flip them from provisional to final. Keyed on '
  'inventory_lots.delivery_id. Writes the prior price to '
  'inventory_lot_revaluations before overwriting it, writes NO '
  'inventory_transactions row, refuses a NULL price, and is idempotent. '
  'Finalises a lot sold out while provisional (empty_lots_finalised) and '
  'writes one inventory_lot_draw_settlements row per provisional or unpriced '
  'draw whose cost the new price changes (draws_settled); since '
  'a_settlement_keeps_six_places its totals are exact at six places.';

GRANT EXECUTE ON FUNCTION public.finalise_delivery_cost(uuid, uuid, numeric, text, uuid, text, text)
  TO anon, authenticated, service_role;

-- 3. 20270520100000's view, settled_difference at six places

CREATE VIEW public.inventory_transaction_settled_cost
WITH (security_invoker = true) AS
SELECT t.id AS txn_id,
       t.restaurant_id,
       t.inventory_id,
       t.cost_total,
       COALESCE(s.difference, 0)::numeric(16,6) AS settled_difference,
       (CASE WHEN t.cost_total IS NULL AND s.txn_id IS NULL THEN NULL
             ELSE COALESCE(t.cost_total, 0) + COALESCE(s.difference, 0)
        END)::numeric(16,6) AS settled_cost_total,
       t.unpriced_qty,
       (t.unpriced_qty - COALESCE(u.qty, 0))::integer AS unpriced_qty_remaining
  FROM public.inventory_transactions t
  LEFT JOIN (SELECT txn_id, sum(difference) AS difference
               FROM public.inventory_lot_draw_settlements GROUP BY txn_id) s ON s.txn_id = t.id
  LEFT JOIN (SELECT d.txn_id, sum(abs(d.qty)) AS qty
               FROM public.inventory_lot_draws d
              WHERE d.unit_cost IS NULL
                AND EXISTS (SELECT 1 FROM public.inventory_lot_draw_settlements x WHERE x.draw_id = d.id)
              GROUP BY d.txn_id) u ON u.txn_id = t.id;

COMMENT ON VIEW public.inventory_transaction_settled_cost IS
  'A ledger row''s cost with its settlements added (a_sale_settles_its_cost). cost_total is what was stamped when the bottles left; settled_difference is the sum of inventory_lot_draw_settlements.difference; settled_cost_total is the two together, NULL only when nothing was ever priced or settled. Both exact at six places (a_settlement_keeps_six_places): sum them, then round once. unpriced_qty_remaining is unpriced_qty less the bottles of unpriced draws that have since been settled.';

REVOKE ALL ON public.inventory_transaction_settled_cost FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.inventory_transaction_settled_cost TO service_role;

-- Structural assertions (catalogs only).
DO $$
DECLARE
  v_src text;
  r record;
BEGIN
  FOR r IN
    SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod) AS t
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND ((c.relname = 'inventory_lot_draw_settlements' AND a.attname IN ('prior_total', 'settled_total', 'difference'))
         OR (c.relname = 'inventory_transaction_settled_cost' AND a.attname IN ('settled_difference', 'settled_cost_total')))
  LOOP
    IF r.t <> 'numeric(16,6)' THEN
      RAISE EXCEPTION 'a_settlement_keeps_six_places: %.% is %, not numeric(16,6)', r.relname, r.attname, r.t;
    END IF;
  END LOOP;
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.finalise_delivery_cost(uuid, uuid, numeric, text, uuid, text, text)'::regprocedure;
  IF position('round(v_draw.qty' in v_src) > 0 OR position('INSERT INTO inventory_lot_draw_settlements' in v_src) = 0 THEN
    RAISE EXCEPTION 'a_settlement_keeps_six_places: finalise_delivery_cost still rounds a settlement, or settles nothing';
  END IF;
  IF has_table_privilege('anon', 'public.inventory_transaction_settled_cost', 'SELECT')
     OR has_table_privilege('authenticated', 'public.inventory_transaction_settled_cost', 'SELECT') THEN
    RAISE EXCEPTION 'a_settlement_keeps_six_places: the settled view is reachable by a client role';
  END IF;
END;
$$;

COMMIT;
