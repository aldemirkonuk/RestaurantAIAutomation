-- ===========================================================================
-- a_glass_void_gives_back_its_cost: a bottle a glass void folds back carries
-- its lot's cost back onto the ledger (2 of 2, after a_glass_pour_carries_its_cost)
-- ===========================================================================
--
-- WHAT WAS WRONG. return_glass_pour's fold path (a_void_gives_back_the_pour)
-- puts whole bottles back on a lot and writes a return row with no draw, so
-- the bottle came back uncosted: pos_cost_of_goods counted it in
-- uncosted_back and withheld the house's cost of goods, while the sale that
-- opened the bottle (since a_glass_pour_carries_its_cost) is costed. The
-- bottle path is not touched: it already goes through apply_stock_movement
-- with the sale's key and is matched there (a_void_gives_back_its_cost).
--
-- WHAT THIS DOES. return_glass_pour is re-created with
-- a_void_gives_back_the_pour's body byte for byte, plus the one line marked
-- "-- a_glass_void_gives_back_its_cost": after the fold's return row it
-- stamps a draw of -bottles on the lot it folded into, at that lot's cost.
-- Known approximation, named by the owner contract: the open container is the
-- last-touched lot (ADR 0285), which may not be the lot the sale opened; the
-- bottle is costed where it now sits, so the settle job and the lot agree.
-- Same signature, so no overload; grants and the comment are kept.
--
-- MERGE ORDER. After a_glass_pour_carries_its_cost and
-- a_void_gives_back_the_pour; the guard below refuses to run before them.
-- The CLAIMS row A-GLASS-VOID-GIVES-BACK-ITS-COST fails the build if the
-- copied body drifts from its source migration.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.return_glass_pour(uuid, uuid, text, integer, text, timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION 'a_glass_void_gives_back_its_cost needs return_glass_pour (migration a_void_gives_back_the_pour) first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'record_glass_pour'
                    AND position('PERFORM public.stamp_lot_draws(v_txn,' in p.prosrc) > 0) THEN
    RAISE EXCEPTION 'a_glass_void_gives_back_its_cost needs a_glass_pour_carries_its_cost first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.return_glass_pour(
    p_restaurant_id uuid,
    p_inventory_id uuid,
    p_sale_key text,
    p_pours integer,
    p_idempotency_key text,
    p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone
) RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY INVOKER
    AS $$
DECLARE
  v_restaurant uuid; v_wine uuid; v_bottle_ml int;
  v_existing uuid; v_sale record; v_pours int; v_given bigint; v_folded bigint;
  v_returned bigint; v_lot record; v_total bigint;
  v_folds int := 0; v_rest bigint; v_overflow bigint := 0; v_added bigint;
  v_before int; v_after int; v_txn uuid; v_event uuid;
BEGIN
  IF p_sale_key IS NULL OR p_idempotency_key IS NULL OR p_pours IS NULL THEN
    RAISE EXCEPTION 'return_glass_pour needs a sale key, its own key and a glass count' USING ERRCODE = '22004';
  END IF;
  -- ADR 0093 D5.
  IF p_idempotency_key = p_sale_key THEN
    RAISE EXCEPTION 'return_glass_pour: the void''s key must not be the sale''s key (%)', p_sale_key
      USING ERRCODE = '22023';
  END IF;

  -- ADR 0141: the house is checked first.
  SELECT ri.restaurant_id, ri.master_wine_id, COALESCE(ri.bottle_size_ml, 750)
    INTO v_restaurant, v_wine, v_bottle_ml
    FROM public.restaurant_inventory ri WHERE ri.id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL OR p_restaurant_id IS NULL OR v_restaurant <> p_restaurant_id THEN
    RAISE EXCEPTION 'return_glass_pour: item % is not an item of restaurant %; nothing moved',
      p_inventory_id, p_restaurant_id USING ERRCODE = '42501';
  END IF;
  IF v_bottle_ml <= 0 THEN
    RAISE EXCEPTION 'bottle_size_ml must be above 0 on %', p_inventory_id USING ERRCODE = '22023';
  END IF;

  IF p_pours <= 0 THEN
    RETURN jsonb_build_object('returned_ml', 0, 'reason', 'nothing to return');
  END IF;

  -- A replay moves nothing, nor an old-path void under this key.
  SELECT id INTO v_existing FROM public.pour_events WHERE idempotency_key = p_idempotency_key LIMIT 1;
  IF v_existing IS NULL THEN
    SELECT id INTO v_existing FROM public.inventory_transactions WHERE idempotency_key = p_idempotency_key LIMIT 1;
  END IF;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('idempotent', true, 'returned_ml', 0, 'event', v_existing);
  END IF;

  SELECT pe.pours, pe.pour_ml, pe.bottles_opened INTO v_sale
    FROM public.pour_events pe
   WHERE pe.idempotency_key = p_sale_key
     AND pe.restaurant_id = p_restaurant_id
     AND pe.inventory_id = p_inventory_id
     AND pe.pours > 0;
  IF NOT FOUND THEN
    -- Booked as bottles (apply_stock_movement under the sale key): bottles back,
    -- whatever unit the item is sold in today.
    SELECT -t.quantity_change AS bottles INTO v_sale
      FROM public.inventory_transactions t
     WHERE t.idempotency_key = p_sale_key
       AND t.restaurant_id = p_restaurant_id
       AND t.inventory_id = p_inventory_id
       AND t.transaction_type = 'sale' AND t.stock_type = 'live'
       AND t.quantity_change < 0;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'return_glass_pour: no sale of item % is booked under %; nothing moved',
        p_inventory_id, p_sale_key USING ERRCODE = 'P0002';
    END IF;
    v_given := (SELECT COALESCE(SUM(quantity_change), 0) FROM public.inventory_transactions
                 WHERE inventory_id = p_inventory_id AND transaction_type = 'return'
                   AND metadata->>'sale_key' = p_sale_key);
    v_pours := LEAST(p_pours::bigint, v_sale.bottles - v_given)::int;
    IF v_pours <= 0 THEN
      RETURN jsonb_build_object('returned_bottles', 0, 'reason', 'the sale is already given back');
    END IF;
    v_txn := public.apply_stock_movement(
      p_inventory_id => p_inventory_id, p_stock_state => 'live', p_delta => v_pours,
      p_transaction_type => 'return', p_source => 'pos', p_reason => 'POS void: bottles returned',
      p_idempotency_key => p_idempotency_key, p_metadata => jsonb_build_object('sale_key', p_sale_key),
      p_restaurant_id => p_restaurant_id, p_occurred_at => p_occurred_at);
    RETURN jsonb_build_object('returned_bottles', v_pours, 'txn', v_txn);
  END IF;

  -- Every earlier void of this sale, under any key, counts against it.
  SELECT COALESCE(SUM(-pours), 0), COALESCE(SUM(-bottles_opened), 0) INTO v_given, v_folded
    FROM public.pour_events WHERE inventory_id = p_inventory_id AND returns_sale_key = p_sale_key;
  v_pours := LEAST(p_pours::bigint, v_sale.pours - v_given)::int;
  IF v_pours <= 0 THEN
    RETURN jsonb_build_object('returned_ml', 0, 'reason', 'the sale is already given back');
  END IF;
  v_returned := v_pours::bigint * v_sale.pour_ml;

  PERFORM 1 FROM public.inventory_lots
    WHERE inventory_id = p_inventory_id AND stock_state = 'live' FOR UPDATE;
  v_before := (SELECT COALESCE(SUM(qty), 0) FROM public.inventory_lots
                WHERE inventory_id = p_inventory_id AND stock_state = 'live');

  -- ADR 0285's last-touched open container, else the last-touched lot.
  SELECT id, open_bottle_ml INTO v_lot FROM public.inventory_lots
   WHERE inventory_id = p_inventory_id AND stock_state = 'live' AND open_bottle_ml > 0
   ORDER BY updated_at DESC, received_at DESC, created_at DESC, id DESC LIMIT 1;
  IF NOT FOUND THEN
    SELECT id, open_bottle_ml INTO v_lot FROM public.inventory_lots
     WHERE inventory_id = p_inventory_id AND stock_state = 'live'
     ORDER BY updated_at DESC, received_at DESC, created_at DESC, id DESC LIMIT 1;
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('returned_ml', 0, 'reason', 'no live lot to return to');
  END IF;

  -- Fold bottles back, never more than the sale opened; cap at one bottle.
  v_total := v_lot.open_bottle_ml::bigint + v_returned;
  v_folds := LEAST(v_total / v_bottle_ml, GREATEST(v_sale.bottles_opened - v_folded, 0))::int;
  v_rest := v_total - v_folds::bigint * v_bottle_ml;
  v_overflow := GREATEST(v_rest - v_bottle_ml, 0);
  v_rest := v_rest - v_overflow;
  v_added := v_returned - v_overflow;

  UPDATE public.inventory_lots
     SET qty = qty + v_folds, open_bottle_ml = v_rest::int, updated_at = now()
   WHERE id = v_lot.id;

  v_after := v_before + v_folds;

  IF v_folds > 0 THEN
    INSERT INTO public.inventory_transactions
      (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change, quantity_before, quantity_after,
       stock_type, performed_by_type, reason, metadata, transaction_date, idempotency_key)
    VALUES
      (v_restaurant, p_inventory_id, v_wine, 'return', 'pos'::public.inventory_transaction_source, v_folds, v_before, v_after,
       'live', 'system', 'POS void: by-the-glass pours returned',
       jsonb_build_object('pours', v_pours, 'pour_ml', v_sale.pour_ml, 'returned_ml', v_returned,
                          'added_ml', v_added, 'bottles_folded', v_folds, 'sale_key', p_sale_key,
                          'overflow_ml', v_overflow,
                          'overflow_reason', CASE WHEN v_overflow > 0 THEN 'void above container cap' END),
       -- ADR 0281: dated by the check, never after now.
       LEAST(COALESCE(p_occurred_at, now()), now()),
       p_idempotency_key)
    RETURNING id INTO v_txn;
    PERFORM public.stamp_lot_draws(v_txn, ARRAY[v_lot.id], ARRAY[-v_folds]);  -- a_glass_void_gives_back_its_cost
  END IF;

  INSERT INTO public.pour_events (restaurant_id, inventory_id, master_wine_id, pours, pour_ml, bottles_opened, location_id, source, performed_by, idempotency_key, returns_sale_key)
  VALUES (v_restaurant, p_inventory_id, v_wine, -v_pours, v_sale.pour_ml, -v_folds, NULL, 'pos', NULL, p_idempotency_key, p_sale_key)
  RETURNING id INTO v_event;

  RETURN jsonb_build_object(
    'pours', v_pours, 'pour_ml', v_sale.pour_ml, 'returned_ml', v_returned,
    'added_ml', v_added, 'bottles_folded', v_folds,
    'overflow_ml', v_overflow,
    'reason', CASE WHEN v_overflow > 0 THEN 'void above container cap' END,
    'txn', v_txn, 'pour_event', v_event);
END;
$$;

DO $$
BEGIN
  EXECUTE format('COMMENT ON FUNCTION public.return_glass_pour IS %L',
    coalesce(obj_description((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                               WHERE n.nspname = 'public' AND p.proname = 'return_glass_pour'), 'pg_proc') || ' ', '')
    || 'Changed by migration a_glass_void_gives_back_its_cost: every bottle it folds back is stamped as a lot draw (stamp_lot_draws), at that lot''s cost.');
END $$;

-- In-file assertions (structural; behaviour is in the paired test).
DO $$
DECLARE v_src text; v_n int; v_def boolean;
BEGIN
  SELECT count(*), max(p.prosrc), bool_or(p.prosecdef) INTO v_n, v_src, v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'return_glass_pour';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one public.return_glass_pour after a_glass_void_gives_back_its_cost, found %', v_n;
  END IF;
  IF position('PERFORM public.stamp_lot_draws(v_txn,' in v_src) = 0 THEN
    RAISE EXCEPTION 'public.return_glass_pour does not stamp its draws (a_glass_void_gives_back_its_cost)';
  END IF;
  IF v_def THEN
    RAISE EXCEPTION 'public.return_glass_pour must stay SECURITY INVOKER';
  END IF;
END $$;

COMMIT;
