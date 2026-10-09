-- a_shelf_count_reconciles_that_shelf — a spot count of one shelf moves only
-- that shelf (F-291).
--
-- WHAT WAS WRONG
-- --------------
-- record_stock_count (20260902190000_a_count_is_a_record.sql:204-213) takes no
-- location. It compares the number counted with the lot sum across EVERY
-- location (:264-269) and hands the difference to apply_stock_movement with a
-- NULL location (:297-301). A negative difference then drains the oldest lots
-- wherever they sit (20261222100000_a_pos_sale_is_dated_by_its_check.sql, the
-- FIFO loop over every lot of the item), and a positive one makes an
-- Unassigned lot.
--
-- So with 8 bottles in the Cellar and 3 in the Bar, the cellar counter enters
-- 8 and the books lose 3 bottles from whichever lots are oldest, perhaps the
-- cellar's own. Two counters on two shelves overwrite each other.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- record_stock_count gains p_location_id uuid DEFAULT NULL.
--
--   * NULL: nothing changes. Expected is the lot sum everywhere and the
--     movement goes through apply_stock_movement exactly as before.
--   * A location: it must be one of the item's own house's storage_locations
--     (refused otherwise, before anything is read back). Expected is the lot
--     sum IN THAT LOCATION only. A positive difference becomes a lot in that
--     location (apply_stock_movement already places a new lot where it is
--     told). A negative difference takes bottles off that location's lots
--     only, oldest first, and writes the one ledger row itself.
--
-- WHY THE TAKE-OFF IS WRITTEN HERE AND NOT IN apply_stock_movement
-- ----------------------------------------------------------------
-- apply_stock_movement's negative branch drains every location. It is the
-- shared write for the POS, the ledger transactions route and the
-- orchestrator, so scoping that branch would change a primitive this fix does
-- not need to touch, and ADR 0281 asks any lane that redefines it to copy its
-- whole body. transfer_stock (baseline) already depletes one
-- location's lots and writes its own ledger rows, so this follows that shape:
-- same row lock, same FIFO order, same inventory_transactions columns that
-- apply_stock_movement writes, with quantity_before/after as the item's whole
-- total so valid_quantity_after holds and the ledger reads the same as every
-- other row. from_location_id names the shelf.
--
-- stock_counts gains location_id: which shelf a count was of, NULL for a count
-- of every shelf. expected_qty is then that shelf's figure.
--
-- ORDER OF OPERATIONS (ADR 0078) is unchanged: lock, replay gate, read
-- expected, INSERT the count unconditionally, then move stock only on a
-- non-zero difference, then stamp last_counted_at.
--
-- The old 8-argument function is dropped first: a second overload with a
-- defaulted 9th argument would make every named-argument call that omits it
-- ambiguous. Its only callers are the gateway's two named-argument RPCs
-- (inventory.service.ts recordSpotCount, inventory-ledger.service.ts
-- reconcileInventory); no SQL calls it. No migration GRANTs or REVOKEs it, so
-- the new one carries the same default EXECUTE. The block at the end asserts
-- exactly one survives.
--
-- NOT APPLIED BY HAND. The Supabase GitHub integration applies migrations on
-- merge, keyed by this filename.

BEGIN;

ALTER TABLE public.stock_counts
  ADD COLUMN IF NOT EXISTS location_id uuid
    REFERENCES public.storage_locations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.stock_counts.location_id IS
  'The shelf (storage_locations) this count was of, or NULL for a count of every shelf at once. With a shelf, expected_qty is that shelf''s lot sum and the movement touched only that shelf''s lots (F-291).';

DROP FUNCTION IF EXISTS public.record_stock_count(
    uuid, integer, text, text, text, text, uuid, text
);

CREATE FUNCTION public.record_stock_count(
    p_inventory_id     uuid,
    p_counted_qty      integer,
    p_idempotency_key  text,
    p_stock_state      text    default 'live',
    p_source           text    default 'mobile_count',
    p_transaction_type text    default 'reconciliation',
    p_performed_by     uuid    default null,
    p_reason           text    default null,
    p_location_id      uuid    default null
) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_restaurant uuid;
  v_wine       uuid;
  v_expected   int;
  v_delta      int;
  v_txn        uuid;
  v_before     int;
  v_remaining  int;
  v_lot        record;
  v_count      public.stock_counts%rowtype;
BEGIN
  IF p_stock_state NOT IN ('live','shadow') THEN
    RAISE EXCEPTION 'invalid stock_state %', p_stock_state;
  END IF;
  IF p_counted_qty IS NULL OR p_counted_qty < 0 THEN
    RAISE EXCEPTION 'counted_qty must be a non-negative integer, got %', p_counted_qty;
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'p_idempotency_key is required: a count that cannot be de-duplicated cannot be a record';
  END IF;

  -- (1) Lock FIRST.
  SELECT restaurant_id, master_wine_id INTO v_restaurant, v_wine
    FROM public.restaurant_inventory
   WHERE id = p_inventory_id
     FOR UPDATE;
  IF v_restaurant IS NULL THEN
    RAISE EXCEPTION 'inventory % not found', p_inventory_id;
  END IF;

  -- A shelf must be this house's own, checked before the replay gate so a
  -- foreign location id learns nothing about an earlier count.
  IF p_location_id IS NOT NULL THEN
    PERFORM 1 FROM public.storage_locations
      WHERE id = p_location_id AND restaurant_id = v_restaurant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That place is not one of this house''s storage locations, so nothing was counted.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- (2) Replay gate, shared with the movement's key.
  SELECT * INTO v_count FROM public.stock_counts
   WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'count_id',       v_count.id,
      'expected_qty',   v_count.expected_qty,
      'counted_qty',    v_count.counted_qty,
      'variance_qty',   v_count.variance_qty,
      'transaction_id', v_count.transaction_id,
      'counted_at',     v_count.counted_at,
      'location_id',    v_count.location_id,
      'replayed',       true
    );
  END IF;

  -- (3) What the system believed, under the lock: every shelf, or the one
  -- shelf that was counted.
  SELECT COALESCE(SUM(qty), 0) INTO v_expected
    FROM public.inventory_lots
   WHERE inventory_id = p_inventory_id
     AND stock_state  = p_stock_state
     AND (p_location_id IS NULL OR location_id = p_location_id);

  v_delta := p_counted_qty - v_expected;

  -- (4) THE COUNT IS RECORDED HERE, UNCONDITIONALLY, above every branch on
  -- v_delta (scripts/check_a_count_is_recorded.py arm B).
  INSERT INTO public.stock_counts (
      restaurant_id, inventory_id, stock_state,
      expected_qty, counted_qty, source, reason,
      counted_by, idempotency_key, location_id
  ) VALUES (
      v_restaurant, p_inventory_id, p_stock_state,
      v_expected, p_counted_qty, p_source, p_reason,
      p_performed_by, p_idempotency_key, p_location_id
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO v_count;

  IF v_count.id IS NULL THEN
    SELECT * INTO v_count FROM public.stock_counts
     WHERE idempotency_key = p_idempotency_key;
  END IF;

  -- (5) The movement is a consequence of disagreement.
  IF v_delta > 0 OR (v_delta < 0 AND p_location_id IS NULL) THEN
    -- Unchanged path; with a shelf, the new lot lands on that shelf.
    v_txn := public.apply_stock_movement(
      p_inventory_id, p_stock_state, v_delta,
      p_transaction_type, p_source, p_performed_by, p_reason,
      NULL, p_location_id, NULL, p_idempotency_key
    );
    UPDATE public.stock_counts SET transaction_id = v_txn WHERE id = v_count.id;
  ELSIF v_delta < 0 THEN
    -- Take bottles off THIS shelf only, oldest first. The shelf held
    -- v_expected >= -v_delta, so the loop always finishes.
    SELECT COALESCE(SUM(qty), 0) INTO v_before
      FROM public.inventory_lots
     WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state;

    v_remaining := -v_delta;
    FOR v_lot IN SELECT id, qty FROM public.inventory_lots
        WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state
          AND location_id = p_location_id AND qty > 0
        ORDER BY received_at ASC, created_at ASC LOOP
      EXIT WHEN v_remaining <= 0;
      IF v_lot.qty <= v_remaining THEN
        v_remaining := v_remaining - v_lot.qty;
        DELETE FROM public.inventory_lots WHERE id = v_lot.id;
      ELSE
        UPDATE public.inventory_lots SET qty = qty - v_remaining, updated_at = now() WHERE id = v_lot.id;
        v_remaining := 0;
      END IF;
    END LOOP;

    INSERT INTO public.inventory_transactions
      (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change,
       quantity_before, quantity_after, stock_type, from_location_id, performed_by,
       performed_by_type, reason, idempotency_key, transaction_date, metadata)
    VALUES
      (v_restaurant, p_inventory_id, v_wine,
       p_transaction_type::inventory_transaction_type, p_source::inventory_transaction_source,
       v_delta, v_before, v_before + v_delta, p_stock_state, p_location_id, p_performed_by,
       CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
       p_reason, p_idempotency_key, now(), '{}'::jsonb)
    RETURNING id INTO v_txn;
    UPDATE public.stock_counts SET transaction_id = v_txn WHERE id = v_count.id;
  END IF;

  -- (6) last_counted_at, inside the same transaction.
  UPDATE public.restaurant_inventory
     SET last_counted_at = now()
   WHERE id = p_inventory_id;

  RETURN jsonb_build_object(
    'count_id',       v_count.id,
    'expected_qty',   v_expected,
    'counted_qty',    p_counted_qty,
    'variance_qty',   v_delta,
    'transaction_id', v_txn,
    'counted_at',     v_count.counted_at,
    'location_id',    p_location_id,
    'replayed',       false
  );
END;
$$;

COMMENT ON FUNCTION public.record_stock_count IS
  'Commits a physical count and records it unconditionally in stock_counts (ADR 0078, restoring D14). The stock movement is a downstream consequence of a non-zero difference; a count that AGREES still produces a row. p_location_id (F-291): NULL counts every shelf at once, as before; a storage location of the item''s own house counts that shelf only, so the expected figure and the correction touch only that shelf''s lots.';

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
   WHERE s.nspname = 'public' AND p.proname = 'record_stock_count';
  IF n <> 1 THEN
    RAISE EXCEPTION 'a_shelf_count_reconciles_that_shelf: % record_stock_count functions, expected exactly 1', n;
  END IF;
END;
$$;

COMMIT;
