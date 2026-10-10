-- ===========================================================================
-- A returned bottle keeps its cost, and a take-off comes off the named place
-- (sim findings F-644, F-646 b; wave 21, 2026-10-09)
-- ===========================================================================
--
-- WHAT WAS WRONG (re-read at origin/main 31152ab34).
--
-- F-644. A count that finds more bottles than the books say
-- (record_stock_count, a_count_is_a_record :297-301) and a voided POS sale
-- (pos-hub.service.ts, the void branch) both put bottles back with
-- apply_stock_movement and no price. The positive branch then made a NEW lot
-- with unit_cost NULL, provenance 'estimated' and no location
-- (a_pos_sale_is_dated_by_its_check :216-218). When that was the wine's only
-- lot -- the last bottle sold, then voided; or the books at 0 and two bottles
-- on the shelf -- inventory_lot_rollup.wac went NULL, resolveUnitCost said
-- "unknown", and /reports withheld the whole house's cellar value for one
-- bottle of one wine.
--
-- F-646 b. A take-off that names a place (a breakage at the bar) drained the
-- oldest lot anywhere, so the bar's bottle came off the cellar's lot.
--
-- WHAT THIS MIGRATION DOES. apply_stock_movement only; same signature, so
-- CREATE OR REPLACE keeps its grants and its single overload.
--
--   * A take-off writes down every lot it took from (cost, provenance,
--     cost_state, place) in its ledger row's metadata.lots_taken, and takes
--     from the named place first, then FIFO from everywhere else -- the two
--     tiers record_glass_pour already uses (ADR 0285).
--   * A bottle that comes back with no price named (types return,
--     reconciliation, adjustment, correction; never a purchase, an opening
--     count or a delivery) carries the live lots' average cost, else the cost
--     of the last lot this wine was taken from, else stays uncosted as before.
--     Provenance and cost_state travel with the price; ADR 0078 still holds:
--     nothing is inferred that a document or a person did not record.
--   * It also gets a place when none is named: where the wine last left from,
--     else where its newest bottles are.
--
-- record_stock_count is NOT redefined here (fix/sim-count-location, F-291,
-- redefines it with a shelf); it reaches this through apply_stock_movement.
-- Movements written before this migration carry no lots_taken, so a wine whose
-- last costed lot emptied before it still comes back uncosted -- the gateway
-- then leaves that wine out of the cellar total and says how many it left out.
--
-- Proof: supabase/tests/20270103300000_a_returned_bottle_keeps_its_cost_test.sql
-- (PGlite, full corpus; fails without this migration).
--
-- NOT APPLIED BY HAND. The Supabase GitHub integration applies migrations on
-- merge, keyed by this filename.

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
  -- a_returned_bottle_keeps_its_cost (F-644 / F-646 b).
  v_cost numeric; v_cost_prov text; v_cost_st text; v_cost_from text;
  v_location uuid; v_taken jsonb := '[]'::jsonb; v_take int;
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
    v_cost := p_unit_cost; v_location := p_location_id;
    -- a_returned_bottle_keeps_its_cost (F-644). A bottle that comes BACK onto
    -- the books -- a count that finds more than the books say, a voided sale, a
    -- correction -- is a bottle of this wine the house already paid for. When
    -- the caller names no price, it carries the price the wine already has:
    --   1. the live lots' own average, if any live lot is costed;
    --   2. else the cost of the last lot a movement of this wine took bottles
    --      from (recorded on that movement as metadata.lots_taken, below);
    --   3. else nothing -- the lot stays uncosted ('estimated', no price), as
    --      before. Nothing is invented.
    -- The provenance and cost_state travel with the price: an invoiced price
    -- stays invoiced, a door price nobody has verified stays provisional.
    -- A purchase, an opening count or a delivery is NOT a return: it brings in
    -- stock from outside and names its own cost, so it is left alone.
    IF p_unit_cost IS NULL AND p_cost_provenance IS NULL AND v_delivery IS NULL
       AND p_transaction_type IN ('return','reconciliation','adjustment','correction') THEN
      SELECT round(sum(qty * unit_cost) / sum(qty), 2),
             CASE WHEN count(DISTINCT cost_provenance) = 1 THEN min(cost_provenance) ELSE 'estimated' END,
             CASE WHEN bool_and(cost_state = 'final') THEN 'final' ELSE 'provisional' END
        INTO v_cost, v_cost_prov, v_cost_st
        FROM inventory_lots
       WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state AND qty > 0
         AND unit_cost IS NOT NULL AND cost_provenance <> 'sample';
      IF v_cost IS NOT NULL THEN
        v_cost_from := 'live_lots';
      ELSE
        SELECT (e.lot->>'unit_cost')::numeric, e.lot->>'cost_provenance', COALESCE(e.lot->>'cost_state', 'provisional')
          INTO v_cost, v_cost_prov, v_cost_st
          FROM inventory_transactions t
          CROSS JOIN LATERAL jsonb_array_elements(t.metadata->'lots_taken') WITH ORDINALITY AS e(lot, n)
         WHERE t.inventory_id = p_inventory_id AND t.stock_type = p_stock_state AND t.quantity_change < 0
           AND jsonb_typeof(t.metadata->'lots_taken') = 'array'
           AND e.lot->>'unit_cost' IS NOT NULL AND e.lot->>'cost_provenance' IN ('invoice','estimated','manual')
         ORDER BY t.transaction_date DESC, t.created_at DESC, e.n DESC
         LIMIT 1;
        IF v_cost IS NOT NULL THEN v_cost_from := 'lot_taken'; END IF;
      END IF;
      IF v_cost IS NOT NULL THEN
        v_provenance := v_cost_prov;
        -- An estimate is never a settled cost, whatever the lots it came from.
        v_cost_state := CASE WHEN v_cost_prov IN ('invoice','manual') THEN v_cost_st ELSE 'provisional' END;
      END IF;
    END IF;
    -- ... and a place. A count names no shelf; the bottle goes where this wine
    -- last left from, else where its newest bottles are.
    IF v_location IS NULL THEN
      SELECT (e.lot->>'location_id')::uuid INTO v_location
        FROM inventory_transactions t
        CROSS JOIN LATERAL jsonb_array_elements(t.metadata->'lots_taken') WITH ORDINALITY AS e(lot, n)
       WHERE t.inventory_id = p_inventory_id AND t.stock_type = p_stock_state AND t.quantity_change < 0
         AND jsonb_typeof(t.metadata->'lots_taken') = 'array'
         AND e.lot->>'location_id' IS NOT NULL
       ORDER BY t.transaction_date DESC, t.created_at DESC, e.n DESC
       LIMIT 1;
      IF v_location IS NULL THEN
        SELECT location_id INTO v_location FROM inventory_lots
         WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state AND qty > 0
           AND location_id IS NOT NULL
         ORDER BY received_at DESC, created_at DESC LIMIT 1;
      END IF;
    END IF;
    INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, unit_cost, cost_provenance, source_order_id, delivery_id, cost_state)
    VALUES (v_restaurant, p_inventory_id, v_wine, v_location, p_stock_state, p_delta, v_cost,
            v_provenance, p_order_id, v_delivery, v_cost_state);
  ELSE
    v_remaining := -p_delta;
    -- a_returned_bottle_keeps_its_cost (F-646 b): a movement that names a place
    -- takes from that place first (a bottle broken at the bar comes off the
    -- bar), then FIFO from everywhere else -- record_glass_pour's two tiers.
    -- Every lot it takes from is written down on the ledger row, so a bottle
    -- that later comes back can carry that lot's cost (F-644).
    FOR v_lot IN SELECT id, qty, unit_cost, cost_provenance, cost_state, location_id FROM inventory_lots
        WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state AND qty > 0
        ORDER BY (p_location_id IS NOT NULL AND location_id IS NOT DISTINCT FROM p_location_id) DESC,
                 received_at ASC, created_at ASC LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_lot.qty, v_remaining);
      v_taken := v_taken || jsonb_build_array(jsonb_build_object(
        'lot_id', v_lot.id, 'qty', v_take, 'unit_cost', v_lot.unit_cost,
        'cost_provenance', v_lot.cost_provenance, 'cost_state', v_lot.cost_state,
        'location_id', v_lot.location_id));
      IF v_lot.qty <= v_remaining THEN
        v_remaining := v_remaining - v_lot.qty;
        DELETE FROM inventory_lots WHERE id = v_lot.id;
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
     p_reference_type, p_reference_id, p_pos_transaction_id, p_notes,
     -- a_returned_bottle_keeps_its_cost: what a take-off took, and where a
     -- returned bottle's price came from. Added keys only; the caller's own
     -- metadata is kept as it was sent.
     COALESCE(p_metadata, '{}'::jsonb)
       || CASE WHEN p_delta < 0 THEN jsonb_build_object('lots_taken', v_taken) ELSE '{}'::jsonb END
       || CASE WHEN v_cost_from IS NOT NULL THEN jsonb_build_object('cost_carried_from', v_cost_from) ELSE '{}'::jsonb END,
     v_delivery)
  RETURNING id INTO v_txn;

  RETURN v_txn;
END;
$$;

COMMENT ON FUNCTION public.apply_stock_movement IS
  'Single stock write primitive (SimPOS testbed plan, decision A1). Locks the '
  'inventory row, depletes/creates lots FIFO, writes the ledger row, and is '
  'idempotent on p_idempotency_key. Extended 2026-08-05 with reference_type, '
  'reference_id, pos_transaction_id, notes and metadata. Changed 2026-09-02 '
  '(ADR 0078): cost provenance is never inferred. Changed 2026-09-06 (ADR 0103 '
  'A1): a caller naming p_reference_type = ''delivery'' stamps '
  'inventory_transactions.delivery_id and inventory_lots.delivery_id, and the '
  'lot it creates is cost_state = ''provisional'' until finalise_delivery_cost '
  'settles it at VERIFIED. Changed 2026-09-12 (ADR 0141): p_restaurant_id says '
  'WHICH HOUSE the movement is for, and an item that does not belong to it '
  'RAISES 42501 before the idempotency lookup and again under the row lock — '
  'the tenant of a stock write is no longer decided by the inventory id alone. '
  'p_restaurant_id DEFAULTS TO NULL and a NULL asserts nothing; that default '
  'exists only to survive the window between this migration applying at merge '
  'and the gateway deploying after it, and a later migration makes NULL refuse. '
  'Changed by ADR 0281: p_occurred_at is when the movement HAPPENED (a POS '
  'check''s closed_at); transaction_date is LEAST(COALESCE(p_occurred_at, '
  'now()), now()), so NULL is now() as before and a future time is clamped. '
  'created_at keeps entry time. '
  'Changed by a_returned_bottle_keeps_its_cost (F-644, F-646): a take-off takes '
  'from p_location_id first and records the lots it took in metadata.lots_taken; '
  'a return / reconciliation / adjustment / correction with no price named '
  'carries the live lots'' average cost, else the last taken lot''s cost, with '
  'its provenance and cost_state, and a place (metadata.cost_carried_from says '
  'which). '
  'Use revalue_lot or finalise_delivery_cost to CORRECT a cost — this function '
  'only ever creates or consumes quantity.';

COMMIT;
