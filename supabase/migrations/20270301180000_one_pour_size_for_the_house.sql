-- ===========================================================================
-- One pour size for the house: a glass sold with no stated pour draws the
-- house's confirmed pour, not a hard-coded 150 ml
-- ===========================================================================
--
-- WHAT WAS WRONG (read at origin/main 7221901d6; recipes walk G13, proposal
-- lane A4, call F11). record_glass_pour resolved the ml of one glass as
-- COALESCE(p_pour_ml, ri.pour_size_ml, 150) (migration
-- a_pos_sale_is_dated_by_its_check). The house's own pour,
-- restaurants.default_pour_ml, which an owner or manager confirms through
-- PUT /pricing/pour-size (migration a_house_confirms_its_pour_before_glass_advice),
-- was never read by the stock draw. A house that pours 125 ml and confirmed it
-- had every item without its own pour drawn at 150 ml: price advice and the
-- cellar disagreed about the same glass.
--
-- WHAT THIS MIGRATION DOES.
--
-- 1. record_glass_pour: the chain becomes
--      p_pour_ml -> the item's pour_size_ml -> the house's CONFIRMED pour -> 150
--    Wine only, interim until ADR 0115 step S replaces the chain with the
--    serve sizes per kind. The house's pour is read only when
--    pour_size_confirmed_at is set: an unconfirmed default_pour_ml is the
--    column's DEFAULT 150, never a number the house stated (the rule price
--    advice already keeps, target-margin.service.ts confirmedPourFrom), so an
--    unconfirmed house pours exactly what it poured yesterday. The read is a
--    scalar subquery so FOR UPDATE keeps locking only the item row, never the
--    restaurants row every other write of the house touches.
--    Dropped and re-created with the identical 9-argument signature, not
--    CREATE OR REPLACEd, so no second overload can survive; the body is
--    a_pos_sale_is_dated_by_its_check's verbatim except the marked pour line
--    and one sentence appended to the COMMENT.
--
-- 2. restaurants.default_pour_ml is a pour or nothing: NULL or 10..500 ml
--    (call F12: 10 ml lets a 20-25 ml spirit measure through and stops a
--    1 ml typo; the bounds are the confirmation CHECK's and
--    ConfirmPourSizeDto's). The CHECK is added NOT VALID, so every new write
--    is held to it, and is VALIDATEd in the same migration only when no
--    existing row breaks it; otherwise it stays NOT VALID and says so in a
--    WARNING, because a migration that dies on a production row nobody has
--    seen is not this lane's call.
--
-- No GRANT or REVOKE: none exists on either function's history (see
-- a_pos_sale_is_dated_by_its_check). Writes no row.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. record_glass_pour
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.record_glass_pour(
    uuid, integer, integer, uuid, text, uuid, text, text, timestamp with time zone
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
         -- one_pour_size_for_the_house: the house's CONFIRMED pour sits between
         -- the item's pour and the 150 ml last resort (wine only, until ADR 0115 step S).
         COALESCE(p_pour_ml, ri.pour_size_ml,
                  (SELECT r.default_pour_ml FROM public.restaurants r
                    WHERE r.id = ri.restaurant_id AND r.pour_size_confirmed_at IS NOT NULL),
                  150)
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
  'scripts/check_stock_wrappers_check_ownership.py). Changed by migration '
  'one_pour_size_for_the_house: with no p_pour_ml and no item pour, the '
  'house''s confirmed pour (restaurants.default_pour_ml with '
  'pour_size_confirmed_at) comes before the 150 ml last resort.';

-- ---------------------------------------------------------------------------
-- 2. restaurants.default_pour_ml is NULL or a real pour
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurants_default_pour_is_a_pour'
       AND conrelid = to_regclass('public.restaurants')
  ) THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_default_pour_is_a_pour
      CHECK (default_pour_ml IS NULL OR (default_pour_ml >= 10 AND default_pour_ml <= 500))
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.restaurants
     WHERE default_pour_ml IS NOT NULL
       AND (default_pour_ml < 10 OR default_pour_ml > 500 OR default_pour_ml = 'NaN'::double precision)
  ) THEN
    ALTER TABLE public.restaurants VALIDATE CONSTRAINT restaurants_default_pour_is_a_pour;
  ELSE
    RAISE WARNING 'restaurants_default_pour_is_a_pour stays NOT VALID: a house carries a default_pour_ml outside 10..500 ml; new writes are held to it';
  END IF;
END
$$;

COMMENT ON CONSTRAINT restaurants_default_pour_is_a_pour ON public.restaurants IS
  'The house pour is NULL or 10..500 ml (migration one_pour_size_for_the_house, call F12). record_glass_pour reads it, once confirmed, before its 150 ml last resort.';

-- ---------------------------------------------------------------------------
-- 3. In-file assertions (structural only; pg_proc and pg_constraint)
-- ---------------------------------------------------------------------------
--
-- Behaviour is exercised by the self-asserting test
-- supabase/tests/<version>_one_pour_size_for_the_house_test.sql.

DO $$
DECLARE
  v_count int;
  v_args int;
  v_defaults int;
  v_src text;
BEGIN
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
  -- this migration's own change is in the body that runs.
  IF position('r.default_pour_ml' in v_src) = 0
     OR position('r.pour_size_confirmed_at IS NOT NULL' in v_src) = 0 THEN
    RAISE EXCEPTION 'record_glass_pour does not read the house''s confirmed pour (one_pour_size_for_the_house)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurants_default_pour_is_a_pour'
       AND conrelid = 'public.restaurants'::regclass AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'restaurants_default_pour_is_a_pour is missing';
  END IF;
END;
$$;

COMMIT;
