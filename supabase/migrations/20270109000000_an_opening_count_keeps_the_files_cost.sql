-- ===========================================================================
-- An opening count keeps the cost per bottle its file states
-- (sim finding F-1524; sim 50, 2026-10-12)
-- ===========================================================================
--
-- WHAT WAS WRONG (re-read over the integration tip 5cedb1079).
--
-- A house that sets up its menu first already carries every wine on it, each
-- as a restaurant_inventory row with no lots and no cost. Its opening-stock
-- file (wine, quantity, cost per bottle) is then read as a COUNT of wines it
-- already carries (ADR 0335 §2, F-1457), and record_stock_count
-- (20270105000000 :343) takes no cost: it calls apply_stock_movement with a
-- NULL p_unit_cost (:458-463), and an 'initial' movement never carries a cost
-- from anywhere (20270105000000 :195-196). So the whole opening cellar landed
-- uncosted, inventory_lot_rollup.wac stayed NULL, and every cost and margin
-- figure for those wines was withheld. The page said only that the cost "is
-- not applied".
--
-- WHAT THIS MIGRATION DOES. record_stock_count gains p_unit_cost and
-- p_cost_provenance (both default NULL, so every existing call is unchanged).
-- With a cost named:
--   * only an opening count ('initial') may carry one; any other count is
--     refused, because a count of a wine on the shelf is not a price;
--   * the cost is applied ONLY when the wine has no live costed lot -- the
--     same lots inventory_lot_rollup.wac averages (live, bottles or an open
--     bottle left, a cost, not a sample). A wine that has a real cost keeps it;
--     nothing costed is ever overwritten, and the result says
--     cost_applied = false;
--   * when it is applied, the bottles the count adds are booked at it, and any
--     live lot of this wine with NO cost yet (and no delivery waiting to be
--     verified, which settles its own price) takes it too, each with an
--     inventory_lot_revaluations row holding the prior value (NULL), as every
--     cost change does (ADR 0078). Provenance is the caller's, normally
--     'manual' (a person typed it in a file); cost_state follows
--     apply_stock_movement's rule ('final' for invoice/manual).
-- The rest of the body is 20270105000000's verbatim: lock, replay gate, read
-- expected, INSERT the count unconditionally, move stock only on a non-zero
-- difference, stamp last_counted_at only for a count of every shelf.
--
-- WHY DROP AND CREATE, NOT AN OVERLOAD. As 20270104300000: a second overload
-- with defaulted arguments makes every named-argument call that omits them
-- ambiguous. Callers are the gateway's two named-argument RPCs
-- (inventory.service.ts recordSpotCount, inventory-ledger.service.ts
-- reconcileInventory). No migration GRANTs or REVOKEs it, so the new one
-- carries the same default EXECUTE. The block at the end asserts exactly one.
--
-- Proof (PGlite, full corpus; fails without this migration):
--   supabase/tests/20270109000000_an_opening_count_keeps_the_files_cost_test.sql
--
-- NOT APPLIED BY HAND. The Supabase GitHub integration applies migrations on
-- merge, keyed by this filename.

BEGIN;

DROP FUNCTION IF EXISTS public.record_stock_count(
    uuid, integer, text, text, text, text, uuid, text, uuid, timestamptz
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
    p_location_id      uuid    default null,
    p_counted_at       timestamptz default null,
    p_unit_cost        numeric default null,
    p_cost_provenance  text    default null
) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_restaurant uuid;
  v_expected   int;
  v_delta      int;
  v_txn        uuid;
  v_count      public.stock_counts%rowtype;
  -- When the count was TAKEN (F-777). A phone with no signal sends its count
  -- hours later; dating it at arrival made the newer of two queued counts
  -- look older than the one before it. Never later than now().
  v_at         timestamptz := LEAST(COALESCE(p_counted_at, now()), now());
  -- F-1524: the opening file's cost, once it is known to be applied.
  v_cost       numeric;
  v_cost_prov  text;
  v_applied    boolean;
  v_lot        record;
BEGIN
  IF p_stock_state NOT IN ('live','shadow') THEN
    RAISE EXCEPTION 'invalid stock_state %', p_stock_state;
  END IF;
  IF p_counted_qty IS NULL OR p_counted_qty < 0 THEN
    RAISE EXCEPTION 'counted_qty must be a non-negative integer, got %', p_counted_qty;
  END IF;
  -- Refused rather than defaulted. A generated fallback key would make every
  -- retry a second count and quietly turn the agreement rate into a measure of
  -- mobile signal quality.
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'p_idempotency_key is required: a count that cannot be de-duplicated cannot be a record';
  END IF;
  -- F-1524: a cost goes only with an opening count, and says what kind it is.
  IF p_unit_cost IS NOT NULL THEN
    IF p_transaction_type <> 'initial' THEN
      RAISE EXCEPTION 'record_stock_count: a cost per bottle goes only with an opening count, so nothing was counted.'
        USING ERRCODE = '22023';
    END IF;
    IF p_unit_cost < 0 THEN
      RAISE EXCEPTION 'record_stock_count: a cost per bottle cannot be below zero (got %), so nothing was counted.', p_unit_cost
        USING ERRCODE = '22023';
    END IF;
    IF p_cost_provenance IS NULL OR p_cost_provenance NOT IN ('invoice','estimated','manual') THEN
      RAISE EXCEPTION 'record_stock_count: a cost per bottle must say what kind of price it is (invoice, estimated or manual; got %), so nothing was counted.', p_cost_provenance
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- (1) Lock FIRST. Every count of this item serialises here, which is what
  -- makes the check-then-insert in (2) safe as well as the read in (3) honest.
  SELECT restaurant_id INTO v_restaurant
    FROM public.restaurant_inventory
   WHERE id = p_inventory_id
     FOR UPDATE;
  IF v_restaurant IS NULL THEN
    RAISE EXCEPTION 'inventory % not found', p_inventory_id;
  END IF;

  -- A shelf must be this house's own (F-291), checked before the replay gate
  -- so a foreign location id learns nothing about an earlier count.
  IF p_location_id IS NOT NULL THEN
    PERFORM 1 FROM public.storage_locations
      WHERE id = p_location_id AND restaurant_id = v_restaurant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That place is not one of this house''s storage locations, so nothing was counted.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- (2) Replay gate. ONE gate for the count and the movement, because they share
  -- a key: a replay returns the original count and never reaches
  -- apply_stock_movement, so the two can never disagree about what a retry is.
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
  -- shelf that was counted (F-291).
  SELECT COALESCE(SUM(qty), 0) INTO v_expected
    FROM public.inventory_lots
   WHERE inventory_id = p_inventory_id
     AND stock_state  = p_stock_state
     AND (p_location_id IS NULL OR location_id = p_location_id);

  v_delta := p_counted_qty - v_expected;

  -- (4) THE COUNT IS RECORDED HERE, UNCONDITIONALLY.
  -- This INSERT is above every branch on v_delta on purpose: it is the one line
  -- that makes an agreeing count representable. ON CONFLICT is belt-and-braces
  -- behind the lock in (1) — the lock already serialises same-item retries.
  INSERT INTO public.stock_counts (
      restaurant_id, inventory_id, stock_state,
      expected_qty, counted_qty, source, reason,
      counted_by, idempotency_key, counted_at, location_id
  ) VALUES (
      v_restaurant, p_inventory_id, p_stock_state,
      v_expected, p_counted_qty, p_source, p_reason,
      p_performed_by, p_idempotency_key, v_at, p_location_id
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO v_count;

  IF v_count.id IS NULL THEN
    SELECT * INTO v_count FROM public.stock_counts
     WHERE idempotency_key = p_idempotency_key;
  END IF;

  -- (4b) F-1524: the opening file's cost per bottle. Applied only to a wine
  -- with no live costed lot -- the lots inventory_lot_rollup.wac averages --
  -- so a real cost is never overwritten. Every shelf of the wine, because a
  -- cost per bottle is the wine's, not the counted shelf's. A lot waiting on
  -- a delivery is left to finalise_delivery_cost, which settles its price.
  IF p_unit_cost IS NOT NULL THEN
    v_applied := NOT EXISTS (
      SELECT 1 FROM public.inventory_lots
       WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state
         AND (qty > 0 OR open_bottle_ml > 0)
         AND unit_cost IS NOT NULL AND cost_provenance <> 'sample'
    );
    IF v_applied THEN
      v_cost := p_unit_cost;
      v_cost_prov := p_cost_provenance;
      FOR v_lot IN
        SELECT id, qty, cost_provenance, source_order_id FROM public.inventory_lots
         WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state
           AND (qty > 0 OR open_bottle_ml > 0)
           AND unit_cost IS NULL AND delivery_id IS NULL
         FOR UPDATE
      LOOP
        INSERT INTO public.inventory_lot_revaluations
          (restaurant_id, inventory_id, lot_id, source_order_id, qty_at_revaluation,
           prior_unit_cost, prior_cost_provenance, new_unit_cost, new_cost_provenance,
           performed_by, reason)
        VALUES
          (v_restaurant, p_inventory_id, v_lot.id, v_lot.source_order_id, v_lot.qty,
           NULL, v_lot.cost_provenance, v_cost, v_cost_prov,
           p_performed_by, COALESCE(p_reason, 'Opening stock') || ' (the file''s cost per bottle, F-1524)');
        UPDATE public.inventory_lots
           SET unit_cost       = v_cost,
               cost_provenance = v_cost_prov,
               cost_state      = CASE WHEN v_cost_prov IN ('invoice','manual') THEN 'final' ELSE 'provisional' END,
               updated_at      = now()
         WHERE id = v_lot.id;
      END LOOP;
    END IF;
  END IF;

  -- (5) The movement is a CONSEQUENCE of disagreement, not the evidence of the
  -- count. apply_stock_movement re-locks the same restaurant_inventory row in
  -- this same transaction — safe, Postgres row locks are reentrant within one
  -- xact, which is the property set_stock_absolute already relies on.
  -- With a shelf, a new lot lands there and a take-off comes off it first; the
  -- shelf held v_expected >= -v_delta, so no other shelf is touched (F-291).
  -- F-1524: bottles a count adds carry the opening file's cost when (4b)
  -- applied it; otherwise none, as before.
  IF v_delta <> 0 THEN
    v_txn := public.apply_stock_movement(
      p_inventory_id, p_stock_state, v_delta,
      p_transaction_type, p_source, p_performed_by, p_reason,
      CASE WHEN v_delta > 0 THEN v_cost END, p_location_id, NULL, p_idempotency_key,
      p_cost_provenance => CASE WHEN v_delta > 0 THEN v_cost_prov END,
      p_occurred_at => v_at
    );
    UPDATE public.stock_counts SET transaction_id = v_txn WHERE id = v_count.id;
  END IF;

  -- (6) last_counted_at stays, and is now stamped inside the same transaction as
  -- the count row rather than in a separate round trip whose failure only warned.
  -- It is no longer EVIDENCE that a count happened — stock_counts is that — it is
  -- a denormalised cache of MAX(counted_at) so the inventory list can render a
  -- freshness badge without a correlated subquery per item.
  -- F-1165: only a count of EVERY shelf says the whole wine was counted. A
  -- count of one shelf is that shelf's, and stock_counts.location_id keeps it;
  -- stamping the wine made a Bar count read as "the cellar counted today".
  IF p_location_id IS NULL THEN
    UPDATE public.restaurant_inventory
       SET last_counted_at = GREATEST(last_counted_at, v_at)
     WHERE id = p_inventory_id;
  END IF;

  RETURN jsonb_build_object(
    'count_id',       v_count.id,
    'expected_qty',   v_expected,
    'counted_qty',    p_counted_qty,
    'variance_qty',   v_delta,
    'transaction_id', v_txn,
    'counted_at',     v_count.counted_at,
    'location_id',    p_location_id,
    'replayed',       false,
    -- F-1524: NULL when no cost was named; false when the wine already had one.
    'cost_applied',   v_applied
  );
END;
$$;

comment on function public.record_stock_count IS
  'Commits a physical count and records it unconditionally in stock_counts (ADR 0078, restoring D14). The stock movement is a downstream consequence of a non-zero difference; a count that AGREES still produces a row, which set_stock_absolute + inventory_transactions were structurally unable to represent. Use this instead of set_stock_absolute for any human count. p_counted_at (F-777) is when the count was taken: counted_at and the movement''s transaction_date are LEAST(COALESCE(p_counted_at, now()), now()). p_location_id (F-291): NULL counts every shelf at once, as before; a storage location of the item''s own house counts that shelf only, so the expected figure and the correction touch only that shelf''s lots. F-1165: last_counted_at is stamped only by a count of every shelf (p_location_id NULL); a count of one shelf is dated on its stock_counts row alone. F-1524: p_unit_cost + p_cost_provenance, accepted only on an opening count (''initial''), cost the wine ONLY when it has no live costed lot: the bottles the count adds are booked at it and its uncosted live lots (none waiting on a delivery) take it, each logged in inventory_lot_revaluations. A costed wine is never overwritten; the result''s cost_applied says which happened.';

-- ---------------------------------------------------------------------------
-- In-file assertions (structural only; pg_proc, never a live table).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_src text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'record_stock_count') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one public.record_stock_count after this migration';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_stock_count';
  IF position('IF p_location_id IS NULL THEN' in v_src) = 0
     OR position('INSERT INTO public.stock_counts' in v_src)
        > position('IF v_delta <> 0 THEN' in v_src)
     OR position('unit_cost IS NOT NULL AND cost_provenance <> ''sample''' in v_src) = 0 THEN
    RAISE EXCEPTION 'record_stock_count must keep F-1165, insert the count before it branches (ADR 0078), and apply a cost only to a wine with no live costed lot (F-1524)';
  END IF;
END;
$$;

COMMIT;
