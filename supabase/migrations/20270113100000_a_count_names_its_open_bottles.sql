-- a_count_names_its_open_bottles -- a count says what is left in the open
-- bottles, and a line of a stock-take names its walk. F-1544 lane 2 of the
-- phone stock count decision (p4-scratch/sim-run/arch/decision-phone-stock-count.md;
-- the ADR number comes from the ADR lane).
--
-- THE FOUNDER'S PICKS, 2026-10-12 (sim ledger S224) this file carries:
--   F2 (a) no approval: each shelf line posts through record_stock_count on
--          sync as the person who counted it; only a duplicate on the same
--          shelf is held.
--   F3 (a) open bottles: staff enter tenths, stored as integer ml in the ONE
--          count writer (ADR 0078 stays one writer; ADR 0070 integer units).
--
-- WHAT WAS MISSING. open_bottle_ml lives on inventory_lots and only the pour
-- and sale paths ever wrote it (record_glass_pour, apply_stock_movement's
-- F-428 keep). record_stock_count read it only to decide whether a lot was
-- live (20270109000000 :198, :207). So a bar's half-empty bottles were never
-- counted: a spill, a comp poured off the books or a pour the POS never sent
-- stayed on the books as wine, and nothing recorded the difference.
--
-- WHAT THIS FILE DOES.
--
--   1. stock_counts gains expected_open_ml (what the open bottles held on the
--      books, read under the count's own lock), counted_open_ml (what the
--      counter found) and variance_open_ml (generated, as variance_qty is).
--      All three NULL for a count that did not count open bottles, which is
--      every count before this file and every count that does not name one.
--   2. public.stock_count_held_lines -- the one held line of F2 (a): a second
--      count of the same item on the same shelf in the same stock-take is
--      kept, with its counter and moment, and does not move stock. The
--      manager picks one in review (lane 4). Locked down in this file.
--   3. record_stock_count gains p_counted_open_ml and p_session_id, both
--      DEFAULT NULL, so every existing call is unchanged:
--        * p_session_id must be one of the item's house's count sessions
--          (42501, before the replay gate, as F-291's shelf check); the
--          count row carries it.
--        * a session line whose (item, shelf, book) already has a count in
--          that session is HELD (2) instead of posted. A retry of a held
--          line replays as held.
--        * p_counted_open_ml >= 0. Expected open ml is the lots' open ml in
--          the same scope as expected_qty (that shelf, or every shelf).
--          After the sealed-bottle movement, the open ml is set to what was
--          counted: a shortfall comes off the open bottles oldest first (the
--          order record_glass_pour drinks them), and a lot left with no
--          bottle and no open ml goes (F-428's rule); a surplus goes onto the
--          oldest lot already holding open ml in scope, else the newest lot
--          with bottles, else any lot in scope, else a new uncosted lot of 0
--          bottles on the counted shelf. No ledger row: inventory_transactions
--          counts bottles (quantity_change integer <> 0), and the count row
--          (expected / counted / variance open ml) is the record, as ADR 0078
--          makes it for bottles.
--      The result object is the base's exactly (same keys) unless a session
--      or an open ml was named, so a spot count is what it was.
--
-- WHY THE HOLD IS IN THE WRITER, NOT THE GATEWAY. The check "has this shelf
-- of this item already been counted in this walk" must run under the item's
-- row lock (1), or two phones syncing at once both pass it and both post. The
-- held row is still a record of what was counted (ADR 0078's point: no count
-- vanishes); it is not a stock_counts row because it moved nothing, and the
-- month close sums stock_counts.variance_qty. [Recorded as a correction to the
-- draft's lane table, which gave the hold to no lane: lane 2 is the lane that
-- makes the count route take a session, so a walk that shipped on it without
-- the hold would post duplicates. Rejected: a gateway pre-check (races), and a
-- held stock_counts row (the month close would sum a variance nobody posted).]
--
-- WHY DROP AND CREATE, NOT AN OVERLOAD. As 20270109000000: a second overload
-- with defaulted arguments makes every named-argument call that omits them
-- ambiguous. No migration GRANTs or REVOKEs record_stock_count, so the new one
-- carries the same default EXECUTE as the one it replaces. The block at the
-- end asserts exactly one.
--
-- Proof (PGlite, full corpus; fails without this migration):
--   supabase/tests/20270113100000_a_count_names_its_open_bottles_test.sql
--
-- NOT APPLIED BY HAND. The Supabase GitHub integration applies migrations on
-- merge, keyed by this filename.

BEGIN;

SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. A count names its open bottles.
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_counts
  ADD COLUMN IF NOT EXISTS expected_open_ml integer,
  ADD COLUMN IF NOT EXISTS counted_open_ml  integer;

ALTER TABLE public.stock_counts
  ADD COLUMN IF NOT EXISTS variance_open_ml integer
  GENERATED ALWAYS AS (counted_open_ml - expected_open_ml) STORED;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'stock_counts_open_ml_counted_together'
       AND conrelid = to_regclass('public.stock_counts')
  ) THEN
    -- A count either counted the open bottles (both figures) or did not
    -- (neither). Half of the pair is a figure nobody can read.
    ALTER TABLE public.stock_counts
      ADD CONSTRAINT stock_counts_open_ml_counted_together
      CHECK ((expected_open_ml IS NULL) = (counted_open_ml IS NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'stock_counts_counted_open_ml_not_negative'
       AND conrelid = to_regclass('public.stock_counts')
  ) THEN
    ALTER TABLE public.stock_counts
      ADD CONSTRAINT stock_counts_counted_open_ml_not_negative
      CHECK (counted_open_ml IS NULL OR counted_open_ml >= 0);
  END IF;
END
$$;

COMMENT ON COLUMN public.stock_counts.expected_open_ml IS
  'What the open bottles held on the books, in ml, for the counted scope (that shelf, or every shelf), read under the count''s lock. NULL when the count did not count open bottles (every row before 20270113100000).';
COMMENT ON COLUMN public.stock_counts.counted_open_ml IS
  'What the counter found left in the open bottles, in ml (shown to staff as tenths of a bottle, F3 a). NULL when open bottles were not counted.';
COMMENT ON COLUMN public.stock_counts.variance_open_ml IS
  'counted_open_ml - expected_open_ml, generated. 0 is a recorded result. NULL when open bottles were not counted.';

-- ---------------------------------------------------------------------------
-- 2. The one held line: a second count of a shelf in the same walk.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_count_held_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid NOT NULL,
  restaurant_id      uuid NOT NULL,
  inventory_id       uuid NOT NULL REFERENCES public.restaurant_inventory(id) ON DELETE CASCADE,
  -- NULL: a whole-item line (an item also on the books with no shelf, F-945).
  location_id        uuid REFERENCES public.storage_locations(id),
  stock_state        text NOT NULL,
  counted_qty        integer NOT NULL,
  counted_open_ml    integer,
  counted_by         uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  -- When it was counted (F-777), never when it reached the server.
  counted_at         timestamptz NOT NULL,
  reason             text,
  -- The key the line was sent under, so a retry holds it once.
  idempotency_key    text NOT NULL,
  -- The count already on record for this shelf in this walk.
  held_against       uuid REFERENCES public.stock_counts(id) ON DELETE SET NULL,
  state              text NOT NULL DEFAULT 'held',
  resolved_by        uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  resolved_at        timestamptz,
  -- The count a posted line became (lane 4, through record_stock_count).
  resolved_count_id  uuid REFERENCES public.stock_counts(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_count_held_lines_session_same_house
    FOREIGN KEY (session_id, restaurant_id)
    REFERENCES public.stock_count_sessions (id, restaurant_id) ON DELETE CASCADE,
  CONSTRAINT stock_count_held_lines_state_book_known
    CHECK (stock_state IN ('live', 'shadow')),
  CONSTRAINT stock_count_held_lines_qty_not_negative
    CHECK (counted_qty >= 0 AND (counted_open_ml IS NULL OR counted_open_ml >= 0)),
  CONSTRAINT stock_count_held_lines_key_not_blank
    CHECK (length(btrim(idempotency_key)) > 0),
  CONSTRAINT stock_count_held_lines_state_known
    CHECK (state IN ('held', 'posted', 'dropped')),
  CONSTRAINT stock_count_held_lines_resolution_has_a_time
    CHECK ((state = 'held') = (resolved_at IS NULL)),
  CONSTRAINT stock_count_held_lines_one_per_key UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_stock_count_held_lines_session
  ON public.stock_count_held_lines (session_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_held_lines_inventory
  ON public.stock_count_held_lines (inventory_id);

-- The duplicate test in record_stock_count reads this shape.
CREATE INDEX IF NOT EXISTS idx_stock_counts_session_item
  ON public.stock_counts (session_id, inventory_id)
  WHERE session_id IS NOT NULL;

ALTER TABLE public.stock_count_held_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_count_held_lines_service_role ON public.stock_count_held_lines;
CREATE POLICY stock_count_held_lines_service_role
  ON public.stock_count_held_lines
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.stock_count_held_lines FROM anon, authenticated;

COMMENT ON TABLE public.stock_count_held_lines IS
  'A second count of the same item on the same shelf in the same stock-take (F2 a, founder 2026-10-12 S224): kept with its counter and moment, never posted, so the manager picks one in review. Written only by record_stock_count, under the item lock. Gateway-only: every statement is scoped to the house on the token.';

-- ---------------------------------------------------------------------------
-- 3. The one count writer, with open ml and the walk.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_stock_count(
    uuid, integer, text, text, text, text, uuid, text, uuid, timestamptz, numeric, text
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
    p_session_id       uuid    default null
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
    END IF;
    RETURN v_out;
  END IF;

  -- (2b) F2 (a): the one held line. A line of a walk whose (item, shelf, book)
  -- this walk has already counted is kept and not posted; the manager picks
  -- one in review. A retry of a held line replays as held. Under the lock in
  -- (1), so two phones syncing the same shelf at once cannot both post.
  IF p_session_id IS NOT NULL THEN
    SELECT * INTO v_held FROM public.stock_count_held_lines
     WHERE idempotency_key = p_idempotency_key;
    IF NOT FOUND THEN
      SELECT id INTO v_against FROM public.stock_counts
       WHERE session_id   = p_session_id
         AND inventory_id = p_inventory_id
         AND stock_state  = p_stock_state
         AND location_id IS NOT DISTINCT FROM p_location_id
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
  END IF;
  RETURN v_out;
END;
$$;

comment on function public.record_stock_count IS
  'Commits a physical count and records it unconditionally in stock_counts (ADR 0078, restoring D14). The stock movement is a downstream consequence of a non-zero difference; a count that AGREES still produces a row, which set_stock_absolute + inventory_transactions were structurally unable to represent. Use this instead of set_stock_absolute for any human count. p_counted_at (F-777) is when the count was taken: counted_at and the movement''s transaction_date are LEAST(COALESCE(p_counted_at, now()), now()). p_location_id (F-291): NULL counts every shelf at once, as before; a storage location of the item''s own house counts that shelf only, so the expected figure and the correction touch only that shelf''s lots. F-1165: last_counted_at is stamped only by a count of every shelf (p_location_id NULL); a count of one shelf is dated on its stock_counts row alone. F-1524: p_unit_cost + p_cost_provenance, accepted only on an opening count (''initial''), cost the wine ONLY when it has no live costed lot: the bottles the count adds are booked at it and its uncosted live lots (none waiting on a delivery) take it, each logged in inventory_lot_revaluations. A costed wine is never overwritten; the result''s cost_applied says which happened. F-1544 (lane 2): p_counted_open_ml (>= 0, ml) records expected/counted/variance open ml on the count row and sets the counted scope''s open bottles to it (shortfall off the oldest open bottles; surplus onto the open bottle there, else the newest lot, else a new uncosted lot of 0 bottles); NULL leaves open bottles as they were. p_session_id names the house''s stock-take the count belongs to; a second count of the same item, shelf and book in one stock-take is kept in stock_count_held_lines and moves nothing (founder 2026-10-12, F2 a). With neither named, the result has exactly the keys it had before.';

-- ---------------------------------------------------------------------------
-- In-file assertions (structural only; pg_proc / pg_class, never a live table).
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
        > position('(5b)' in v_src)
     OR position('unit_cost IS NOT NULL AND cost_provenance <> ''sample''' in v_src) = 0 THEN
    RAISE EXCEPTION 'record_stock_count must keep F-1165, insert the count before it moves bottles or open ml (ADR 0078), and apply a cost only to a wine with no live costed lot (F-1524)';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.stock_count_held_lines')) THEN
    RAISE EXCEPTION 'stock_count_held_lines arrives with RLS on';
  END IF;
END;
$$;

COMMIT;
