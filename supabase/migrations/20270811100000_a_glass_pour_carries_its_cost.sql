-- ===========================================================================
-- a_glass_pour_carries_its_cost: a bottle opened for glasses at a table
-- carries its lot's cost onto the ledger (1 of 2; the glass void is 2 of 2)
-- ===========================================================================
--
-- WHAT WAS WRONG (cost-math lane 2.2 left it open; the owner contract in
-- .planning/tech-debt.d/2026-11-07-a-void-gives-back-its-cost.md). Since
-- a_sale_carries_its_cost every bottle apply_stock_movement takes from a lot
-- writes an inventory_lot_draws row and stamps the ledger row's cost_total /
-- unpriced_qty. record_glass_pour moves its lots itself, so a bottle opened
-- for a glass left its lot with no draw: cost_total and unpriced_qty stayed
-- NULL, pos_cost_of_goods counted the row as unstamped, and every house that
-- sells wine by the glass saw its cost of goods withheld for good.
--
-- WHAT THIS DOES. record_glass_pour is re-created with
-- one_pour_size_for_the_house's body byte for byte, plus the three lines
-- marked "-- a_glass_pour_carries_its_cost": it collects (lot, bottles) for
-- every sealed bottle it opens and, after its one ledger row, calls
-- stamp_lot_draws: one draw per lot, at the lot's cost then. A glass from a
-- bottle already open writes no draw: its cost left when the bottle was
-- opened (proposal F10; ADR 0298 "glass pours as the bottles they opened").
-- Same signature, so no overload; grants and the comment are kept.
--
-- MERGE ORDER. After a_void_gives_back_its_cost (stamp_lot_draws) and
-- one_pour_size_for_the_house. The guard below refuses to run before them,
-- so a wrong order fails in CI, not in a house. The CLAIMS row
-- A-GLASS-POUR-CARRIES-ITS-COST fails the build if the copied body drifts
-- from its source migration.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.stamp_lot_draws(uuid, uuid[], integer[])') IS NULL THEN
    RAISE EXCEPTION 'a_glass_pour_carries_its_cost needs stamp_lot_draws (migration a_void_gives_back_its_cost) first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'record_glass_pour'
                    AND position('r.pour_size_confirmed_at IS NOT NULL' in p.prosrc) > 0) THEN
    RAISE EXCEPTION 'a_glass_pour_carries_its_cost needs record_glass_pour from one_pour_size_for_the_house first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_glass_pour(
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
  v_draw_lot uuid[] := '{}'; v_draw_qty int[] := '{}';  -- a_glass_pour_carries_its_cost
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
      IF v_n > 0 THEN v_draw_lot := v_draw_lot || v_lot.id; v_draw_qty := v_draw_qty || v_n; END IF;  -- a_glass_pour_carries_its_cost
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
    PERFORM public.stamp_lot_draws(v_txn, v_draw_lot, v_draw_qty);  -- a_glass_pour_carries_its_cost
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

DO $$
BEGIN
  EXECUTE format('COMMENT ON FUNCTION public.record_glass_pour IS %L',
    coalesce(obj_description((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                               WHERE n.nspname = 'public' AND p.proname = 'record_glass_pour'), 'pg_proc') || ' ', '')
    || 'Changed by migration a_glass_pour_carries_its_cost: every bottle it opens is stamped as a lot draw (stamp_lot_draws), at that lot''s cost.');
END $$;

-- In-file assertions (structural; behaviour is in the paired test).
DO $$
DECLARE v_src text; v_n int; v_def boolean;
BEGIN
  SELECT count(*), max(p.prosrc), bool_or(p.prosecdef) INTO v_n, v_src, v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_glass_pour';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one public.record_glass_pour after a_glass_pour_carries_its_cost, found %', v_n;
  END IF;
  IF position('PERFORM public.stamp_lot_draws(v_txn,' in v_src) = 0 THEN
    RAISE EXCEPTION 'public.record_glass_pour does not stamp its draws (a_glass_pour_carries_its_cost)';
  END IF;
  IF v_def THEN
    RAISE EXCEPTION 'public.record_glass_pour must stay SECURITY INVOKER';
  END IF;
END $$;

COMMIT;
