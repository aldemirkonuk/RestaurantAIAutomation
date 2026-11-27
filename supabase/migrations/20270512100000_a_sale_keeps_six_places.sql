-- a_sale_keeps_six_places (QA round 19, lines 57-61): on a tree that holds
-- both #909 (a_lot_cost_keeps_small_units, lot cost at six places) and #845,
-- #845's later-dated migrations put the two-place rounding back: the lot
-- views are recreated with round(..., 2) (20270303100000:282, :297), and
-- apply_stock_movement sums each sale's cost into a numeric(12,2) variable
-- written to cost_total numeric(12,2) (20270410100700). A 10.0049 bottle sold
-- one at a time reaches cost of goods as 10.00.
--
-- The session's call under the 2026-11-07 /goal: a migration dated after both
-- restores six places. Rejected: only stating a merge order (the migrations
-- replay by version, whatever order the PRs merge in); carrying a residual on
-- the lot (needs schema, and nothing would read it).
--
-- 1. the two lot views: 20270303100000's definitions verbatim, round(..., 6)
--    where 20270302143700 rounds to 6 (it changes nothing else in them).
-- 2. inventory_transactions.cost_total widens to numeric(16,6); its one
--    dependent view, inventory_transaction_settled_cost, is dropped and
--    recreated as 20270502100100 wrote it, its total cast to numeric(16,6).
-- 3. apply_stock_movement: 20270410100700's body verbatim except the running
--    total is plain numeric. Same signature and ACL.
-- On a tree without #909 this is harmless: lots hold two places, so six-place
-- arithmetic gives the same figures.

BEGIN;

-- 1. the two lot views

CREATE OR REPLACE VIEW public.inventory_location_breakdown AS
 SELECT inventory_id,
    restaurant_id,
    master_wine_id,
    location_id,
    stock_state,
    sum(qty) AS qty,
        CASE
            WHEN (COALESCE(sum(qty) FILTER (WHERE ((unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))), (0)::bigint) > 0)
            THEN round((sum(((qty)::numeric * unit_cost)) FILTER (WHERE ((unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text)))
                        / (sum(qty) FILTER (WHERE ((unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))))::numeric), 6)
            ELSE NULL::numeric
        END AS wac
   FROM public.inventory_lots
  WHERE ((qty > 0) OR (open_bottle_ml > 0))
  GROUP BY inventory_id, restaurant_id, master_wine_id, location_id, stock_state;

CREATE OR REPLACE VIEW public.inventory_lot_rollup AS
 SELECT inventory_id,
    restaurant_id,
    master_wine_id,
    COALESCE(sum(qty) FILTER (WHERE ((stock_state)::text = 'live'::text)), (0)::bigint) AS live_qty,
    COALESCE(sum(qty) FILTER (WHERE ((stock_state)::text = 'shadow'::text)), (0)::bigint) AS shadow_qty,
        CASE
            WHEN (COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))), (0)::bigint) > 0) THEN round((sum(((qty)::numeric * unit_cost)) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))) / (sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))))::numeric), 6)
            ELSE NULL::numeric
        END AS wac,
    bool_or(((cost_provenance)::text = 'invoice'::text)) FILTER (WHERE ((stock_state)::text = 'live'::text)) AS has_invoice_cost,
    count(*) FILTER (WHERE ((stock_state)::text = 'live'::text)) AS live_lot_count,
    count(DISTINCT location_id) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (location_id IS NOT NULL))) AS live_location_count,
    COALESCE(sum(open_bottle_ml) FILTER (WHERE ((stock_state)::text = 'live'::text)), (0)::bigint) AS open_ml,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND ((cost_provenance)::text = 'sample'::text))), (0)::bigint) AS sample_qty,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))), (0)::bigint) AS wac_qty,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND ((cost_provenance)::text = 'invoice'::text))), (0)::bigint) AS invoice_qty,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NULL) AND ((cost_provenance)::text <> 'sample'::text))), (0)::bigint) AS unpriced_qty
   FROM public.inventory_lots
  WHERE ((qty > 0) OR (open_bottle_ml > 0))
  GROUP BY inventory_id, restaurant_id, master_wine_id;

-- 2. cost_total keeps six places

DROP VIEW IF EXISTS public.inventory_transaction_settled_cost;

ALTER TABLE public.inventory_transactions ALTER COLUMN cost_total TYPE numeric(16,6);

CREATE OR REPLACE VIEW public.inventory_transaction_settled_cost
WITH (security_invoker = true) AS
SELECT t.id AS txn_id,
       t.restaurant_id,
       t.inventory_id,
       t.cost_total,
       COALESCE(s.difference, 0)::numeric(14,2) AS settled_difference,
       CASE WHEN t.cost_total IS NULL AND s.txn_id IS NULL THEN NULL
            ELSE (COALESCE(t.cost_total, 0) + COALESCE(s.difference, 0))::numeric(16,6)
       END AS settled_cost_total,
       t.unpriced_qty,
       (t.unpriced_qty - COALESCE(u.qty, 0))::integer AS unpriced_qty_remaining
  FROM public.inventory_transactions t
  LEFT JOIN (SELECT txn_id, sum(difference) AS difference
               FROM public.inventory_lot_draw_settlements GROUP BY txn_id) s ON s.txn_id = t.id
  LEFT JOIN (SELECT d.txn_id, sum(d.qty) AS qty
               FROM public.inventory_lot_draws d
              WHERE d.unit_cost IS NULL
                AND EXISTS (SELECT 1 FROM public.inventory_lot_draw_settlements x WHERE x.draw_id = d.id)
              GROUP BY d.txn_id) u ON u.txn_id = t.id;

COMMENT ON VIEW public.inventory_transaction_settled_cost IS
  'A ledger row''s cost with its settlements added (a_sale_settles_its_cost). cost_total is what was stamped when the bottles left; settled_difference is the sum of inventory_lot_draw_settlements.difference; settled_cost_total is the two together, NULL only when nothing was ever priced or settled. unpriced_qty_remaining is unpriced_qty less the bottles of unpriced draws that have since been settled.';

REVOKE ALL ON public.inventory_transaction_settled_cost FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.inventory_transaction_settled_cost TO service_role;

-- 3. apply_stock_movement

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
  -- a_sale_carries_its_cost: what the FIFO loop took, lot by lot.
  v_take int;
  v_cost_total numeric;  -- a_sale_keeps_six_places: no rounding while it sums
  v_unpriced int;
  v_draw_lot uuid[] := '{}';
  v_draw_qty int[] := '{}';
  v_draw_cost numeric[] := '{}';
  v_draw_state text[] := '{}';
  v_draw_prov text[] := '{}';
BEGIN
  IF p_delta = 0 THEN RETURN NULL; END IF;
  IF p_stock_state NOT IN ('live','shadow') THEN RAISE EXCEPTION 'invalid stock_state %', p_stock_state; END IF;

  -- ADR 0141 — THE FIRST ASSERTION, BEFORE THE IDEMPOTENCY LOOKUP.
  --
  -- It sits here rather than beside the FOR UPDATE below for one reason: the
  -- idempotency short-circuit returns an EXISTING transaction id for a key it
  -- has seen, and a key is not tenant-scoped. Checking only after that would
  -- let a caller naming another house's item confirm, and retrieve the id of,
  -- a transaction it has no business seeing. A movement that names a house
  -- proves the item is that house's BEFORE anything is looked up or returned.
  --
  -- Deliberately not `FOR UPDATE`: this is a refusal test, not the read the
  -- write depends on, and taking the row lock before the idempotency check
  -- would make every replay contend for a lock it does not need. The
  -- authoritative comparison is repeated below, inside the lock.
  --
  -- A NULL p_restaurant_id asserts NOTHING. That is the deploy window, and it
  -- is temporary — see the header.
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

  -- No inference. A lot with no price is 'estimated' — the column's own schema
  -- default, and the only honest label for a quantity nobody has costed.
  v_provenance := COALESCE(p_cost_provenance, 'estimated');

  -- ADR 0103 A1. A movement that NAMES a delivery books against it, and what it
  -- books is provisional until somebody verifies the delivery. Everything else
  -- is final only when a price AND a provenance that names a document or a
  -- person stand behind it — an estimate is not a settled cost, and saying so
  -- is the whole of finding 2.
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

  -- ADR 0141 — THE AUTHORITATIVE ASSERTION, UNDER THE ROW LOCK.
  --
  -- The check above ran without a lock, so between it and here the item could
  -- in principle have been moved to another restaurant. This one is the
  -- comparison the write actually depends on: v_restaurant is the value about
  -- to be stamped on the lot and the ledger row, and it is compared against
  -- what the caller said it would be. Same sentence, because it is the same
  -- refusal.
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
    INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, unit_cost, cost_provenance, source_order_id, delivery_id, cost_state)
    VALUES (v_restaurant, p_inventory_id, v_wine, p_location_id, p_stock_state, p_delta, p_unit_cost,
            v_provenance, p_order_id, v_delivery, v_cost_state);
  ELSE
    v_remaining := -p_delta;
    v_unpriced := 0;
    FOR v_lot IN SELECT id, qty, unit_cost, cost_state, cost_provenance FROM inventory_lots
        WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state AND qty > 0
        ORDER BY received_at ASC, created_at ASC LOOP
      EXIT WHEN v_remaining <= 0;
      -- a_sale_carries_its_cost: the lot's cost as it is now, before the take.
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
        -- a_used_up_lot_is_kept (R6): kept at 0 with its cost, never deleted;
        -- trg_a_used_up_lot_is_marked marks it depleted if it holds nothing.
        UPDATE inventory_lots SET qty = 0, updated_at = now() WHERE id = v_lot.id;
      ELSE
        UPDATE inventory_lots SET qty = qty - v_remaining, updated_at = now() WHERE id = v_lot.id;
        v_remaining := 0;
      END IF;
    END LOOP;
    -- Bottles the loop found no lot for leave unpriced; the over-draw itself
    -- behaves exactly as before. cost_total stays NULL when nothing was priced.
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
     -- a_pos_sale_is_dated_by_its_check: the moment the movement HAPPENED, as
     -- the caller knows it (a POS check's closed_at), never later than now.
     -- NULL is now(), exactly as before. created_at keeps entry time.
     LEAST(COALESCE(p_occurred_at, now()), now()),
     p_reference_type, p_reference_id, p_pos_transaction_id, p_notes, COALESCE(p_metadata, '{}'::jsonb), v_delivery,
     v_cost_total, v_unpriced)
  RETURNING id INTO v_txn;

  -- a_sale_carries_its_cost: one draw per lot touched, now that the ledger
  -- row has an id. Positive movements took nothing, so they write none.
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

COMMIT;
