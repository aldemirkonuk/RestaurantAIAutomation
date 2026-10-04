-- A SHORT POUR FINISHES THE OPEN BOTTLE AND OPENS THE NEXT, FROM ANY LOT.
-- ADR 0285. Analytics-walk finding AW08 (with A-001 and A-012).
--
-- WHAT BROKE. Until this file, record_glass_pour had one definition, the one
-- in baseline_from_production. It picks ONE lot per glass: the lot that holds
-- an open bottle comes first, oldest received first. It opens a new bottle
-- only from that same lot. When that lot has no sealed bottle left and less
-- than one pour in its open bottle, the call raises "insufficient stock for a
-- full pour", even though other lots of the same item hold sealed bottles.
-- Nothing clears that remainder. apply_stock_movement draws only lots with
-- qty > 0 (a_stock_write_names_its_house), and sync_lots_from_inventory has no
-- trigger. So one lot left at 0 sealed + 25 ml strands the item: every later
-- glass sale larger than 25 ml fails, and the gateway only logs the failure.
-- The bottles those pours should have opened stay in the book. They then show
-- in the cellar total (stock_live), in /inventory cover, and in velocity. The
-- owner-quarter sim's analytics walk (2026-10-03, read-only) traced Tuzlu
-- Rüzgar's Yakut, 159 sealed against about 31 from the app's own inputs, to
-- this by replay. A PGlite build of every migration reproduces it: lots
-- 0+25 ml and 3 sealed, a 150 ml pour raises, and so do the next four.
--
-- THE RULING. The founder, 2026-10-04 ~00:15Z, verbatim pick "Finish it, open
-- next (Recommended)": take the remainder and pour the rest from a newly
-- opened bottle, even one in another lot, as a bartender does.
--
-- THE METHOD. This is the lane's proposal under that ruling, recorded in ADR
-- 0285 for the founder's review.
--  1. Guards, after the item's row lock. A missing pour count is refused
--     22004; the old body failed on it in its FOR loop with the same code. A
--     pour of 0 ml or less is refused 22023: the old body ADDED stock for a
--     negative pour (an open 300 ml read 450 ml after a -150 ml "pour"). A
--     bottle size of 0 ml or less is refused 22023, so the draw never divides
--     by zero. The 750 ml / 150 ml fallbacks are unchanged.
--  2. The item's live lots are locked, and one availability read is taken:
--     open ml plus sealed bottles times the bottle size. If that is zero, the
--     call raises "no stock to pour". If it is less than the call's total ml,
--     it raises "insufficient stock for a full pour". Nothing moves. That
--     all-or-nothing refusal is unchanged; ADR 0115 R26 ("take to zero, name
--     the gap", PR #589) replaces it in D3.
--  3. The draw works on the call's total ml. Open bottles are finished first,
--     oldest lot first. Then sealed bottles are opened, oldest lot first,
--     across EVERY live lot of the item. The leftover of the last bottle
--     opened becomes that lot's open bottle. A pour larger than a bottle opens
--     as many bottles as it needs. The old body subtracted it from a single
--     opened bottle, and the inventory_lots_open_bottle_ml_check CHECK refused
--     that as 23514. The POS hub still queues such a sale (ADR 0011 1b). The
--     manual route can send one, and Toast can only if an item's pour_size_ml
--     exceeds its bottle_size_ml (it passes p_pour_ml null), a data error.
--  4. Location: with p_location_id set, the lots at that location are drawn
--     first (open, then sealed), then every other lot. This keeps the old
--     "prefer the location, else any" order.
--  5. A drained lot stays at 0 sealed / 0 ml. It is never deleted and keeps
--     its status, as ADR 0115 R6 asks. A depleted status belongs to M1.
--
-- UNCHANGED. The 8-argument signature and defaults. The jsonb keys (pours,
-- pour_ml, bottles_opened, sealed_now, open_ml_now, txn), and {"poured": 0}
-- for a count of 0 or less. SECURITY INVOKER with no search_path setting.
-- Owner and grants, which CREATE OR REPLACE keeps. The three existing error
-- texts. The idempotency early return. The single 'sale' ledger row of
-- -bottles_opened, with before and after taken over all live lots and written
-- only when a bottle was opened. The pour_events row. Table names are now
-- schema-qualified. That changes nothing for a caller whose search_path
-- reaches public.
--
-- NOT HERE. Stock that is already wrong (Tuzlu's lost Jul-Aug pours) needs a
-- production repair. That repair needs the founder's yes and a read-only dry
-- run first, so it is not in this file. Per-lot ids on pour and ledger rows,
-- a record of how a sale decomposed, and per-lot idempotency keys stay with
-- ADR 0115 D3 (R19).
--
-- RE-RUNNABLE. CREATE OR REPLACE and COMMENT ON apply again cleanly. No table
-- lock is taken. The closing DO block reads the catalog only and writes no
-- row. If another migration adds a second overload, that block fails, so the
-- lane that merges second must rebuild on this body and not beside it. No
-- explicit BEGIN/COMMIT: the Supabase CLI wraps each migration file in a
-- transaction.

CREATE OR REPLACE FUNCTION public.record_glass_pour(
    p_inventory_id uuid,
    p_pours integer DEFAULT 1,
    p_pour_ml integer DEFAULT NULL::integer,
    p_location_id uuid DEFAULT NULL::uuid,
    p_source text DEFAULT 'pos'::text,
    p_performed_by uuid DEFAULT NULL::uuid,
    p_reason text DEFAULT NULL::text,
    p_idempotency_key text DEFAULT NULL::text
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
       jsonb_build_object('pours', p_pours, 'pour_ml', v_pour_ml, 'bottles_opened', v_bottles_opened), now())
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

COMMENT ON FUNCTION public.record_glass_pour(uuid, integer, integer, uuid, text, uuid, text, text) IS
  'Depletes by-the-glass pours from an item''s live lots, all or nothing. It finishes open bottles first, oldest lot first, then opens sealed bottles oldest lot first across every lot of the item, preferring p_location_id when given. A pour larger than a bottle opens several. A pour of 0 ml or less is refused 22023. When the whole item holds less than the call, it raises and moves nothing. Writes one sale ledger row of -bottles_opened, and a pour_events row keyed by p_idempotency_key. ADR 0285; migration a_short_pour_opens_the_next_bottle.';

-- Structural assertions: catalog reads only.
DO $$
DECLARE
  v_n int;
  v_oid oid;
BEGIN
  SELECT count(*), min(p.oid) INTO v_n, v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_glass_pour';
  -- Fatal on purpose. A second overload that also accepts the gateway's named
  -- arguments (a 9th parameter with a DEFAULT, say) makes the call ambiguous
  -- to PostgREST, so glass pours would fail and only be logged: AW08's own
  -- shape. The message names what it found, so a halted apply is diagnosable.
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one public.record_glass_pour, found %: %', v_n,
      (SELECT string_agg('(' || pg_get_function_identity_arguments(p.oid) || ')', '; ')
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'record_glass_pour');
  END IF;
  IF pg_get_function_identity_arguments(v_oid) IS DISTINCT FROM
     'p_inventory_id uuid, p_pours integer, p_pour_ml integer, p_location_id uuid, p_source text, p_performed_by uuid, p_reason text, p_idempotency_key text' THEN
    RAISE EXCEPTION 'record_glass_pour identity arguments changed: %', pg_get_function_identity_arguments(v_oid);
  END IF;
  IF (SELECT prorettype FROM pg_proc WHERE oid = v_oid) <> 'jsonb'::regtype
     OR (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'record_glass_pour must return jsonb and stay SECURITY INVOKER';
  END IF;
  IF position('FOR v_tier IN 0..v_tiers LOOP' IN (SELECT prosrc FROM pg_proc WHERE oid = v_oid)) = 0 THEN
    RAISE EXCEPTION 'record_glass_pour does not carry the cross-lot draw (ADR 0285)';
  END IF;
END $$;
