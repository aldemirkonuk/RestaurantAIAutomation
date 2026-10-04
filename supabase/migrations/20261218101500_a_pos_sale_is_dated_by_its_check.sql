-- ===========================================================================
-- ADR 0281 — a POS sale is dated by its check, not by the moment it was typed in
-- ===========================================================================
--
-- WHAT WAS WRONG (re-verified at origin/main 8c673db4b, findings A-007/A-009;
-- re-read at fb862aa57 after a_short_pour_opens_the_next_bottle merged).
--
-- The POS hub keeps a check's closed_at on pos_checks, and every revenue
-- reader dates the sale by it. The stock it moved was dated differently:
-- `apply_stock_movement` stamps inventory_transactions.transaction_date with
-- now() (a_stock_write_names_its_house, the INSERT at its end) and
-- `record_glass_pour` does the same on the ledger row it writes when a pour
-- opens a bottle (a_short_pour_opens_the_next_bottle, ADR 0285, which
-- replaced the baseline body and kept now()). Neither took a date. So a check that reached the hub late — a back-filled import, a
-- webhook the POS retried, a replay — had its stock dated on the day it was
-- typed in. inventory_analytics computes velocity, sold_30d, runway and the
-- reorder point from transaction_date, so two months of back-filled sales
-- read as one day's spike: velocity about 2x, runway about half (Tuzlu
-- Rüzgar, 2026-10-03: median 2.04x over 112 rows).
--
-- WHAT THIS MIGRATION DOES.
--
-- One thing, on both functions: an optional `p_occurred_at`, and the ledger
-- row's transaction_date becomes LEAST(COALESCE(p_occurred_at, now()), now()).
--
--   * NULL is now(), exactly as before, so every caller that does not pass
--     it — the Toast door, the door receipt, counts, the Python orchestrator,
--     the sim seed — writes what it wrote yesterday.
--   * A future instant is clamped to now(). A clock that runs ahead must not
--     put stock movements into tomorrow, where "last 30 days" cannot see them.
--   * created_at keeps its DEFAULT now(), so the time the row was ENTERED is
--     still on it. pour_events.created_at stays insertion time too: nothing
--     reads it as the time of the pour.
--
-- Nothing else in either body changes. The apply_stock_movement body is
-- a_stock_write_names_its_house (lines 111-266) verbatim and the
-- record_glass_pour body is a_short_pour_opens_the_next_bottle (ADR 0285, the
-- body between its AS $$ and $$) verbatim, apart from the added parameter and
-- the one marked line in each. In particular the ADR 0141 refusal,
-- idempotency, FIFO depletion, and ADR 0285's draw (finish the open bottle,
-- then open the next from any lot; the 22004/22023 guards; all-or-nothing)
-- are untouched. That draw writes ONE ledger row for every bottle a pour
-- opens, whichever lot each came from, so the one dated line dates them all.
--
-- MERGE ORDER. a_short_pour_opens_the_next_bottle merged first (#600,
-- fb862aa57) and CREATE OR REPLACEs the 8-argument function. This file must
-- sort AFTER it: applied before it, that CREATE OR REPLACE would add an
-- 8-argument overload beside this 9-argument one, and its own exactly-one
-- assertion would halt `supabase db reset`. Its version is therefore past
-- every migration on main (migration-order guard; ADR 0212).
--
-- WHY THE ARGUMENT DEFAULTS TO NULL. Migrations apply when the PR merges; the
-- gateway deploys after. In that window the OLD gateway calls the NEW
-- functions without the argument, and a required one would stop every POS
-- sale and door receipt (the same reasoning as ADR 0141's p_restaurant_id).
--
-- WHY DROP AND CREATE, NOT AN OVERLOAD. Postgres treats a different parameter
-- list as a separate function. Leaving the old signature beside the new one
-- gives PostgREST, which resolves by argument NAME, two candidates for every
-- call that omits p_occurred_at, and it refuses them as ambiguous. Each old
-- signature is dropped first and the block at the end asserts that exactly one
-- of each function survives. No migration GRANTs or REVOKEs either function
-- (grep -rn over supabase/migrations/; the baseline dump carries no GRANT at
-- all), so as far as the migrations record, each carries only the default
-- EXECUTE, which the new one also gets. Production's ACL on the two functions
-- was not read (ADR 0141 dropped and re-created apply_stock_movement the same
-- way).
--
-- POSITIONAL SQL CALLERS still resolve: set_stock_absolute
-- (stock_race_and_pour_idempotency) and record_stock_count
-- (a_count_is_a_record) call apply_stock_movement with 11 positional
-- arguments, and the eight trailing ones default.
--
-- ONE SHARED ARGUMENT. Other lanes that need a date on these functions (the
-- door's arrival time, C02) reuse p_occurred_at rather than adding a second
-- date argument; a lane that later redefines either function copies this
-- body and keeps the exactly-one assertion, so a merge that drops the other's
-- change fails loudly instead of drifting (ADR 0281, F3).
--
-- NOT APPLIED BY HAND. The Supabase GitHub integration applies migrations on
-- merge, keyed by this filename.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. apply_stock_movement: exactly one, and it takes the time of the movement
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.apply_stock_movement(
    uuid, text, integer, text, text, uuid, text, numeric, uuid, uuid, text, text,
    text, uuid, text, text, jsonb, uuid
);

CREATE FUNCTION public.apply_stock_movement(
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
  'Use revalue_lot or finalise_delivery_cost to CORRECT a cost — this function '
  'only ever creates or consumes quantity.';

-- ---------------------------------------------------------------------------
-- 2. record_glass_pour: exactly one, ADR 0285's draw, and the bottles it
--    opens are dated by the sale
-- ---------------------------------------------------------------------------
--
-- Dropped and re-created with a 9th argument, not CREATE OR REPLACEd: the
-- parameter list changes. The body below is a_short_pour_opens_the_next_bottle
-- verbatim except the marked transaction_date line.

DROP FUNCTION IF EXISTS public.record_glass_pour(
    uuid, integer, integer, uuid, text, uuid, text, text
);

CREATE FUNCTION public.record_glass_pour(
    p_inventory_id uuid,
    p_pours integer DEFAULT 1,
    p_pour_ml integer DEFAULT NULL::integer,
    p_location_id uuid DEFAULT NULL::uuid,
    p_source text DEFAULT 'pos'::text,
    p_performed_by uuid DEFAULT NULL::uuid,
    p_reason text DEFAULT NULL::text,
    p_idempotency_key text DEFAULT NULL::text,
    p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone
) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_restaurant uuid; v_wine uuid; v_bottle_ml int; v_pour_ml int;
  v_lot record; v_bottles_opened int := 0; v_tier int; v_tiers int;
  v_need bigint; v_have bigint; v_take bigint; v_n int;
  v_before int; v_after int; v_txn uuid; v_existing uuid;
BEGIN
  IF p_pours <= 0 THEN RETURN jsonb_build_object('poured', 0); END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.pour_events WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('idempotent', true, 'pour_event', v_existing); END IF;
  END IF;

  SELECT ri.restaurant_id, ri.master_wine_id, COALESCE(ri.bottle_size_ml, 750),
         COALESCE(p_pour_ml, ri.pour_size_ml, 150)
    INTO v_restaurant, v_wine, v_bottle_ml, v_pour_ml
    FROM public.restaurant_inventory ri WHERE ri.id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL THEN RAISE EXCEPTION 'inventory % not found', p_inventory_id; END IF;

  -- ADR 0285 (1): refuse what would corrupt the lots instead of pouring it.
  IF p_pours IS NULL THEN
    RAISE EXCEPTION 'a pour needs a count of glasses (got null) on inventory %', p_inventory_id
      USING ERRCODE = '22004';
  END IF;
  IF v_pour_ml <= 0 THEN
    RAISE EXCEPTION 'a pour must be more than 0 ml (got %) on inventory %', v_pour_ml, p_inventory_id
      USING ERRCODE = '22023';
  END IF;
  IF v_bottle_ml <= 0 THEN
    RAISE EXCEPTION 'a bottle must hold more than 0 ml (got %) on inventory %', v_bottle_ml, p_inventory_id
      USING ERRCODE = '22023';
  END IF;

  -- ADR 0285 (2): what the whole item holds, read once under the locks.
  PERFORM 1 FROM public.inventory_lots
    WHERE inventory_id = p_inventory_id AND stock_state = 'live' FOR UPDATE;
  SELECT COALESCE(SUM(qty), 0),
         COALESCE(SUM(open_bottle_ml), 0) + COALESCE(SUM(qty), 0)::bigint * v_bottle_ml
    INTO v_before, v_have
    FROM public.inventory_lots WHERE inventory_id = p_inventory_id AND stock_state = 'live';
  v_need := p_pours::bigint * v_pour_ml;
  IF v_have = 0 THEN RAISE EXCEPTION 'no stock to pour for inventory %', p_inventory_id; END IF;
  IF v_have < v_need THEN RAISE EXCEPTION 'insufficient stock for a full pour on inventory %', p_inventory_id; END IF;

  -- ADR 0285 (3)-(4): finish open bottles, then open sealed ones from any lot.
  -- Tier 0 is the given location (or every lot when none is given); tier 1 is
  -- every other lot.
  v_tiers := CASE WHEN p_location_id IS NULL THEN 0 ELSE 1 END;
  FOR v_tier IN 0..v_tiers LOOP
    EXIT WHEN v_need = 0;
    FOR v_lot IN SELECT id, open_bottle_ml FROM public.inventory_lots
        WHERE inventory_id = p_inventory_id AND stock_state = 'live' AND open_bottle_ml > 0
          AND (p_location_id IS NULL OR ((location_id IS NOT DISTINCT FROM p_location_id) = (v_tier = 0)))
        ORDER BY received_at ASC, created_at ASC, id ASC LOOP
      EXIT WHEN v_need = 0;
      v_take := LEAST(v_lot.open_bottle_ml::bigint, v_need);
      UPDATE public.inventory_lots
         SET open_bottle_ml = open_bottle_ml - v_take::int, updated_at = now()
       WHERE id = v_lot.id;
      v_need := v_need - v_take;
    END LOOP;
    FOR v_lot IN SELECT id, qty FROM public.inventory_lots
        WHERE inventory_id = p_inventory_id AND stock_state = 'live' AND qty > 0
          AND (p_location_id IS NULL OR ((location_id IS NOT DISTINCT FROM p_location_id) = (v_tier = 0)))
        ORDER BY received_at ASC, created_at ASC, id ASC LOOP
      EXIT WHEN v_need = 0;
      v_n := LEAST(v_lot.qty::bigint, (v_need + v_bottle_ml - 1) / v_bottle_ml)::int;
      v_take := LEAST(v_need, v_n::bigint * v_bottle_ml);
      UPDATE public.inventory_lots
         SET qty = qty - v_n,
             open_bottle_ml = open_bottle_ml + (v_n::bigint * v_bottle_ml - v_take)::int,
             updated_at = now()
       WHERE id = v_lot.id;
      v_bottles_opened := v_bottles_opened + v_n;
      v_need := v_need - v_take;
    END LOOP;
  END LOOP;
  -- Unreachable while the locks hold; kept so a short draw can never commit.
  IF v_need > 0 THEN RAISE EXCEPTION 'insufficient stock for a full pour on inventory %', p_inventory_id; END IF;

  v_after := (SELECT COALESCE(SUM(qty), 0) FROM public.inventory_lots
               WHERE inventory_id = p_inventory_id AND stock_state = 'live');

  IF v_bottles_opened > 0 THEN
    INSERT INTO public.inventory_transactions
      (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change, quantity_before, quantity_after,
       stock_type, performed_by, performed_by_type, reason, metadata, transaction_date)
    VALUES
      (v_restaurant, p_inventory_id, v_wine, 'sale', p_source::public.inventory_transaction_source, -v_bottles_opened, v_before, v_after,
       'live', p_performed_by, CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
       COALESCE(p_reason, 'by-the-glass pours'),
       jsonb_build_object('pours', p_pours, 'pour_ml', v_pour_ml, 'bottles_opened', v_bottles_opened),
       -- a_pos_sale_is_dated_by_its_check: dated by the sale, never later than now.
       -- This one row covers every bottle the pour opened, from whichever lot.
       LEAST(COALESCE(p_occurred_at, now()), now()))
    RETURNING id INTO v_txn;
  END IF;

  INSERT INTO public.pour_events (restaurant_id, inventory_id, master_wine_id, pours, pour_ml, bottles_opened, location_id, source, performed_by, idempotency_key)
  VALUES (v_restaurant, p_inventory_id, v_wine, p_pours, v_pour_ml, v_bottles_opened, p_location_id, p_source, p_performed_by, p_idempotency_key);

  RETURN jsonb_build_object(
    'pours', p_pours, 'pour_ml', v_pour_ml, 'bottles_opened', v_bottles_opened,
    'sealed_now', v_after,
    'open_ml_now', (SELECT COALESCE(SUM(open_bottle_ml), 0) FROM public.inventory_lots
                     WHERE inventory_id = p_inventory_id AND stock_state = 'live'),
    'txn', v_txn);
END;
$$;

COMMENT ON FUNCTION public.record_glass_pour IS
  'Depletes by-the-glass pours from an item''s live lots, all or nothing. It '
  'finishes open bottles first, oldest lot first, then opens sealed bottles '
  'oldest lot first across every lot of the item, preferring p_location_id '
  'when given. A pour larger than a bottle opens several. A pour of 0 ml or '
  'less is refused 22023. When the whole item holds less than the call, it '
  'raises and moves nothing. Writes one sale ledger row of -bottles_opened, '
  'and a pour_events row keyed by p_idempotency_key. ADR 0285; migration '
  'a_short_pour_opens_the_next_bottle. Changed by ADR 0281 (migration '
  'a_pos_sale_is_dated_by_its_check): the ledger row''s transaction_date is '
  'LEAST(COALESCE(p_occurred_at, now()), now()), the time of the sale and '
  'never later than now; NULL is now() as before. Takes no restaurant: '
  'callers prove the item is the house''s own first (ADR 0141, '
  'scripts/check_stock_wrappers_check_ownership.py).';

-- ---------------------------------------------------------------------------
-- 3. In-file assertions (structural only; pg_proc, never a live table)
-- ---------------------------------------------------------------------------
--
-- Behaviour is exercised by the self-asserting test
-- supabase/tests/<version>_a_pos_sale_is_dated_by_its_check_test.sql, run on a
-- database built from these migrations. A migration does not write rows into
-- production to prove itself.

DO $$
DECLARE
  v_count int;
  v_args int;
  v_defaults int;
  v_src text;
BEGIN
  -- apply_stock_movement
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'apply_stock_movement';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one public.apply_stock_movement after this migration, found %. Two overloads make PostgREST ambiguous and every named-argument call fails.', v_count;
  END IF;

  SELECT p.pronargs, p.pronargdefaults, p.prosrc INTO v_args, v_defaults, v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'apply_stock_movement';

  IF v_args <> 19 THEN
    RAISE EXCEPTION 'apply_stock_movement should take 19 arguments after this migration, takes %', v_args;
  END IF;
  -- p_performed_by through p_occurred_at. The defaults are what make the
  -- deploy window and every caller that does not date its movement survive.
  IF v_defaults <> 14 THEN
    RAISE EXCEPTION 'apply_stock_movement should carry 14 defaulted arguments (p_performed_by through p_occurred_at), carries %', v_defaults;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'apply_stock_movement'
       AND p.proargnames[18] = 'p_restaurant_id'
       AND p.proargnames[19] = 'p_occurred_at'
       AND p.proargtypes[18] = 'timestamptz'::regtype
  ) THEN
    RAISE EXCEPTION 'apply_stock_movement: argument 18 must stay p_restaurant_id and argument 19 must be p_occurred_at timestamptz';
  END IF;
  -- ADR 0141's refusal survived the copy, and the date really is in the body.
  IF position('does not match the item' in v_src) = 0 THEN
    RAISE EXCEPTION 'apply_stock_movement body carries no tenant refusal (ADR 0141)';
  END IF;
  IF position('LEAST(COALESCE(p_occurred_at, now()), now())' in v_src) = 0 THEN
    RAISE EXCEPTION 'apply_stock_movement body does not date its ledger row by p_occurred_at';
  END IF;

  -- record_glass_pour
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_glass_pour';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one public.record_glass_pour after this migration, found %. Two overloads make PostgREST ambiguous and every named-argument call fails.', v_count;
  END IF;

  SELECT p.pronargs, p.pronargdefaults, p.prosrc INTO v_args, v_defaults, v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_glass_pour';

  IF v_args <> 9 OR v_defaults <> 8 THEN
    RAISE EXCEPTION 'record_glass_pour should take 9 arguments, 8 defaulted, takes % with % defaulted', v_args, v_defaults;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'record_glass_pour'
       AND p.proargnames[9] = 'p_occurred_at'
       AND p.proargtypes[8] = 'timestamptz'::regtype
  ) THEN
    RAISE EXCEPTION 'record_glass_pour: argument 9 must be p_occurred_at timestamptz';
  END IF;
  IF position('LEAST(COALESCE(p_occurred_at, now()), now())' in v_src) = 0 THEN
    RAISE EXCEPTION 'record_glass_pour body does not date its ledger row by p_occurred_at';
  END IF;
  -- ADR 0285's body survived the copy: its cross-lot draw, its guards and
  -- its refusals are still the ones the body runs and raises. Dating must not
  -- change what a pour takes from the lots.
  IF position('FOR v_tier IN 0..v_tiers LOOP' in v_src) = 0
     OR position('IF v_have < v_need THEN' in v_src) = 0
     OR position('IF v_pour_ml <= 0 THEN' in v_src) = 0
     OR position('IF p_pours IS NULL THEN' in v_src) = 0
     OR position('ELSIF v_lot.qty >= 1' in v_src) > 0 THEN
    RAISE EXCEPTION 'record_glass_pour does not carry ADR 0285''s cross-lot draw and guards; a lane that redefines it copies a_short_pour_opens_the_next_bottle''s body';
  END IF;
  IF position('no stock to pour for inventory' in v_src) = 0
     OR position('insufficient stock for a full pour' in v_src) = 0 THEN
    RAISE EXCEPTION 'record_glass_pour lost a refusal in the copy; its stock behaviour must not change here';
  END IF;
  IF (SELECT p.prorettype FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'record_glass_pour') <> 'jsonb'::regtype
     OR (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'record_glass_pour') THEN
    RAISE EXCEPTION 'record_glass_pour must return jsonb and stay SECURITY INVOKER';
  END IF;
END;
$$;

COMMIT;
