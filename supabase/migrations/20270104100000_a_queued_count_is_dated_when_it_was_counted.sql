-- ===========================================================================
-- F-777 — a queued count is dated when it was counted, not when it arrived
-- ===========================================================================
--
-- WHAT WAS WRONG. F-249 made the gateway refuse a queued count (one a phone
-- took with no signal and sent later) when the item was counted again, or its
-- stock moved, after the count was taken. It compares against
-- stock_counts.counted_at and inventory_transactions.transaction_date, and
-- record_stock_count (a_count_is_a_record) stamped both with now(), the
-- moment the count ARRIVED. So two counts of one item taken offline at 14:00
-- (12) and 14:30 (10) and sent at 20:00, oldest first, went: the 14:00 count
-- is applied and dated 20:00, then the 14:30 count is refused as "counted
-- again after this count was taken". The stale 12 stood.
--
-- WHAT THIS MIGRATION DOES. One thing: an optional `p_counted_at`, and the
-- count row's counted_at and its movement's transaction_date (through
-- apply_stock_movement's p_occurred_at, ADR 0281's one shared date argument)
-- become LEAST(COALESCE(p_counted_at, now()), now()).
--
--   * NULL is now(), exactly as before, so a live count, the reconciliation
--     path and an old gateway write what they wrote yesterday.
--   * A future instant is clamped to now(), as ADR 0281 does for a sale.
--   * last_counted_at becomes GREATEST(last_counted_at, counted time), so an
--     older count arriving late cannot make the item look counted earlier.
--     It is documented as a cache of MAX(counted_at); this makes it one.
--   * created_at on both rows keeps DEFAULT now(): the time the row was
--     ENTERED is still recorded.
--
-- Nothing else in the body changes: it is a_count_is_a_record's body
-- verbatim apart from the parameter, v_at, and the three lines that use it.
-- The lock, the replay gate, the unconditional INSERT above the delta branch
-- (ADR 0078) and the expected quantity read under the lock are untouched.
--
-- WHY DROP AND CREATE, NOT AN OVERLOAD. As in a_pos_sale_is_dated_by_its_check:
-- PostgREST resolves by argument NAME, and two signatures that both accept a
-- call omitting p_counted_at make every such call ambiguous. No migration
-- GRANTs or REVOKEs record_stock_count (grep -rn over supabase/migrations/),
-- so the new function carries the same default EXECUTE as the old.
--
-- scripts/check_a_count_is_recorded.py arm B reads a_count_is_a_record only,
-- so the assertion block at the end re-checks, on the live body, that the
-- count is inserted before any branch on the difference.
--
-- NOT APPLIED BY HAND. The Supabase GitHub integration applies migrations on
-- merge, keyed by this filename.

BEGIN;

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
      'replayed',       true
    );
  END IF;

  -- (3) What the system believed, under the lock.
  SELECT COALESCE(SUM(qty), 0) INTO v_expected
    FROM public.inventory_lots
   WHERE inventory_id = p_inventory_id
     AND stock_state  = p_stock_state;

  v_delta := p_counted_qty - v_expected;

  -- (4) THE COUNT IS RECORDED HERE, UNCONDITIONALLY.
  -- This INSERT is above every branch on v_delta on purpose: it is the one line
  -- that makes an agreeing count representable. ON CONFLICT is belt-and-braces
  -- behind the lock in (1) — the lock already serialises same-item retries.
  INSERT INTO public.stock_counts (
      restaurant_id, inventory_id, stock_state,
      expected_qty, counted_qty, source, reason,
      counted_by, idempotency_key, counted_at
  ) VALUES (
      v_restaurant, p_inventory_id, p_stock_state,
      v_expected, p_counted_qty, p_source, p_reason,
      p_performed_by, p_idempotency_key, v_at
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
  IF v_delta <> 0 THEN
    v_txn := public.apply_stock_movement(
      p_inventory_id, p_stock_state, v_delta,
      p_transaction_type, p_source, p_performed_by, p_reason,
      NULL, NULL, NULL, p_idempotency_key,
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
    'replayed',       false
  );
END;
$$;

comment on function public.record_stock_count IS
  'Commits a physical count and records it unconditionally in stock_counts (ADR 0078, restoring D14). The stock movement is a downstream consequence of a non-zero difference; a count that AGREES still produces a row, which set_stock_absolute + inventory_transactions were structurally unable to represent. Use this instead of set_stock_absolute for any human count. p_counted_at (F-777) is when the count was taken: counted_at and the movement''s transaction_date are LEAST(COALESCE(p_counted_at, now()), now()).';

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
       AND p.pronargs = 9 AND p.pronargdefaults = 6
       AND p.proargnames[9] = 'p_counted_at'
       AND p.proargtypes[8] = 'timestamptz'::regtype
  ) THEN
    RAISE EXCEPTION 'record_stock_count should take 9 arguments, 6 defaulted, the 9th p_counted_at timestamptz';
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
