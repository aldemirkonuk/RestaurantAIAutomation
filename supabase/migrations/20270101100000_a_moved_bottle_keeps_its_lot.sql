-- ===========================================================================
-- F-427 / F-428 — a moved bottle keeps its lot, and an open bottle is never
-- deleted with the sealed ones beside it
-- ===========================================================================
--
-- WHAT WAS WRONG (re-read at origin/main 7379426e3).
--
-- F-427. `transfer_stock` was never redefined after the baseline
-- (20260805000000_baseline_from_production.sql:1838-1883). It deleted or
-- shrank the source lot and INSERTed a new one at the destination naming only
-- restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty,
-- unit_cost, cost_provenance, vintage and source_order_id (:1873-1874). So the
-- moved bottles lost:
--   * delivery_id (stock_at_the_door_cost_at_verified :76-77) -> NULL, and
--     finalise_delivery_cost prices only `WHERE delivery_id = p_delivery_id`
--     (:335-341): bottles moved before the invoice is VERIFIED stay uncosted
--     and provisional for good;
--   * received_at -> now(), so FIFO (ORDER BY received_at in
--     apply_stock_movement and record_glass_pour) treats old stock as newest;
--   * cost_state -> the column default 'provisional', even for a final lot;
--   * status, and the lot id itself (inventory_lot_revaluations.lot_id is ON
--     DELETE SET NULL, so a full move also orphaned the lot's cost history).
--
-- F-428. Two paths deleted a lot once its SEALED bottles were used up without
-- reading open_bottle_ml, which record_glass_pour keeps on the lot it opened
-- the bottle from (a_pos_sale_is_dated_by_its_check :373-377):
--   * transfer_stock: `IF v_lot.qty <= v_move THEN DELETE` (baseline :1869);
--   * apply_stock_movement, used by counts, manual adjust, breakage and sales:
--     `IF v_lot.qty <= v_remaining ... DELETE` (a_pos_sale_is_dated_by_its_check
--     :226-228).
-- The open bottle's millilitres left the books with no ledger row, and the next
-- glass opened a new bottle (or was refused) while a real one stood open.
--
-- WHAT THIS MIGRATION DOES (decision note:
-- p4-scratch/sim-run/bulletproof/reconcile/lots-sql-decisions.md).
--
-- transfer_stock moves SEALED bottles. For each source lot it draws from:
--   * the whole lot moves and it holds no open bottle -> the SAME row is
--     re-pointed at the destination (one UPDATE of location_id). Every column
--     and the lot id stay, so revaluation history stays attached;
--   * otherwise the lot is SPLIT: the source keeps qty - moved (possibly 0)
--     and its open_bottle_ml, and a copy at the destination carries the moved
--     qty with the source's delivery_id, received_at, cost_state, unit_cost,
--     cost_provenance, vintage, status and source_order_id, and 0 open ml.
--     The open bottle stays where it stands: a transfer of N bottles moves N
--     sealed bottles, which is all its ledger pair says.
-- apply_stock_movement, depleting: a lot whose sealed qty is used up is
-- DELETEd only when it holds no open ml; otherwise it stays at qty 0 with its
-- ml, which the next glass pour finishes (ADR 0285's draw reads open ml on any
-- lot, qty 0 included).
--
-- Nothing else changes. The apply_stock_movement body is
-- a_pos_sale_is_dated_by_its_check's verbatim apart from the depletion loop
-- (marked), and keeps its signature, so CREATE OR REPLACE re-uses the same
-- function: no overload, no grant change, PostgREST resolves as before. The
-- transfer_stock signature and its balanced ledger pair are unchanged.
--
-- KNOWN, NOT CHANGED HERE: finalise_delivery_cost matches `qty > 0` lots, so a
-- lot held only as open ml at VERIFIED is not repriced. That was already true
-- of the qty-0 lots record_glass_pour leaves; it is not F-427/F-428.
--
-- A LANE THAT LATER ADDS AN inventory_lots COLUMN must add it to the split
-- copy in transfer_stock below, or a transfer drops it again.
--
-- NOT APPLIED BY HAND. The Supabase GitHub integration applies migrations on
-- merge, keyed by this filename.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. transfer_stock: move or split the lot, never re-insert a bare one
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
      INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, open_bottle_ml,
                                  unit_cost, cost_provenance, vintage, status, source_order_id, received_at, cost_state, delivery_id)
      SELECT v_restaurant, p_inventory_id, v_wine, p_to_location_id, 'live', v_move, 0,
             l.unit_cost, l.cost_provenance, l.vintage, l.status, l.source_order_id, l.received_at, l.cost_state, l.delivery_id
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
  'cost_state, unit_cost, cost_provenance, vintage, status and source_order_id. '
  'An open bottle stays on its source lot, which is kept at qty 0 if need be. '
  'Migration a_moved_bottle_keeps_its_lot (F-427, F-428). Takes no restaurant: '
  'callers prove the item is the house''s own first (ADR 0141).';

-- ---------------------------------------------------------------------------
-- 2. apply_stock_movement: a used-up lot with an open bottle is kept
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
    FOR v_lot IN SELECT id, qty, open_bottle_ml FROM inventory_lots
        WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state AND qty > 0
        ORDER BY received_at ASC, created_at ASC LOOP
      EXIT WHEN v_remaining <= 0;
      IF v_lot.qty <= v_remaining THEN
        v_remaining := v_remaining - v_lot.qty;
        -- a_moved_bottle_keeps_its_lot (F-428): the sealed bottles are used up,
        -- but an open bottle's ml are not; the lot stays at qty 0 to hold them.
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
     p_reference_type, p_reference_id, p_pos_transaction_id, p_notes, COALESCE(p_metadata, '{}'::jsonb), v_delivery)
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
  'Changed by a_moved_bottle_keeps_its_lot (F-428): a lot whose sealed bottles '
  'are used up is deleted only when it holds no open bottle; otherwise it stays '
  'at qty 0 with its open_bottle_ml. '
  'Use revalue_lot or finalise_delivery_cost to CORRECT a cost — this function '
  'only ever creates or consumes quantity.';

-- ---------------------------------------------------------------------------
-- 3. In-file assertions (structural only; pg_proc, never a live table).
--    Behaviour: supabase/tests/20270101100000_a_moved_bottle_keeps_its_lot_test.sql
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_src text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'apply_stock_movement') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one public.apply_stock_movement after this migration. Two overloads make PostgREST ambiguous and every named-argument call fails.';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'apply_stock_movement'
     AND p.pronargs = 19 AND p.pronargdefaults = 14
     AND p.proargnames[18] = 'p_restaurant_id' AND p.proargnames[19] = 'p_occurred_at';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'apply_stock_movement lost the ADR 0281 signature (19 arguments, 14 defaulted, p_restaurant_id then p_occurred_at)';
  END IF;
  IF position('does not match the item' in v_src) = 0
     OR position('LEAST(COALESCE(p_occurred_at, now()), now())' in v_src) = 0
     OR position('IF v_lot.open_bottle_ml > 0 THEN' in v_src) = 0 THEN
    RAISE EXCEPTION 'apply_stock_movement body lost the ADR 0141 refusal, the ADR 0281 date, or the F-428 open-bottle keep';
  END IF;

  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'transfer_stock') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one public.transfer_stock after this migration';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'transfer_stock';
  IF position('l.received_at, l.cost_state, l.delivery_id' in v_src) = 0
     OR position('DELETE FROM inventory_lots' in v_src) > 0 THEN
    RAISE EXCEPTION 'transfer_stock must split or re-point a lot (F-427/F-428), never delete and re-insert a bare one';
  END IF;
END;
$$;

COMMIT;
