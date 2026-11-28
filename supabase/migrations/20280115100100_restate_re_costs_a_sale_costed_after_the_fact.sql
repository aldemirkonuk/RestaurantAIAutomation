-- restate_sale_cost also re-costs a sale costed after the fact (r110 invoices-g3 fixer).
--
-- WHY. 20271230113000 (#2665) added 'costed_after_sale' to restate_sale_cost by
-- re-creating the whole 5-argument function, while 20280115100000 (#2532) drops
-- that form and creates the 6-argument one without the basis. The two PRs touch
-- different files, so a merge shows no clash, but the result depends on order:
-- 2665 then 2532 leaves a function that never re-costs a sale costed after the
-- fact; 2532 then 2665 leaves two overloads and every 5-argument call fails
-- with 42725 (not unique).
--
-- WHAT. One function, the 6-argument body of 20280115100000 (its p_delivery_id,
-- #2507's free-line and six-place rules) with rule 1 taking 'costed_after_sale'
-- (re-costed from the row's share, word kept). The 5-argument form is dropped
-- if it is still there, and a call with the five named arguments resolves to
-- this one through the DEFAULT. Land 20280115100000 first.

DROP FUNCTION IF EXISTS public.restate_sale_cost(uuid, uuid, uuid, numeric, uuid);

CREATE OR REPLACE FUNCTION public.restate_sale_cost(
  p_restaurant_id uuid,
  p_inventory_id uuid,
  p_source_order_id uuid,
  p_unit_cost numeric,
  p_performed_by uuid DEFAULT NULL,
  p_delivery_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row record;
  v_unit numeric(14,6);
  v_new numeric(12,4);
  v_rows int := 0;
  v_capped int := 0;
  v_before numeric := 0;
  v_after numeric := 0;
  v_parts jsonb;
  v_qty numeric;
  v_cost numeric;
  v_all_invoiced boolean;
  v_wac numeric;
  v_base_cost numeric;
  v_base_unit numeric;
  v_basis text;
BEGIN
  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN
    RAISE EXCEPTION 'restate_sale_cost: p_unit_cost must not be negative or unknown (an unknown cost restates nothing)'
      USING ERRCODE = '22023';
  END IF;
  -- A free line (0) is a real cost (#2507); compare and write the unit at the
  -- column's own scale so a retry restates nothing.
  v_unit := round(p_unit_cost, 6);
  IF p_source_order_id IS NULL THEN
    RAISE EXCEPTION 'restate_sale_cost: p_source_order_id is required; a restatement names the delivery it follows'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.restaurant_inventory
                  WHERE id = p_inventory_id AND restaurant_id = p_restaurant_id) THEN
    RAISE EXCEPTION 'restate_sale_cost: item % is not this house''s', p_inventory_id
      USING ERRCODE = '42501';
  END IF;

  -- 1. No parts: the r102 single-order rule, unchanged.
  FOR v_row IN
    SELECT id, cost_at_sale, cost_basis, cost_unit_at_sale, cost_share
      FROM public.wine_consumption_log
     WHERE restaurant_id = p_restaurant_id
       AND inventory_id = p_inventory_id
       AND cost_source_order_id = p_source_order_id
       AND cost_parts IS NULL
       AND NOT cost_parts_capped
       AND cost_basis IN ('last_purchase_price', 'invoice_restated', 'costed_after_sale')
       AND cost_at_sale > 0
       AND cost_unit_at_sale > 0
       AND cost_unit_at_sale IS DISTINCT FROM v_unit
     ORDER BY recorded_at, id
       FOR UPDATE
  LOOP
    -- A row costed after its sale re-costs from its share, exactly, and keeps
    -- its word: it is still a figure from a paper checked after the sale.
    v_new := CASE
      WHEN v_row.cost_basis = 'costed_after_sale' AND v_row.cost_share > 0
        THEN round(v_row.cost_share * v_unit, 4)
      ELSE round(v_row.cost_at_sale * v_unit / v_row.cost_unit_at_sale, 4)
    END;
    INSERT INTO public.wine_consumption_cost_restatements
      (restaurant_id, inventory_id, consumption_id, source_order_id,
       prior_cost_at_sale, prior_cost_basis, prior_unit_cost,
       new_cost_at_sale, new_unit_cost, performed_by)
    VALUES
      (p_restaurant_id, p_inventory_id, v_row.id, p_source_order_id,
       v_row.cost_at_sale, v_row.cost_basis, v_row.cost_unit_at_sale,
       v_new, v_unit, p_performed_by);
    UPDATE public.wine_consumption_log
       SET cost_at_sale = v_new,
           cost_unit_at_sale = v_unit,
           cost_basis = CASE WHEN v_row.cost_basis = 'costed_after_sale'
                             THEN 'costed_after_sale' ELSE 'invoice_restated' END
     WHERE id = v_row.id;
    v_rows := v_rows + 1;
    v_before := v_before + v_row.cost_at_sale;
    v_after := v_after + v_new;
  END LOOP;

  -- 2. Parts: replace this order's part, restate to the shelf's new WAC.
  FOR v_row IN
    SELECT id, cost_at_sale, cost_basis, cost_unit_at_sale, cost_parts
      FROM public.wine_consumption_log
     WHERE restaurant_id = p_restaurant_id
       AND inventory_id = p_inventory_id
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(cost_parts) AS p(e)
                    WHERE p.e->>'order_id' = p_source_order_id::text
                      AND (p_delivery_id IS NULL OR p.e->>'delivery_id' IS NULL
                           OR p.e->>'delivery_id' = p_delivery_id::text))
       AND cost_basis IN ('last_purchase_price', 'invoice_lot_wac', 'invoice_lot_wac_partial',
                          'pour_lot_wac', 'pour_lot_wac_partial', 'invoice_restated')
       AND cost_at_sale > 0
       AND cost_unit_at_sale > 0
     ORDER BY recorded_at, id
       FOR UPDATE
  LOOP
    SELECT jsonb_agg(
             CASE WHEN m.hit
                  THEN t.e || jsonb_build_object('unit_cost', v_unit, 'invoiced', true)
                  ELSE t.e END
             ORDER BY t.ord),
           sum((t.e->>'qty')::numeric),
           sum((t.e->>'qty')::numeric *
               CASE WHEN m.hit THEN v_unit ELSE (t.e->>'unit_cost')::numeric END),
           bool_and(m.hit OR coalesce((t.e->>'invoiced')::boolean, false))
      INTO v_parts, v_qty, v_cost, v_all_invoiced
      FROM jsonb_array_elements(v_row.cost_parts) WITH ORDINALITY AS t(e, ord)
     CROSS JOIN LATERAL (SELECT t.e->>'order_id' = p_source_order_id::text
                                AND (p_delivery_id IS NULL OR t.e->>'delivery_id' IS NULL
                                     OR t.e->>'delivery_id' = p_delivery_id::text) AS hit) AS m;

    CONTINUE WHEN v_parts = v_row.cost_parts;
    CONTINUE WHEN v_qty IS NULL OR v_qty <= 0;
    v_wac := v_cost / v_qty;

    -- What the sale was first booked at, so a second restatement scales the
    -- original figure. One act shares one created_at (#2248 groups on it), so
    -- within a stamp the head of the chain is the event nothing restated into.
    SELECT r.prior_cost_at_sale, r.prior_unit_cost
      INTO v_base_cost, v_base_unit
      FROM public.wine_consumption_cost_restatements r
     WHERE r.consumption_id = v_row.id
     ORDER BY r.created_at,
              EXISTS (SELECT 1 FROM public.wine_consumption_cost_restatements q
                       WHERE q.consumption_id = r.consumption_id AND q.id <> r.id
                         AND q.created_at = r.created_at
                         AND q.new_cost_at_sale = r.prior_cost_at_sale
                         AND q.new_unit_cost = r.prior_unit_cost),
              r.id
     LIMIT 1;
    IF NOT FOUND OR v_base_unit IS NULL OR v_base_unit <= 0 THEN
      v_base_cost := v_row.cost_at_sale;
      v_base_unit := v_row.cost_unit_at_sale;
    END IF;

    v_new := round(v_base_cost * v_wac / v_base_unit, 4);
    v_basis := CASE
      WHEN v_all_invoiced THEN 'invoice_restated'
      WHEN v_row.cost_basis LIKE 'pour\_%' THEN 'pour_lot_wac_partial'
      ELSE 'invoice_lot_wac_partial'
    END;

    INSERT INTO public.wine_consumption_cost_restatements
      (restaurant_id, inventory_id, consumption_id, source_order_id,
       prior_cost_at_sale, prior_cost_basis, prior_unit_cost,
       new_cost_at_sale, new_unit_cost, performed_by)
    VALUES
      (p_restaurant_id, p_inventory_id, v_row.id, p_source_order_id,
       v_row.cost_at_sale, v_row.cost_basis, v_row.cost_unit_at_sale,
       v_new, round(v_wac, 6), p_performed_by);
    UPDATE public.wine_consumption_log
       SET cost_at_sale = v_new,
           cost_unit_at_sale = round(v_wac, 6),
           cost_basis = v_basis,
           cost_parts = v_parts
     WHERE id = v_row.id;
    v_rows := v_rows + 1;
    v_before := v_before + v_row.cost_at_sale;
    v_after := v_after + v_new;
  END LOOP;

  -- 3. Capped rows of this item: never restated, and counted so it is said.
  SELECT count(*) INTO v_capped
    FROM public.wine_consumption_log
   WHERE restaurant_id = p_restaurant_id
     AND inventory_id = p_inventory_id
     AND cost_parts_capped
     AND cost_at_sale > 0;

  RETURN jsonb_build_object('rows_restated', v_rows, 'rows_capped', v_capped,
                            'cost_before', v_before, 'cost_after', v_after);
END;
$$;

COMMENT ON FUNCTION public.restate_sale_cost IS
  'After a verified invoice, restate the cost of sales from that delivery. A row with cost_parts has this order''s part replaced by the paper''s cost and is restated to the new WAC over its parts (r109); a row without parts keeps the r102 single-order rule, and a costed_after_sale row re-costs from its share and keeps its basis (r110). Capped rows are never restated and are counted in rows_capped. Writes before/after to wine_consumption_cost_restatements. Idempotent. With p_delivery_id only the parts that delivery booked are replaced (one order can arrive as two deliveries, each with its own paper); without it every part of the order is.';

REVOKE ALL ON FUNCTION public.restate_sale_cost(uuid, uuid, uuid, numeric, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restate_sale_cost(uuid, uuid, uuid, numeric, uuid, uuid) TO service_role;
