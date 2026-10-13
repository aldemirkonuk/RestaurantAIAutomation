-- a_whole_walk_stamps_last_counted -- a stock-take is reviewed and signed off.
-- F-1544 lane 4 of the phone stock count decision
-- (p4-scratch/sim-run/arch/decision-phone-stock-count.md; the ADR number comes
-- from the ADR lane).
--
-- THE FOUNDER'S PICKS, 2026-10-12 (sim ledger S224) this file carries:
--   F2 (a) no approval: each shelf line posts through record_stock_count on
--          sync as the person who counted it; the manager signs off
--          completeness; only a duplicate on the same shelf is held.
--   F3 (a) open bottles in tenths on screen, integer ml in the one writer.
--   (F1 (b) the session's period is lane 5's; F4 (a) the web page is the
--   gateway's caller.)
--
-- WHAT LANE 2 LEFT OWED HERE. A held line (a second count of a shelf in one
-- walk) could be kept but never resolved, and a shelf could not be counted
-- again inside the walk: every recount line would have been held too.
--
-- WHAT THIS FILE DOES.
--
--   1. stock_count_session_shelves gains recount_round / recount_asked_at /
--      recount_asked_by: a manager sends a shelf to be counted again.
--   2. stock_counts gains arrived_at (DEFAULT now() for new rows only; NULL on
--      every row before this file, "not recorded", never back-filled with the
--      migration's own time). counted_at is when it was counted (F-777);
--      arrived_at is when it reached the house, so review can list the lines
--      that arrived after sign-off (ADR 0241) -- an offline line counted
--      before sign-off and synced after is exactly that line.
--   3. record_stock_count (still ADR 0078's ONE writer; DROP + CREATE, no
--      overload) gains p_resolves_held_line and p_resolved_by, both DEFAULT
--      NULL:
--        * the held line a manager chooses posts through the writer as ITS
--          COUNTER (p_performed_by is the held line's counted_by, never the
--          manager's: ADR 0078 attribution), at its counted moment, under its
--          own key, bypassing the hold; the line becomes 'posted' with the
--          count it became, and the other held lines of that shelf in the walk
--          become 'dropped' -- all inside the item lock;
--        * the hold is pass-aware: after a recount is asked, a line holds only
--          against a count of the same pass (both before the ask, or both at
--          or after it), so the recount posts and a stale old-pass line is
--          still held.
--      With neither named, the result has exactly the keys it had.
--   4. public.ask_stock_count_shelf_recount -- reopens one shelf of an open
--      walk (done and claim cleared, round + 1) and sets aside its held lines,
--      in one transaction. A replay of the same ask (same round seen) is a
--      no-op.
--   5. public.sign_off_stock_count_session -- the manager says the walk is
--      complete. Refused (answered, not raised) while shelves are not counted
--      unless the manager says so; then, in the same transaction, every item
--      whose every holding shelf was counted in this walk, on a shelf marked
--      done, gets last_counted_at stamped (F-1165 closed for a full walk) with
--      the OLDEST of its shelves' latest counts -- the honest age of the whole
--      count. Sign-off gates no posting (F2 a): lines that sync after it still
--      land, and review lists them.
--
-- WHY THE STAMP IS NOT IN record_stock_count. A line is one shelf; only the
-- whole walk knows the item's every shelf was counted. The stamp is the
-- denormalised MAX(counted_at) cache the writer already keeps for a count of
-- every shelf (20270109000000 (6)); it writes no count and moves no stock, so
-- the writer stays the one count writer. Rejected: stamping per shelf line
-- (the F-1165 lie: a Bar count reading as "the cellar was counted today").
--
-- WHY A MISPLACED BOTTLE IS NOT A TRANSFER HERE. [Correction to the draft's
-- Decision 8.] Under F2 (a) both shelf counts have already moved stock when
-- review sees them -- shelf A down N, shelf B up N -- so a transfer posted
-- then would move the bottles a second time. Review names the pair as
-- "probably moved, not lost"; no writer is added for it. Rejected: posting a
-- transfer (double move), reversing both counts (a second count semantics).
--
-- LOCKED DOWN: no new table. The two new functions are SECURITY INVOKER,
-- called by the gateway's service role, and EXECUTE is revoked from PUBLIC,
-- anon and authenticated in this file (OD-72 / OD-73).
--
-- Proof (PGlite, full corpus; fails without this migration):
--   supabase/tests/20270113200000_a_whole_walk_stamps_last_counted_test.sql
--
-- NOT APPLIED BY HAND. The Supabase GitHub integration applies migrations on
-- merge, keyed by this filename.

BEGIN;

SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. A shelf can be sent to be counted again.
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_count_session_shelves
  ADD COLUMN IF NOT EXISTS recount_round    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recount_asked_at timestamptz,
  ADD COLUMN IF NOT EXISTS recount_asked_by uuid REFERENCES public.users(user_id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'stock_count_session_shelves_recount_has_a_time'
       AND conrelid = to_regclass('public.stock_count_session_shelves')
  ) THEN
    ALTER TABLE public.stock_count_session_shelves
      ADD CONSTRAINT stock_count_session_shelves_recount_has_a_time
      CHECK (recount_round >= 0 AND (recount_round = 0) = (recount_asked_at IS NULL));
  END IF;
END
$$;

COMMENT ON COLUMN public.stock_count_session_shelves.recount_asked_at IS
  'When a manager last sent this shelf to be counted again (F-1544 lane 4). A line of this walk holds only against a count of the same pass: both counted before this moment, or both at or after it. NULL: never sent back.';
COMMENT ON COLUMN public.stock_count_session_shelves.recount_round IS
  'How many times this shelf was sent to be counted again. A phone forgets its own earlier pass of the shelf when the round it holds is behind.';

-- ---------------------------------------------------------------------------
-- 2. A count says when it reached the house.
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_counts ADD COLUMN IF NOT EXISTS arrived_at timestamptz;
-- Set apart from ADD COLUMN on purpose: a DEFAULT on the ADD would fill every
-- existing row with this migration's own moment, a time no count arrived at.
ALTER TABLE public.stock_counts ALTER COLUMN arrived_at SET DEFAULT now();

COMMENT ON COLUMN public.stock_counts.arrived_at IS
  'When the count reached the house (server time). counted_at is when it was counted (F-777). NULL on every count before 20270113200000: not recorded, never back-filled.';

COMMENT ON TABLE public.stock_count_held_lines IS
  'A second count of the same item on the same shelf in the same stock-take (F2 a, founder 2026-10-12 S224): kept with its counter and moment, never posted, so the manager picks one in review. Inserted only by record_stock_count, under the item lock; a chosen line is posted by record_stock_count (p_resolves_held_line), a line set aside is marked dropped by the gateway or by a recount of its shelf. Never deleted. Gateway-only: every statement is scoped to the house on the token.';

-- ---------------------------------------------------------------------------
-- 3. The one count writer, able to post a held line and to count a shelf again.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_stock_count(
    uuid, integer, text, text, text, text, uuid, text, uuid, timestamptz, numeric, text,
    integer, uuid
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
    p_cost_provenance  text    default null,
    p_counted_open_ml  integer default null,
    p_session_id       uuid    default null,
    p_resolves_held_line uuid  default null,
    p_resolved_by      uuid    default null
) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_restaurant uuid;
  v_wine       uuid;
  v_expected   int;
  v_delta      int;
  v_txn        uuid;
  v_count      public.stock_counts%rowtype;
  -- When the count was TAKEN (F-777). Never later than now().
  v_at         timestamptz := LEAST(COALESCE(p_counted_at, now()), now());
  -- F-1524: the opening file's cost, once it is known to be applied.
  v_cost       numeric;
  v_cost_prov  text;
  v_applied    boolean;
  v_lot        record;
  -- F-1544 lane 2: the open bottles and the walk.
  v_expected_open int;
  v_open_change   int;
  v_open_left     int;
  v_open_take     int;
  v_open_lot      uuid;
  v_held          public.stock_count_held_lines%rowtype;
  v_against       uuid;
  v_out           jsonb;
  -- F-1544 lane 4: a shelf sent to be counted again, and a held line a
  -- manager chose.
  v_recount       timestamptz;
  v_resolving     public.stock_count_held_lines%rowtype;
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
  -- F-1544 lane 2: what is left in the open bottles is never below nothing.
  IF p_counted_open_ml IS NOT NULL AND p_counted_open_ml < 0 THEN
    RAISE EXCEPTION 'record_stock_count: what is left in the open bottles cannot be below nothing (got % ml), so nothing was counted.', p_counted_open_ml
      USING ERRCODE = '22023';
  END IF;

  -- F-1544 lane 4: a held line is chosen inside its own stock-take only.
  IF p_resolves_held_line IS NOT NULL AND p_session_id IS NULL THEN
    RAISE EXCEPTION 'record_stock_count: a held count is used only inside its stock-take, so nothing was counted.'
      USING ERRCODE = '22023';
  END IF;

  -- (1) Lock FIRST. Every count of this item serialises here, which is what
  -- makes the check-then-insert in (2) safe as well as the read in (3) honest.
  SELECT restaurant_id, master_wine_id INTO v_restaurant, v_wine
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
  -- So must a stock-take (F-1544), for the same reason and in the same place.
  IF p_session_id IS NOT NULL THEN
    PERFORM 1 FROM public.stock_count_sessions
      WHERE id = p_session_id AND restaurant_id = v_restaurant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That stock-take is not one of this house''s, so nothing was counted.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  -- F-1544 lane 4: the held line a manager chose must be THIS line -- same
  -- walk, item, book, shelf and key -- and must not have been set aside.
  -- Locked, so a "set aside" and a "use this" cannot both win.
  IF p_resolves_held_line IS NOT NULL THEN
    SELECT * INTO v_resolving FROM public.stock_count_held_lines
     WHERE id              = p_resolves_held_line
       AND restaurant_id   = v_restaurant
       AND session_id      = p_session_id
       AND inventory_id    = p_inventory_id
       AND stock_state     = p_stock_state
       AND location_id IS NOT DISTINCT FROM p_location_id
       AND idempotency_key = p_idempotency_key
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That held count is not this line of this stock-take, so nothing was counted.'
        USING ERRCODE = '42501';
    END IF;
    IF v_resolving.state = 'dropped' THEN
      RAISE EXCEPTION 'That held count was set aside, so it was not used.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- (2) Replay gate. ONE gate for the count and the movement, because they share
  -- a key: a replay returns the original count and never reaches
  -- apply_stock_movement, so the two can never disagree about what a retry is.
  SELECT * INTO v_count FROM public.stock_counts
   WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    v_out := jsonb_build_object(
      'count_id',       v_count.id,
      'expected_qty',   v_count.expected_qty,
      'counted_qty',    v_count.counted_qty,
      'variance_qty',   v_count.variance_qty,
      'transaction_id', v_count.transaction_id,
      'counted_at',     v_count.counted_at,
      'location_id',    v_count.location_id,
      'replayed',       true
    );
    IF p_session_id IS NOT NULL OR p_counted_open_ml IS NOT NULL THEN
      v_out := v_out || jsonb_build_object(
        'expected_open_ml', v_count.expected_open_ml,
        'counted_open_ml',  v_count.counted_open_ml,
        'variance_open_ml', v_count.variance_open_ml,
        'session_id',       v_count.session_id,
        'held',             false
      );
      IF p_resolves_held_line IS NOT NULL THEN
        v_out := v_out || jsonb_build_object('resolved_held_line', p_resolves_held_line);
      END IF;
    END IF;
    RETURN v_out;
  END IF;

  -- (2b) F2 (a): the one held line. A line of a walk whose (item, shelf, book)
  -- this walk has already counted is kept and not posted; the manager picks
  -- one in review. A retry of a held line replays as held. Under the lock in
  -- (1), so two phones syncing the same shelf at once cannot both post.
  --
  -- F-1544 lane 4: skipped for the held line a manager chose (that is the
  -- point of choosing it). And a shelf sent to be counted again starts a new
  -- pass at recount_asked_at: a line holds only against a count of the SAME
  -- pass -- both counted before the ask, or both at or after it -- so the
  -- recount posts, and an old line that syncs late is still held.
  IF p_session_id IS NOT NULL AND p_resolves_held_line IS NULL THEN
    SELECT * INTO v_held FROM public.stock_count_held_lines
     WHERE idempotency_key = p_idempotency_key;
    IF NOT FOUND THEN
      v_recount := NULL;
      IF p_location_id IS NOT NULL THEN
        SELECT recount_asked_at INTO v_recount FROM public.stock_count_session_shelves
         WHERE session_id = p_session_id AND location_id = p_location_id;
      END IF;
      SELECT id INTO v_against FROM public.stock_counts
       WHERE session_id   = p_session_id
         AND inventory_id = p_inventory_id
         AND stock_state  = p_stock_state
         AND location_id IS NOT DISTINCT FROM p_location_id
         AND (v_recount IS NULL OR (counted_at >= v_recount) = (v_at >= v_recount))
       ORDER BY counted_at ASC, id ASC
       LIMIT 1;
      IF v_against IS NOT NULL THEN
        INSERT INTO public.stock_count_held_lines (
            session_id, restaurant_id, inventory_id, location_id, stock_state,
            counted_qty, counted_open_ml, counted_by, counted_at, reason,
            idempotency_key, held_against
        ) VALUES (
            p_session_id, v_restaurant, p_inventory_id, p_location_id, p_stock_state,
            p_counted_qty, p_counted_open_ml, p_performed_by, v_at, p_reason,
            p_idempotency_key, v_against
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING * INTO v_held;
        IF v_held.id IS NULL THEN
          SELECT * INTO v_held FROM public.stock_count_held_lines
           WHERE idempotency_key = p_idempotency_key;
        END IF;
        RETURN jsonb_build_object(
          'count_id',        NULL,
          'held',            true,
          'held_line_id',    v_held.id,
          'held_against',    v_held.held_against,
          'counted_qty',     v_held.counted_qty,
          'counted_open_ml', v_held.counted_open_ml,
          'counted_at',      v_held.counted_at,
          'location_id',     v_held.location_id,
          'session_id',      v_held.session_id,
          'replayed',        false
        );
      END IF;
    ELSE
      RETURN jsonb_build_object(
        'count_id',        NULL,
        'held',            true,
        'held_line_id',    v_held.id,
        'held_against',    v_held.held_against,
        'counted_qty',     v_held.counted_qty,
        'counted_open_ml', v_held.counted_open_ml,
        'counted_at',      v_held.counted_at,
        'location_id',     v_held.location_id,
        'session_id',      v_held.session_id,
        'replayed',        true
      );
    END IF;
  END IF;

  -- (3) What the system believed, under the lock: every shelf, or the one
  -- shelf that was counted (F-291) -- bottles, and what the open ones hold.
  SELECT COALESCE(SUM(qty), 0), COALESCE(SUM(open_bottle_ml), 0)
    INTO v_expected, v_expected_open
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
      counted_by, idempotency_key, counted_at, location_id,
      expected_open_ml, counted_open_ml, session_id
  ) VALUES (
      v_restaurant, p_inventory_id, p_stock_state,
      v_expected, p_counted_qty, p_source, p_reason,
      p_performed_by, p_idempotency_key, v_at, p_location_id,
      CASE WHEN p_counted_open_ml IS NOT NULL THEN v_expected_open END,
      p_counted_open_ml, p_session_id
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO v_count;

  IF v_count.id IS NULL THEN
    SELECT * INTO v_count FROM public.stock_counts
     WHERE idempotency_key = p_idempotency_key;
  END IF;

  -- (4a) F-1544 lane 4: the held line a manager chose is now this count, and
  -- the other held lines of the same shelf in this walk were not chosen.
  -- Both stay as records (state, who, when); nothing is deleted.
  IF p_resolves_held_line IS NOT NULL THEN
    UPDATE public.stock_count_held_lines
       SET state = 'posted', resolved_by = p_resolved_by, resolved_at = now(),
           resolved_count_id = v_count.id
     WHERE id = p_resolves_held_line AND state = 'held';
    UPDATE public.stock_count_held_lines
       SET state = 'dropped', resolved_by = p_resolved_by, resolved_at = now()
     WHERE session_id   = p_session_id
       AND inventory_id = p_inventory_id
       AND stock_state  = p_stock_state
       AND location_id IS NOT DISTINCT FROM p_location_id
       AND state = 'held'
       AND id <> p_resolves_held_line;
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

  -- (5b) F-1544 lane 2 (F3 a): the open bottles are set to what was counted,
  -- in the counted scope. Only when a figure was named; a count that names
  -- none leaves them exactly as they were. apply_stock_movement in (5) never
  -- changes open ml (F-1160 keeps a lot that holds some), so the figure read
  -- in (3) is still the books' figure here.
  v_open_change := p_counted_open_ml - v_expected_open;
  IF p_counted_open_ml IS NOT NULL AND v_open_change < 0 THEN
    -- Less than the books: off the open bottles, oldest first -- the order
    -- record_glass_pour drinks them in.
    v_open_left := -v_open_change;
    FOR v_lot IN
      SELECT id, open_bottle_ml FROM public.inventory_lots
       WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state
         AND (p_location_id IS NULL OR location_id = p_location_id)
         AND open_bottle_ml > 0
       ORDER BY received_at ASC, created_at ASC, id ASC
       FOR UPDATE
    LOOP
      EXIT WHEN v_open_left = 0;
      v_open_take := LEAST(v_lot.open_bottle_ml, v_open_left);
      UPDATE public.inventory_lots
         SET open_bottle_ml = open_bottle_ml - v_open_take, updated_at = now()
       WHERE id = v_lot.id;
      v_open_left := v_open_left - v_open_take;
      -- F-428: a lot with no bottle and no open ml left goes.
      DELETE FROM public.inventory_lots
       WHERE id = v_lot.id AND qty = 0 AND open_bottle_ml = 0;
    END LOOP;
  ELSIF p_counted_open_ml IS NOT NULL AND v_open_change > 0 THEN
    -- More than the books: onto the open bottle already there, else the
    -- shelf's newest lot, else a lot of 0 bottles on the counted shelf. That
    -- lot is uncosted: an open bottle nobody booked has no price to carry.
    SELECT id INTO v_open_lot FROM public.inventory_lots
     WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state
       AND (p_location_id IS NULL OR location_id = p_location_id)
     ORDER BY (open_bottle_ml > 0) DESC,
              CASE WHEN open_bottle_ml > 0 THEN received_at END ASC,
              (qty > 0) DESC, received_at DESC, created_at DESC, id ASC
     LIMIT 1
       FOR UPDATE;
    IF v_open_lot IS NULL THEN
      INSERT INTO public.inventory_lots
        (restaurant_id, inventory_id, master_wine_id, location_id, stock_state,
         qty, open_bottle_ml, unit_cost, cost_provenance, cost_state)
      VALUES
        (v_restaurant, p_inventory_id, v_wine, p_location_id, p_stock_state,
         0, v_open_change, NULL, 'estimated', 'provisional');
    ELSE
      UPDATE public.inventory_lots
         SET open_bottle_ml = open_bottle_ml + v_open_change, updated_at = now()
       WHERE id = v_open_lot;
    END IF;
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

  v_out := jsonb_build_object(
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
  -- F-1544 lane 2: only a walk's line or an open-bottle count says more, so a
  -- spot count's answer keeps exactly the keys it had.
  IF p_session_id IS NOT NULL OR p_counted_open_ml IS NOT NULL THEN
    v_out := v_out || jsonb_build_object(
      'expected_open_ml', CASE WHEN p_counted_open_ml IS NOT NULL THEN v_expected_open END,
      'counted_open_ml',  p_counted_open_ml,
      'variance_open_ml', v_open_change,
      'session_id',       p_session_id,
      'held',             false
    );
    IF p_resolves_held_line IS NOT NULL THEN
      v_out := v_out || jsonb_build_object('resolved_held_line', p_resolves_held_line);
    END IF;
  END IF;
  RETURN v_out;
END;
$$;

comment on function public.record_stock_count IS
  'Commits a physical count and records it unconditionally in stock_counts (ADR 0078, restoring D14). The stock movement is a downstream consequence of a non-zero difference; a count that AGREES still produces a row, which set_stock_absolute + inventory_transactions were structurally unable to represent. Use this instead of set_stock_absolute for any human count. p_counted_at (F-777) is when the count was taken: counted_at and the movement''s transaction_date are LEAST(COALESCE(p_counted_at, now()), now()). p_location_id (F-291): NULL counts every shelf at once, as before; a storage location of the item''s own house counts that shelf only, so the expected figure and the correction touch only that shelf''s lots. F-1165: last_counted_at is stamped only by a count of every shelf (p_location_id NULL); a count of one shelf is dated on its stock_counts row alone. F-1524: p_unit_cost + p_cost_provenance, accepted only on an opening count (''initial''), cost the wine ONLY when it has no live costed lot: the bottles the count adds are booked at it and its uncosted live lots (none waiting on a delivery) take it, each logged in inventory_lot_revaluations. A costed wine is never overwritten; the result''s cost_applied says which happened. F-1544 (lane 2): p_counted_open_ml (>= 0, ml) records expected/counted/variance open ml on the count row and sets the counted scope''s open bottles to it (shortfall off the oldest open bottles; surplus onto the open bottle there, else the newest lot, else a new uncosted lot of 0 bottles); NULL leaves open bottles as they were. p_session_id names the house''s stock-take the count belongs to; a second count of the same item, shelf and book in one stock-take is kept in stock_count_held_lines and moves nothing (founder 2026-10-12, F2 a). F-1544 (lane 4): the hold counts only a count of the same pass of the shelf (before, or at and after, its recount_asked_at); p_resolves_held_line posts the named held line of this walk under its own key, bypassing the hold, marks it posted (p_resolved_by, the manager) and sets the shelf''s other held lines aside. With none of these named, the result has exactly the keys it had before.';

-- ---------------------------------------------------------------------------
-- 4. Send one shelf of an open walk to be counted again.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ask_stock_count_shelf_recount(
  p_session_id    uuid,
  p_restaurant_id uuid,
  p_location_id   uuid,
  p_asked_by      uuid,
  -- The round the manager saw. A double tap or a retry sends the same round,
  -- and only the first moves it on.
  p_seen_round    integer
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status  text;
  v_round   integer;
  v_at      timestamptz;
  v_dropped integer := 0;
BEGIN
  SELECT status INTO v_status FROM public.stock_count_sessions
   WHERE id = p_session_id AND restaurant_id = p_restaurant_id
     FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'That count is not one of this house''s.' USING ERRCODE = '42501';
  END IF;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'This count has ended, so no shelf can be sent back to be counted again.'
      USING ERRCODE = '22023';
  END IF;

  SELECT recount_round, recount_asked_at INTO v_round, v_at
    FROM public.stock_count_session_shelves
   WHERE session_id = p_session_id AND restaurant_id = p_restaurant_id
     AND location_id = p_location_id
     FOR UPDATE;
  IF v_round IS NULL THEN
    RAISE EXCEPTION 'That shelf is not part of this count.' USING ERRCODE = '42501';
  END IF;
  IF p_seen_round IS NULL OR p_seen_round <> v_round THEN
    -- Asked already (this tap's twin), or asked on a screen that is behind.
    RETURN jsonb_build_object('location_id', p_location_id, 'round', v_round,
                              'asked_at', v_at, 'dropped_held', 0, 'replayed', true);
  END IF;

  UPDATE public.stock_count_session_shelves
     SET recount_round = recount_round + 1,
         recount_asked_at = now(),
         recount_asked_by = p_asked_by,
         done_at = NULL, done_by = NULL,
         claimed_at = NULL, claimed_by = NULL
   WHERE session_id = p_session_id AND restaurant_id = p_restaurant_id
     AND location_id = p_location_id
  RETURNING recount_round, recount_asked_at INTO v_round, v_at;

  -- The shelf is counted again, so its held lines are not chosen; they stay
  -- as records of what was counted.
  UPDATE public.stock_count_held_lines
     SET state = 'dropped', resolved_by = p_asked_by, resolved_at = now()
   WHERE session_id = p_session_id AND restaurant_id = p_restaurant_id
     AND location_id = p_location_id AND state = 'held';
  GET DIAGNOSTICS v_dropped = ROW_COUNT;

  RETURN jsonb_build_object('location_id', p_location_id, 'round', v_round,
                            'asked_at', v_at, 'dropped_held', v_dropped, 'replayed', false);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Sign a walk off, and stamp the items it counted whole.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sign_off_stock_count_session(
  p_session_id         uuid,
  p_restaurant_id      uuid,
  p_signed_off_by      uuid,
  -- The manager's word that the shelves not counted hold nothing to count.
  p_even_if_unfinished boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s          public.stock_count_sessions%rowtype;
  v_not_done   integer;
  v_stamped    integer := 0;
BEGIN
  SELECT * INTO v_s FROM public.stock_count_sessions
   WHERE id = p_session_id AND restaurant_id = p_restaurant_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That count is not one of this house''s.' USING ERRCODE = '42501';
  END IF;
  IF v_s.status = 'signed_off' THEN
    RETURN jsonb_build_object('session_id', v_s.id, 'status', v_s.status,
                              'signed_off_at', v_s.signed_off_at, 'stamped', NULL,
                              'not_counted', NULL, 'replayed', true);
  END IF;
  IF v_s.status = 'abandoned' THEN
    RAISE EXCEPTION 'This count was stopped, so it cannot be signed off.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_not_done FROM public.stock_count_session_shelves
   WHERE session_id = p_session_id AND done_at IS NULL;
  IF v_not_done > 0 AND NOT COALESCE(p_even_if_unfinished, false) THEN
    -- Answered, not raised: the manager is asked, nothing is signed.
    RETURN jsonb_build_object('session_id', v_s.id, 'status', v_s.status,
                              'signed_off_at', NULL, 'stamped', NULL,
                              'not_counted', v_not_done, 'replayed', false);
  END IF;

  UPDATE public.stock_count_sessions
     SET status = 'signed_off', signed_off_by = p_signed_off_by, signed_off_at = now()
   WHERE id = p_session_id
  RETURNING * INTO v_s;

  -- F-1165 for a whole walk. An item is stamped when every live lot holding
  -- it sits on a shelf of this walk that is marked done AND that this walk
  -- counted it on. A lot on no shelf, on a shelf outside the walk or on a
  -- shelf not done keeps it unstamped. The stamp is the oldest of its
  -- shelves' latest counts: the age of the whole count, never younger.
  WITH per_shelf AS (
    SELECT c.inventory_id, c.location_id, max(c.counted_at) AS at
      FROM public.stock_counts c
      JOIN public.stock_count_session_shelves s
        ON s.session_id = p_session_id AND s.location_id = c.location_id
       AND s.done_at IS NOT NULL
     WHERE c.session_id = p_session_id
       AND c.restaurant_id = p_restaurant_id
       AND c.stock_state = 'live'
     GROUP BY c.inventory_id, c.location_id
  ), whole AS (
    SELECT p.inventory_id, min(p.at) AS at
      FROM per_shelf p
     WHERE NOT EXISTS (
       SELECT 1 FROM public.inventory_lots l
        WHERE l.inventory_id = p.inventory_id
          AND l.stock_state = 'live'
          AND (l.qty > 0 OR l.open_bottle_ml > 0)
          AND NOT EXISTS (
            SELECT 1 FROM per_shelf q
             WHERE q.inventory_id = l.inventory_id
               AND q.location_id = l.location_id))
     GROUP BY p.inventory_id
  )
  UPDATE public.restaurant_inventory ri
     SET last_counted_at = GREATEST(ri.last_counted_at, w.at)
    FROM whole w
   WHERE ri.id = w.inventory_id AND ri.restaurant_id = p_restaurant_id;
  GET DIAGNOSTICS v_stamped = ROW_COUNT;

  RETURN jsonb_build_object('session_id', v_s.id, 'status', v_s.status,
                            'signed_off_at', v_s.signed_off_at, 'stamped', v_stamped,
                            'not_counted', v_not_done, 'replayed', false);
END;
$$;

COMMENT ON FUNCTION public.ask_stock_count_shelf_recount(uuid, uuid, uuid, uuid, integer) IS
  'F-1544 lane 4: a manager sends one shelf of an open stock-take to be counted again: its done and claim are cleared, its round moves on (only from the round the manager saw), and its held lines are set aside. Lines counted after the ask are a new pass and are not held against the old one. Gateway (service role) only.';
COMMENT ON FUNCTION public.sign_off_stock_count_session(uuid, uuid, uuid, boolean) IS
  'F-1544 lane 4: a manager states a stock-take complete. Answers not_counted without signing while shelves are not done, unless p_even_if_unfinished. Stamps last_counted_at on every item whose every live lot sits on a done shelf this walk counted it on (F-1165), with the oldest of those shelves'' latest counts. Gates no posting (F2 a). Gateway (service role) only.';

REVOKE ALL ON FUNCTION public.ask_stock_count_shelf_recount(uuid, uuid, uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sign_off_stock_count_session(uuid, uuid, uuid, boolean) FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.ask_stock_count_shelf_recount(uuid, uuid, uuid, uuid, integer) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.sign_off_stock_count_session(uuid, uuid, uuid, boolean) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.ask_stock_count_shelf_recount(uuid, uuid, uuid, uuid, integer) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.sign_off_stock_count_session(uuid, uuid, uuid, boolean) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ask_stock_count_shelf_recount(uuid, uuid, uuid, uuid, integer) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.sign_off_stock_count_session(uuid, uuid, uuid, boolean) TO service_role';
  END IF;
END;
$grants$;

-- ---------------------------------------------------------------------------
-- In-file assertions (structural only; pg_proc, never a live table).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_src text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'record_stock_count') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one public.record_stock_count after this migration (ADR 0078: one count writer)';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_stock_count';
  IF position('IF p_location_id IS NULL THEN' in v_src) = 0
     OR position('INSERT INTO public.stock_counts' in v_src)
        > position('IF v_delta <> 0 THEN' in v_src)
     OR position('INSERT INTO public.stock_counts' in v_src)
        > position('(4a)' in v_src)
     OR position('unit_cost IS NOT NULL AND cost_provenance <> ''sample''' in v_src) = 0
     OR position('p_resolves_held_line IS NULL THEN' in v_src) = 0 THEN
    RAISE EXCEPTION 'record_stock_count must keep F-1165, insert the count before it moves stock or resolves a held line (ADR 0078), keep F-1524, and hold a walk line unless a manager chose it';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('ask_stock_count_shelf_recount', 'sign_off_stock_count_session')
       AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'the review functions run as their caller (the gateway service role), never as their owner';
  END IF;
END;
$$;

COMMIT;
