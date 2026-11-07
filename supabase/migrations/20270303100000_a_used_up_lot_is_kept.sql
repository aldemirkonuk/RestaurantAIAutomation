-- a_used_up_lot_is_kept: a lot sold to zero stays, with its cost (R6).
--
-- WRONG BEFORE: apply_stock_movement's FIFO draw DELETEd each lot it took to
-- zero, and transfer_stock DELETEd a lot it moved whole and re-inserted a copy
-- without received_at, delivery_id or cost_state. The unit_cost of what was
-- sold left with the bottle (cost-math lane 2.1, before lane 2.2's draws).
-- R6, PR #589: "Lots are never deleted: a used-up lot stays at 0 with a
-- depleted status."
--
-- 1. inventory_lots.depleted_at; status already allows 'depleted'.
-- 2. One BEFORE trigger marks a lot holding nothing as depleted, for every
--    writer (record_glass_pour already left emptied lots at 0, unmarked).
-- 3. apply_stock_movement: newest body verbatim; the FIFO branch sets qty = 0
--    instead of DELETE. Same signature: ACL, comment, one overload kept.
-- 4. transfer_stock: a whole lot changes location_id; a part move still splits.
-- 5. inventory_lot_rollup and inventory_location_breakdown read only lots
--    holding something, so a kept lot reads as a deleted one did.
-- 6. Lots already emptied are marked once, depleted_at = updated_at.
--
-- Unchanged: revalue_lot and finalise_delivery_cost loop only qty > 0 lots.

BEGIN;

ALTER TABLE public.inventory_lots ADD COLUMN IF NOT EXISTS depleted_at timestamptz NULL;

COMMENT ON COLUMN public.inventory_lots.depleted_at IS
  'When the lot ran out (qty and open_bottle_ml both 0); NULL while it holds anything. Set by trg_a_used_up_lot_is_marked. A used-up lot is kept, never deleted (R6).';

CREATE OR REPLACE FUNCTION public.mark_used_up_lot() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.qty = 0 AND NEW.open_bottle_ml = 0 THEN
    NEW.depleted_at := COALESCE(NEW.depleted_at, now());
    NEW.status := 'depleted';
  ELSE
    NEW.depleted_at := NULL;
    IF NEW.status = 'depleted' THEN NEW.status := 'active'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_a_used_up_lot_is_marked ON public.inventory_lots;
CREATE TRIGGER trg_a_used_up_lot_is_marked
  BEFORE INSERT OR UPDATE OF qty, open_bottle_ml ON public.inventory_lots
  FOR EACH ROW EXECUTE FUNCTION public.mark_used_up_lot();

-- 6. once (the trigger does not fire: qty and open_bottle_ml are not SET).
UPDATE public.inventory_lots
   SET depleted_at = updated_at, status = 'depleted'
 WHERE qty = 0 AND open_bottle_ml = 0 AND depleted_at IS NULL;

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
    FOR v_lot IN SELECT id, qty FROM inventory_lots
        WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state AND qty > 0
        ORDER BY received_at ASC, created_at ASC LOOP
      EXIT WHEN v_remaining <= 0;
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
  END IF;

  INSERT INTO inventory_transactions
    (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change, quantity_before, quantity_after,
     stock_type, unit_cost, performed_by, performed_by_type, reason, order_id, idempotency_key, transaction_date,
     reference_type, reference_id, pos_transaction_id, notes, metadata, delivery_id)
  VALUES
    (v_restaurant, p_inventory_id, v_wine, p_transaction_type::inventory_transaction_type, p_source::inventory_transaction_source,
     p_delta, v_before, v_after, p_stock_state, p_unit_cost, p_performed_by,
     CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
     p_reason, p_order_id, p_idempotency_key,
     -- a_pos_sale_is_dated_by_its_check: the moment the movement HAPPENED, as
     -- the caller knows it (a POS check's closed_at), never later than now.
     -- NULL is now(), exactly as before. created_at keeps entry time.
     LEAST(COALESCE(p_occurred_at, now()), now()),
     p_reference_type, p_reference_id, p_pos_transaction_id, p_notes, COALESCE(p_metadata, '{}'::jsonb), v_delivery)
  RETURNING id INTO v_txn;

  RETURN v_txn;
END;
$$;

-- 4. transfer_stock

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
  FOR v_lot IN SELECT id, qty, unit_cost, cost_provenance, vintage, source_order_id FROM inventory_lots
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
      INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, unit_cost, cost_provenance, vintage, source_order_id)
      VALUES (v_restaurant, p_inventory_id, v_wine, p_to_location_id, 'live', v_move, v_lot.unit_cost, v_lot.cost_provenance, v_lot.vintage, v_lot.source_order_id);
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
-- 5. the two lot views

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
                        / (sum(qty) FILTER (WHERE ((unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))))::numeric), 2)
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
            WHEN (COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))), (0)::bigint) > 0) THEN round((sum(((qty)::numeric * unit_cost)) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))) / (sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))))::numeric), 2)
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

-- Structural assertions (catalogs only).
DO $$
DECLARE
  v_src text;
BEGIN
  IF (SELECT array_agg(p.pronargs) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'apply_stock_movement') IS DISTINCT FROM ARRAY[19::int2] THEN
    RAISE EXCEPTION 'expected exactly one public.apply_stock_movement, of 19 arguments';
  END IF;
  FOR v_src IN SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname IN ('apply_stock_movement', 'transfer_stock') LOOP
    IF v_src ~* 'DELETE\s+FROM\s+(public\.)?inventory_lots' THEN
      RAISE EXCEPTION 'a stock writer still deletes a lot; a used-up lot is kept (R6)';
    END IF;
  END LOOP;
  IF position('LEAST(COALESCE(p_occurred_at, now()), now())' in
       (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'apply_stock_movement')) = 0 THEN
    RAISE EXCEPTION 'apply_stock_movement lost ADR 0281''s dating in the copy';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.inventory_lots'::regclass
                    AND tgname = 'trg_a_used_up_lot_is_marked' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'trg_a_used_up_lot_is_marked is missing';
  END IF;
END;
$$;

COMMIT;
