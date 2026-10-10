-- a_shelf_count_reconciles_that_shelf — a spot count of one shelf moves only
-- that shelf (F-291).
--
-- WHAT WAS WRONG
-- --------------
-- record_stock_count (a_queued_count_is_dated_when_it_was_counted, the
-- 9-argument form ending in p_counted_at) takes no location. It compares the
-- number counted with the lot sum across EVERY location and hands the
-- difference to apply_stock_movement with a NULL location. A negative
-- difference then drains the oldest lots wherever they sit
-- (a_returned_bottle_keeps_its_cost, the take-off loop), and a positive one
-- makes a lot wherever the wine last left from.
--
-- So with 8 bottles in the Cellar and 3 in the Bar, the cellar counter enters
-- 8 and the books lose 3 bottles from whichever lots are oldest, perhaps the
-- cellar's own. Two counters on two shelves overwrite each other.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- record_stock_count gains p_location_id uuid DEFAULT NULL, and keeps
-- p_counted_at (F-777) as its LAST argument, where
-- 20270104100000_a_queued_count_is_dated_when_it_was_counted_test.sql T1
-- expects it. Callers name their arguments (PostgREST resolves by name; no
-- SQL calls it positionally), so the order changes nothing for them.
--
--   * NULL: nothing changes. Expected is the lot sum everywhere and the
--     movement goes through apply_stock_movement exactly as before.
--   * A location: it must be one of the item's own house's storage_locations
--     (refused otherwise, before anything is read back). Expected is the lot
--     sum IN THAT LOCATION only, and the difference goes to
--     apply_stock_movement with that location. A positive difference becomes
--     a lot there. A negative one is taken from that location first
--     (a_returned_bottle_keeps_its_cost, F-646 b), and the shelf holds at
--     least that many, so nothing comes off another shelf. The take-off keeps
--     its metadata.lots_taken, so a bottle that later comes back still
--     carries its cost (F-644), and its date is the count's (F-777).
--
-- An earlier draft of this fix (fix/sim-count-location, version
-- 20261230100000) took the bottles off with its own loop. That predates
-- apply_stock_movement's place-first take-off and would have dropped
-- lots_taken and the counted date, so it is not kept.
--
-- stock_counts gains location_id: which shelf a count was of, NULL for a count
-- of every shelf. expected_qty is then that shelf's figure.
--
-- ORDER OF OPERATIONS (ADR 0078) is unchanged: lock, replay gate, read
-- expected, INSERT the count unconditionally, then move stock only on a
-- non-zero difference, then stamp last_counted_at.
--
-- WHY DROP AND CREATE, NOT AN OVERLOAD. A second overload with a defaulted
-- argument would make every named-argument call that omits it ambiguous. Its
-- only callers are the gateway's two named-argument RPCs (inventory.service.ts
-- recordSpotCount, inventory-ledger.service.ts reconcileInventory). No
-- migration GRANTs or REVOKEs it, so the new one carries the same default
-- EXECUTE. The block at the end asserts exactly one survives.
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
    uuid, integer, text, text, text, text, uuid, text, timestamptz
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
    p_counted_at       timestamptz default null
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

  -- (5) The movement is a CONSEQUENCE of disagreement, not the evidence of the
  -- count. apply_stock_movement re-locks the same restaurant_inventory row in
  -- this same transaction — safe, Postgres row locks are reentrant within one
  -- xact, which is the property set_stock_absolute already relies on.
  -- With a shelf, a new lot lands there and a take-off comes off it first; the
  -- shelf held v_expected >= -v_delta, so no other shelf is touched (F-291).
  IF v_delta <> 0 THEN
    v_txn := public.apply_stock_movement(
      p_inventory_id, p_stock_state, v_delta,
      p_transaction_type, p_source, p_performed_by, p_reason,
      NULL, p_location_id, NULL, p_idempotency_key,
      p_occurred_at => v_at
    );
    UPDATE public.stock_counts SET transaction_id = v_txn WHERE id = v_count.id;
  END IF;

  -- (6) last_counted_at stays, and is now stamped inside the same transaction as
  -- the count row rather than in a separate round trip whose failure only warned.
  -- It is no longer EVIDENCE that a count happened — stock_counts is that — it is
  -- a denormalised cache of MAX(counted_at) so the inventory list can render a
  -- freshness badge without a correlated subquery per item.
  UPDATE public.restaurant_inventory
     SET last_counted_at = GREATEST(last_counted_at, v_at)
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

comment on function public.record_stock_count IS
  'Commits a physical count and records it unconditionally in stock_counts (ADR 0078, restoring D14). The stock movement is a downstream consequence of a non-zero difference; a count that AGREES still produces a row, which set_stock_absolute + inventory_transactions were structurally unable to represent. Use this instead of set_stock_absolute for any human count. p_counted_at (F-777) is when the count was taken: counted_at and the movement''s transaction_date are LEAST(COALESCE(p_counted_at, now()), now()). p_location_id (F-291): NULL counts every shelf at once, as before; a storage location of the item''s own house counts that shelf only, so the expected figure and the correction touch only that shelf''s lots.';

DO $$
DECLARE
  v_count int;
  v_src   text;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_stock_count';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one public.record_stock_count after this migration, found %. Two overloads make PostgREST ambiguous.', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'record_stock_count'
       AND p.pronargs = 10 AND p.pronargdefaults = 7
       AND p.proargnames[9] = 'p_location_id'
       AND p.proargtypes[8] = 'uuid'::regtype
       AND p.proargnames[10] = 'p_counted_at'
       AND p.proargtypes[9] = 'timestamptz'::regtype
  ) THEN
    RAISE EXCEPTION 'record_stock_count should take 10 arguments, 7 defaulted, the 9th p_location_id uuid and the 10th p_counted_at timestamptz';
  END IF;

  SELECT p.prosrc INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_stock_count';
  IF position('LEAST(COALESCE(p_counted_at, now()), now())' in v_src) = 0
     OR position('p_occurred_at => v_at' in v_src) = 0 THEN
    RAISE EXCEPTION 'record_stock_count does not date its count and movement by p_counted_at';
  END IF;
  -- ADR 0078: the count is recorded before any branch on the difference.
  IF position('INSERT INTO public.stock_counts' in v_src) = 0
     OR position('IF v_delta <> 0 THEN' in v_src) = 0
     OR position('INSERT INTO public.stock_counts' in v_src)
        > position('IF v_delta <> 0 THEN' in v_src) THEN
    RAISE EXCEPTION 'record_stock_count must insert the count before it branches on the difference (ADR 0078)';
  END IF;
END;
$$;

COMMIT;
