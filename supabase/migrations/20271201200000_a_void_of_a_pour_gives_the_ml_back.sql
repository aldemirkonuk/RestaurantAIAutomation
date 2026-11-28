-- r57 table side, decision D1: a void of a pour returns the poured ml.
--
-- WHY. A by-the-glass sale draws ml through record_glass_pour: it finishes the
-- open bottle and opens sealed ones. A void of that sale used to go through
-- apply_stock_movement with the sale's whole-unit count, so voiding five
-- 150 ml glasses put five WHOLE bottles (3,750 ml) back on the shelf, and a
-- void of half a glass could put none of it back. The shelf read high after a
-- void and the count was out by bottles.
--
-- WHAT. return_glass_pour is the reverse of record_glass_pour. It adds
-- p_pours * p_pour_ml back to an open bottle and rolls a whole bottle only
-- when the open ml reaches a bottle. The ml are conserved: a pour and its
-- return leave the item's lots as they were (open ml and whole bottles
-- together). It names the house, like apply_stock_movement (ADR 0141), and
-- refuses an item that is not that house's. It is keyed: a replayed void
-- returns nothing a second time.
--
-- WHERE the ml go. The oldest live lot already holding an open bottle (that is
-- where record_glass_pour drew from first); with no open bottle, the oldest
-- live lot, which then holds the returned ml as its open bottle. An item with
-- no live lot at all raises and moves nothing: the caller says so.
--
-- Records: a pour_events row with negative pours and negative bottles_opened
-- (a return), and, only when a whole bottle rolled back, one 'return' ledger
-- row of +bottles, dated by the check like the sale.
--
-- Additive: a new function, no existing function changes. Structural proof is
-- the DO block at the foot; behaviour is
-- supabase/tests/20271201200000_a_void_of_a_pour_gives_the_ml_back_test.sql.

CREATE FUNCTION public.return_glass_pour(
    p_inventory_id uuid,
    p_pours integer DEFAULT 1,
    p_pour_ml integer DEFAULT NULL::integer,
    p_restaurant_id uuid DEFAULT NULL::uuid,
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
  v_lot_id uuid; v_lot_open int;
  v_back bigint; v_total bigint; v_n int; v_rem int;
  v_before int; v_after int; v_txn uuid; v_existing uuid;
BEGIN
  IF p_pours IS NULL THEN
    RAISE EXCEPTION 'a return needs a count of glasses (got null) on inventory %', p_inventory_id
      USING ERRCODE = '22004';
  END IF;
  IF p_pours <= 0 THEN RETURN jsonb_build_object('returned', 0); END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.pour_events WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('idempotent', true, 'pour_event', v_existing); END IF;
  END IF;

  SELECT ri.restaurant_id, ri.master_wine_id, COALESCE(ri.bottle_size_ml, 750),
         COALESCE(p_pour_ml, ri.pour_size_ml, 150)
    INTO v_restaurant, v_wine, v_bottle_ml, v_pour_ml
    FROM public.restaurant_inventory ri WHERE ri.id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL THEN RAISE EXCEPTION 'inventory % not found', p_inventory_id; END IF;

  -- ADR 0141: the house the caller names must be the item's own.
  IF p_restaurant_id IS NOT NULL AND v_restaurant <> p_restaurant_id THEN
    RAISE EXCEPTION
      'return_glass_pour: item % is not an item of restaurant %, so no stock was moved and no ledger row was written.',
      p_inventory_id, p_restaurant_id
      USING ERRCODE = '42501';
  END IF;

  IF v_pour_ml <= 0 THEN
    RAISE EXCEPTION 'a return must be more than 0 ml (got %) on inventory %', v_pour_ml, p_inventory_id
      USING ERRCODE = '22023';
  END IF;
  IF v_bottle_ml <= 0 THEN
    RAISE EXCEPTION 'a bottle must hold more than 0 ml (got %) on inventory %', v_bottle_ml, p_inventory_id
      USING ERRCODE = '22023';
  END IF;

  v_back := p_pours::bigint * v_pour_ml;

  -- Lock the live lots, then pick the one the ml go back into.
  PERFORM 1 FROM public.inventory_lots
    WHERE inventory_id = p_inventory_id AND stock_state = 'live' FOR UPDATE;
  SELECT COALESCE(SUM(qty), 0) INTO v_before
    FROM public.inventory_lots WHERE inventory_id = p_inventory_id AND stock_state = 'live';

  SELECT id, open_bottle_ml INTO v_lot_id, v_lot_open
    FROM public.inventory_lots
   WHERE inventory_id = p_inventory_id AND stock_state = 'live'
   ORDER BY (open_bottle_ml > 0) DESC,
            (p_location_id IS NOT NULL AND location_id IS NOT DISTINCT FROM p_location_id) DESC,
            received_at ASC, created_at ASC, id ASC
   LIMIT 1;
  IF v_lot_id IS NULL THEN
    RAISE EXCEPTION 'no live lot to return the pour to for inventory %', p_inventory_id;
  END IF;

  -- The open ml and the returned ml together; every whole bottle's worth rolls
  -- into qty, the rest stays the open bottle. Total ml is conserved.
  v_total := v_lot_open::bigint + v_back;
  v_n := (v_total / v_bottle_ml)::int;
  v_rem := (v_total % v_bottle_ml)::int;
  UPDATE public.inventory_lots
     SET qty = qty + v_n, open_bottle_ml = v_rem, updated_at = now()
   WHERE id = v_lot_id;

  v_after := v_before + v_n;

  IF v_n > 0 THEN
    INSERT INTO public.inventory_transactions
      (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change, quantity_before, quantity_after,
       stock_type, performed_by, performed_by_type, reason, metadata, transaction_date)
    VALUES
      (v_restaurant, p_inventory_id, v_wine, 'return', p_source::public.inventory_transaction_source, v_n, v_before, v_after,
       'live', p_performed_by, CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
       COALESCE(p_reason, 'by-the-glass pours returned'),
       jsonb_build_object('pours', p_pours, 'pour_ml', v_pour_ml, 'bottles_restored', v_n),
       LEAST(COALESCE(p_occurred_at, now()), now()))
    RETURNING id INTO v_txn;
  END IF;

  INSERT INTO public.pour_events (restaurant_id, inventory_id, master_wine_id, pours, pour_ml, bottles_opened, location_id, source, performed_by, idempotency_key)
  VALUES (v_restaurant, p_inventory_id, v_wine, -p_pours, v_pour_ml, -v_n, p_location_id, p_source, p_performed_by, p_idempotency_key);

  RETURN jsonb_build_object(
    'returned_pours', p_pours, 'pour_ml', v_pour_ml, 'bottles_restored', v_n,
    'sealed_now', v_after,
    'open_ml_now', (SELECT COALESCE(SUM(open_bottle_ml), 0) FROM public.inventory_lots
                     WHERE inventory_id = p_inventory_id AND stock_state = 'live'),
    'txn', v_txn);
END;
$$;

COMMENT ON FUNCTION public.return_glass_pour IS
  'The reverse of record_glass_pour (r57 D1). Adds p_pours * p_pour_ml back to '
  'the oldest live lot holding an open bottle (else the oldest live lot) and '
  'rolls a whole bottle into qty only when the open ml reach a bottle. Total '
  'ml are conserved. Names the house and refuses an item that is not its own '
  '(42501). Keyed by p_idempotency_key through pour_events, where it writes '
  'negative pours. A return that rolls a bottle writes one return ledger row. '
  'No live lot raises and moves nothing.';

REVOKE ALL ON FUNCTION public.return_glass_pour(uuid, integer, integer, uuid, uuid, text, uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.return_glass_pour(uuid, integer, integer, uuid, uuid, text, uuid, text, text, timestamptz) TO service_role;

DO $$
DECLARE v_count int; v_src text;
BEGIN
  SELECT count(*) INTO v_count FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'return_glass_pour';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one public.return_glass_pour, found %', v_count;
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'return_glass_pour';
  IF position('v_total % v_bottle_ml' in v_src) = 0 OR position('v_lot_open::bigint + v_back' in v_src) = 0 THEN
    RAISE EXCEPTION 'return_glass_pour does not roll whole bottles by ml';
  END IF;
  IF has_function_privilege('authenticated', 'public.return_glass_pour(uuid, integer, integer, uuid, uuid, text, uuid, text, text, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'return_glass_pour must not be callable by authenticated';
  END IF;
  IF has_function_privilege('anon', 'public.return_glass_pour(uuid, integer, integer, uuid, uuid, text, uuid, text, text, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'return_glass_pour must not be callable by anon';
  END IF;
END $$;
