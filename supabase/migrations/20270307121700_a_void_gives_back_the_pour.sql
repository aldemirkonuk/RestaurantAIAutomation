-- A void gives back what was poured (G11; B19 superseded, ADR 0011 amendment
-- 2026-11-07). A glass void used to return a sealed bottle per glass. This
-- returns least(p_pours, sale.pours) * sale.pour_ml, read from the sale's own
-- pour_events row, to the open container; full bottles fold back (never more
-- than the sale opened); above one bottle is named overflow_ml, not added.

BEGIN;

CREATE FUNCTION public.return_glass_pour(
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
  v_existing uuid; v_sale record; v_pours int;
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

  -- A replay moves nothing, nor does a void the old path booked under this key.
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
    RETURN jsonb_build_object('returned_ml', 0, 'reason', 'no sale pour found');
  END IF;

  v_pours := LEAST(p_pours, v_sale.pours);
  v_returned := v_pours::bigint * v_sale.pour_ml;

  PERFORM 1 FROM public.inventory_lots
    WHERE inventory_id = p_inventory_id AND stock_state = 'live' FOR UPDATE;
  v_before := (SELECT COALESCE(SUM(qty), 0) FROM public.inventory_lots
                WHERE inventory_id = p_inventory_id AND stock_state = 'live');

  -- The open container ADR 0285's draw last touched; else the lot it last touched.
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

  -- Fold full bottles back, never more than the sale opened; cap at one bottle.
  v_total := v_lot.open_bottle_ml::bigint + v_returned;
  v_folds := LEAST(v_total / v_bottle_ml, GREATEST(v_sale.bottles_opened, 0)::bigint)::int;
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
       -- ADR 0281: dated by the check, never later than now.
       LEAST(COALESCE(p_occurred_at, now()), now()),
       p_idempotency_key)
    RETURNING id INTO v_txn;
  END IF;

  INSERT INTO public.pour_events (restaurant_id, inventory_id, master_wine_id, pours, pour_ml, bottles_opened, location_id, source, performed_by, idempotency_key)
  VALUES (v_restaurant, p_inventory_id, v_wine, -v_pours, v_sale.pour_ml, -v_folds, NULL, 'pos', NULL, p_idempotency_key)
  RETURNING id INTO v_event;

  RETURN jsonb_build_object(
    'pours', v_pours, 'pour_ml', v_sale.pour_ml, 'returned_ml', v_returned,
    'added_ml', v_added, 'bottles_folded', v_folds,
    'overflow_ml', v_overflow,
    'reason', CASE WHEN v_overflow > 0 THEN 'void above container cap' END,
    'txn', v_txn, 'pour_event', v_event);
END;
$$;

COMMENT ON FUNCTION public.return_glass_pour IS
  'Reverses a by-the-glass sale on its void, by the ml the sale''s own pour took. '
  'Supersedes B19 (ADR 0011 amendment 2026-11-07); migration a_void_gives_back_the_pour.';

COMMIT;
