-- ===========================================================================
-- A carried cost keeps its money and its tax basis
-- (sim findings F-1653, F-1655; sim 54, 2026-10-14)
-- ===========================================================================
--
-- WHAT WAS WRONG.
--
-- F-1653. apply_stock_movement writes the lots a take-off took into
-- metadata.lots_taken (20270105000000 :258-261) with their cost, provenance
-- and state, but not the money the cost is in, although a lot states it
-- (inventory_lots.unit_cost_currency, 20261231100000). The month close prices
-- a write-off from lots_taken, so a bottle booked from a EUR order that
-- broke at a TRY house was added into the lira total.
--
-- F-1655. A bottle that comes back with no price named (a count that finds
-- more, a voided sale, a correction) carries the wine's cost (F-644), but the
-- lot it makes is inserted without unit_cost_currency or unit_cost_tax_basis
-- (20270105000000 :264-266); transfer_stock's split copy drops both too
-- (20270101100000 :110-113). The triggers re-derive them only from
-- source_order_id, which a returned bottle has not. Once costs are stamped
-- pre-tax (ADR 0341 F3), one recount would read a wine's cost as "not
-- stated" and margin advice would refuse it.
--
-- WHAT THIS MIGRATION DOES.
--
--   * apply_stock_movement: 20270105000000's body verbatim apart from the
--     marked lines. lots_taken gains unit_cost_currency and
--     unit_cost_tax_basis. A carried cost keeps both: from the live lots when
--     every costed lot states the same one (else NULL, not stated), else from
--     the taken lot. Live lots in two currencies have no average -- nothing
--     converts -- so the returned bottle is uncosted rather than priced at a
--     sum of euros and lira. Same signature, so CREATE OR REPLACE keeps its
--     grants and its one overload.
--   * transfer_stock: 20270101100000's body verbatim apart from the split
--     copy, which now copies unit_cost_currency and unit_cost_tax_basis.
--
-- KNOWN, NOT CHANGED HERE: lots_taken entries written before this migration
-- state no money; the month close reads them as the house's, as the cellar
-- reads a lot that states none (no backfill, ADR 0341). A carried tax basis
-- is copied, never inferred: the stamping rule stays ADR 0341 F3's.
--
-- Proof (PGlite, full corpus; fails without this migration):
--   supabase/tests/20270117000000_a_carried_cost_keeps_its_money_and_tax_basis_test.sql
--
-- NOT APPLIED BY HAND. The Supabase GitHub integration applies migrations on
-- merge, keyed by this filename.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. apply_stock_movement: lots_taken and a carried cost keep money and basis
-- ---------------------------------------------------------------------------

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
  -- a_carried_cost_keeps_its_money_and_tax_basis (F-1653, F-1655).
  v_cost_cur text; v_cost_tax text; v_cost_curs int;
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
      -- F-1655: the money and the tax basis travel with the average when
      -- every costed lot states the same one; a mixed or unstated one is
      -- NULL (not stated). F-1653: lots in two moneys have no average at all
      -- -- nothing converts -- so the bottle comes back uncosted, never at a
      -- figure that adds euros to lira.
      SELECT round(sum(qty * unit_cost) / sum(qty), 2),
             CASE WHEN count(DISTINCT cost_provenance) = 1 THEN min(cost_provenance) ELSE 'estimated' END,
             CASE WHEN bool_and(cost_state = 'final') THEN 'final' ELSE 'provisional' END,
             CASE WHEN count(*) = count(unit_cost_currency) AND count(DISTINCT unit_cost_currency) = 1
                  THEN min(unit_cost_currency) END,
             CASE WHEN count(*) = count(unit_cost_tax_basis) AND count(DISTINCT unit_cost_tax_basis) = 1
                  THEN min(unit_cost_tax_basis) END,
             count(DISTINCT unit_cost_currency)
        INTO v_cost, v_cost_prov, v_cost_st, v_cost_cur, v_cost_tax, v_cost_curs
        FROM inventory_lots
       WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state AND qty > 0
         AND unit_cost IS NOT NULL AND cost_provenance <> 'sample';
      IF v_cost_curs > 1 THEN
        v_cost := NULL; v_cost_cur := NULL; v_cost_tax := NULL;
      END IF;
      IF v_cost IS NOT NULL THEN
        v_cost_from := 'live_lots';
      ELSIF COALESCE(v_cost_curs, 0) <= 1 THEN
        SELECT (e.lot->>'unit_cost')::numeric, e.lot->>'cost_provenance', COALESCE(e.lot->>'cost_state', 'provisional'),
               NULLIF(e.lot->>'unit_cost_currency', ''), NULLIF(e.lot->>'unit_cost_tax_basis', '')
          INTO v_cost, v_cost_prov, v_cost_st, v_cost_cur, v_cost_tax
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
    -- F-1655: a carried cost keeps its money and tax basis. NULL otherwise,
    -- so the order triggers still derive both for a lot booked from an order.
    IF v_cost_from IS NULL THEN v_cost_cur := NULL; v_cost_tax := NULL; END IF;
    INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, unit_cost, cost_provenance, source_order_id, delivery_id, cost_state,
                                unit_cost_currency, unit_cost_tax_basis)
    VALUES (v_restaurant, p_inventory_id, v_wine, v_location, p_stock_state, p_delta, v_cost,
            v_provenance, p_order_id, v_delivery, v_cost_state,
            v_cost_cur, v_cost_tax);
  ELSE
    v_remaining := -p_delta;
    -- a_returned_bottle_keeps_its_cost (F-646 b): a movement that names a place
    -- takes from that place first (a bottle broken at the bar comes off the
    -- bar), then FIFO from everywhere else -- record_glass_pour's two tiers.
    -- Every lot it takes from is written down on the ledger row, so a bottle
    -- that later comes back can carry that lot's cost (F-644).
    FOR v_lot IN SELECT id, qty, open_bottle_ml, unit_cost, cost_provenance, cost_state, location_id,
                        unit_cost_currency, unit_cost_tax_basis FROM inventory_lots
        WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state AND qty > 0
        ORDER BY (p_location_id IS NOT NULL AND location_id IS NOT DISTINCT FROM p_location_id) DESC,
                 received_at ASC, created_at ASC LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_lot.qty, v_remaining);
      v_taken := v_taken || jsonb_build_array(jsonb_build_object(
        'lot_id', v_lot.id, 'qty', v_take, 'unit_cost', v_lot.unit_cost,
        'cost_provenance', v_lot.cost_provenance, 'cost_state', v_lot.cost_state,
        'location_id', v_lot.location_id,
        -- F-1653 / F-1655: which money the cost is in, and whether tax is inside it.
        'unit_cost_currency', v_lot.unit_cost_currency, 'unit_cost_tax_basis', v_lot.unit_cost_tax_basis));
      IF v_lot.qty <= v_remaining THEN
        v_remaining := v_remaining - v_lot.qty;
        -- a_moved_bottle_keeps_its_lot (F-428), re-applied (F-1160): the sealed
        -- bottles are used up, but an open bottle's ml are not; the lot stays at
        -- qty 0 to hold them.
        IF v_lot.open_bottle_ml > 0 THEN
          UPDATE inventory_lots SET qty = 0, updated_at = now() WHERE id = v_lot.id;
        ELSE
          DELETE FROM inventory_lots WHERE id = v_lot.id;
        END IF;
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
  'Changed by an_open_bottle_stays_and_a_shelf_count_stays_on_its_shelf '
  '(F-1160): a_moved_bottle_keeps_its_lot''s rule is back -- a lot whose sealed '
  'bottles are used up is deleted only when it holds no open bottle; otherwise '
  'it stays at qty 0 with its open_bottle_ml. '
  'Changed by a_carried_cost_keeps_its_money_and_tax_basis (F-1653, F-1655): '
  'metadata.lots_taken records each lot''s unit_cost_currency and '
  'unit_cost_tax_basis; a returned bottle''s carried cost keeps both (from the '
  'live lots when they all state the same one, else from the taken lot), and '
  'live lots in two currencies carry no average. '
  'Use revalue_lot or finalise_delivery_cost to CORRECT a cost — this function '
  'only ever creates or consumes quantity.';

-- ---------------------------------------------------------------------------
-- 2. transfer_stock: the split copy keeps money and basis
-- ---------------------------------------------------------------------------

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
  FOR v_lot IN SELECT id, qty, open_bottle_ml FROM inventory_lots
      WHERE inventory_id = p_inventory_id AND stock_state='live' AND qty > 0
        AND location_id IS NOT DISTINCT FROM p_from_location_id
      ORDER BY received_at ASC, created_at ASC LOOP
    EXIT WHEN v_remaining <= 0;
    v_move := LEAST(v_lot.qty, v_remaining);
    -- F-427/F-428: the lot keeps its delivery, date and cost state wherever its
    -- bottles go, and an open bottle stays where it stands.
    IF v_lot.qty <= v_move AND v_lot.open_bottle_ml = 0 THEN
      UPDATE inventory_lots SET location_id = p_to_location_id, updated_at = now() WHERE id = v_lot.id;
    ELSE
      UPDATE inventory_lots SET qty = qty - v_move, updated_at = now() WHERE id = v_lot.id;
      -- F-1655: the copy keeps its cost's money and tax basis too.
      INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, open_bottle_ml,
                                  unit_cost, cost_provenance, vintage, status, source_order_id, received_at, cost_state, delivery_id,
                                  unit_cost_currency, unit_cost_tax_basis)
      SELECT v_restaurant, p_inventory_id, v_wine, p_to_location_id, 'live', v_move, 0,
             l.unit_cost, l.cost_provenance, l.vintage, l.status, l.source_order_id, l.received_at, l.cost_state, l.delivery_id,
             l.unit_cost_currency, l.unit_cost_tax_basis
        FROM inventory_lots l WHERE l.id = v_lot.id;
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

COMMENT ON FUNCTION public.transfer_stock(uuid, uuid, uuid, integer, uuid, text) IS
  'Moves p_qty SEALED bottles of an item between two storage locations of one '
  'house, oldest lot first, and writes a balanced out/in ledger pair. A lot '
  'that moves whole with no open bottle is re-pointed in place (same id); '
  'otherwise it is split and the copy keeps delivery_id, received_at, '
  'cost_state, unit_cost, cost_provenance, unit_cost_currency, '
  'unit_cost_tax_basis, vintage, status and source_order_id. '
  'An open bottle stays on its source lot, which is kept at qty 0 if need be. '
  'Migration a_moved_bottle_keeps_its_lot (F-427, F-428). Takes no restaurant: '
  'callers prove the item is the house''s own first (ADR 0141).';

-- ---------------------------------------------------------------------------
-- 3. In-file assertions (structural only; pg_proc, never a live table).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_src text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'apply_stock_movement') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one public.apply_stock_movement after this migration';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'apply_stock_movement';
  IF position('IF v_lot.open_bottle_ml > 0 THEN' in v_src) = 0
     OR position('lots_taken' in v_src) = 0
     OR position('''unit_cost_currency'', v_lot.unit_cost_currency' in v_src) = 0
     OR position('does not match the item' in v_src) = 0
     OR position('LEAST(COALESCE(p_occurred_at, now()), now())' in v_src) = 0 THEN
    RAISE EXCEPTION 'apply_stock_movement lost the F-428 open-bottle keep, the money in lots_taken, the ADR 0141 refusal or the ADR 0281 date';
  END IF;

  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'transfer_stock') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one public.transfer_stock after this migration';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'transfer_stock';
  IF position('l.received_at, l.cost_state, l.delivery_id' in v_src) = 0
     OR position('l.unit_cost_currency, l.unit_cost_tax_basis' in v_src) = 0
     OR position('DELETE FROM inventory_lots' in v_src) > 0 THEN
    RAISE EXCEPTION 'transfer_stock must split or re-point a lot and keep its cost''s money and tax basis (F-427, F-428, F-1655)';
  END IF;
END;
$$;

COMMIT;
