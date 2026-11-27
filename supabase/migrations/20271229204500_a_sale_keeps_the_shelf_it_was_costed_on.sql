-- A sale keeps the shelf it was costed on, so every paper restates it exactly (r109 g1).
--
-- WHY. A pour is costed at the WAC of the live lots (DD-r104-10), but r102
-- restated the whole line to the oldest lot's one delivery, and never restated
-- a part-checked average (invoice_lot_wac_partial, pour_lot_wac_partial).
--
-- WHAT. At sale the gateway writes cost_parts, the live lots the cost was
-- read over (at most 20; past that cost_parts_capped, never restated, counted
-- in rows_capped). v2 replaces the checked order's part with the paper's cost,
-- recomputes WAC = sum(qty x cost) / sum(qty) and scales the cost first booked
-- (from the earliest restatement, so twice does not round twice). The basis
-- is invoice_restated once every part is invoiced, partly checked until then.
--
-- Invariant: once every part's order has a checked paper,
--   cost_at_sale = share x sum(qty_i x paper_cost_i) / sum(qty_i)
-- to 4 places, whatever order the papers were checked in. A part keeps its
-- own qty and cost, so a lot spent and deleted before its paper still
-- restates. A void (cost 0) is skipped. Two seals of different orders lock the
-- row (FOR UPDATE) and each replaces only its own part, so the result does not
-- depend on which seal wins the lock.
--
-- A row with no parts keeps the r102 rule and is never back-filled (D4).

ALTER TABLE public.wine_consumption_log
  ADD COLUMN IF NOT EXISTS cost_parts jsonb,
  ADD COLUMN IF NOT EXISTS cost_parts_capped boolean NOT NULL DEFAULT false;

ALTER TABLE public.wine_consumption_log
  DROP CONSTRAINT IF EXISTS wine_consumption_log_cost_parts_shape;
ALTER TABLE public.wine_consumption_log
  ADD CONSTRAINT wine_consumption_log_cost_parts_shape
  CHECK (cost_parts IS NULL
         OR (jsonb_typeof(cost_parts) = 'array'
             AND jsonb_array_length(cost_parts) BETWEEN 1 AND 20
             AND NOT cost_parts_capped));

COMMENT ON COLUMN public.wine_consumption_log.cost_parts IS
  'The live lots the sale''s unit cost was read over: [{order_id, lot_id, qty, unit_cost, invoiced}], at most 20. Each checked paper replaces its own order''s part and the sale is restated to the new WAC. Null = no parts (the r102 single-order rule applies).';
COMMENT ON COLUMN public.wine_consumption_log.cost_parts_capped IS
  'More than 20 live lots were on the shelf at sale, so no parts were kept and this row is never restated.';

CREATE OR REPLACE FUNCTION public.restate_sale_cost(
  p_restaurant_id uuid,
  p_inventory_id uuid,
  p_source_order_id uuid,
  p_unit_cost numeric,
  p_performed_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row record;
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
  IF p_unit_cost IS NULL OR p_unit_cost <= 0 THEN
    RAISE EXCEPTION 'restate_sale_cost: p_unit_cost must be above zero (an unknown cost restates nothing)'
      USING ERRCODE = '22023';
  END IF;
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
    SELECT id, cost_at_sale, cost_basis, cost_unit_at_sale
      FROM public.wine_consumption_log
     WHERE restaurant_id = p_restaurant_id
       AND inventory_id = p_inventory_id
       AND cost_source_order_id = p_source_order_id
       AND cost_parts IS NULL
       AND NOT cost_parts_capped
       AND cost_basis IN ('last_purchase_price', 'invoice_restated')
       AND cost_at_sale > 0
       AND cost_unit_at_sale > 0
       AND cost_unit_at_sale IS DISTINCT FROM p_unit_cost
     ORDER BY recorded_at, id
       FOR UPDATE
  LOOP
    v_new := round(v_row.cost_at_sale * p_unit_cost / v_row.cost_unit_at_sale, 4);
    INSERT INTO public.wine_consumption_cost_restatements
      (restaurant_id, inventory_id, consumption_id, source_order_id,
       prior_cost_at_sale, prior_cost_basis, prior_unit_cost,
       new_cost_at_sale, new_unit_cost, performed_by)
    VALUES
      (p_restaurant_id, p_inventory_id, v_row.id, p_source_order_id,
       v_row.cost_at_sale, v_row.cost_basis, v_row.cost_unit_at_sale,
       v_new, p_unit_cost, p_performed_by);
    UPDATE public.wine_consumption_log
       SET cost_at_sale = v_new,
           cost_unit_at_sale = p_unit_cost,
           cost_basis = 'invoice_restated'
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
       AND cost_parts @> jsonb_build_array(jsonb_build_object('order_id', p_source_order_id::text))
       AND cost_basis IN ('last_purchase_price', 'invoice_lot_wac', 'invoice_lot_wac_partial',
                          'pour_lot_wac', 'pour_lot_wac_partial', 'invoice_restated')
       AND cost_at_sale > 0
       AND cost_unit_at_sale > 0
     ORDER BY recorded_at, id
       FOR UPDATE
  LOOP
    SELECT jsonb_agg(
             CASE WHEN t.e->>'order_id' = p_source_order_id::text
                  THEN t.e || jsonb_build_object('unit_cost', p_unit_cost, 'invoiced', true)
                  ELSE t.e END
             ORDER BY t.ord),
           sum((t.e->>'qty')::numeric),
           sum((t.e->>'qty')::numeric *
               CASE WHEN t.e->>'order_id' = p_source_order_id::text
                    THEN p_unit_cost ELSE (t.e->>'unit_cost')::numeric END),
           bool_and(t.e->>'order_id' = p_source_order_id::text
                    OR coalesce((t.e->>'invoiced')::boolean, false))
      INTO v_parts, v_qty, v_cost, v_all_invoiced
      FROM jsonb_array_elements(v_row.cost_parts) WITH ORDINALITY AS t(e, ord);

    -- The same paper at the same cost again changes nothing.
    CONTINUE WHEN v_parts = v_row.cost_parts;
    CONTINUE WHEN v_qty IS NULL OR v_qty <= 0;
    v_wac := v_cost / v_qty;

    -- What the sale was first booked at, so a second restatement scales the
    -- original figure, not a rounded one (events use clock_timestamp()).
    SELECT prior_cost_at_sale, prior_unit_cost
      INTO v_base_cost, v_base_unit
      FROM public.wine_consumption_cost_restatements
     WHERE consumption_id = v_row.id
     ORDER BY created_at, id
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
       new_cost_at_sale, new_unit_cost, performed_by, created_at)
    VALUES
      (p_restaurant_id, p_inventory_id, v_row.id, p_source_order_id,
       v_row.cost_at_sale, v_row.cost_basis, v_row.cost_unit_at_sale,
       v_new, round(v_wac, 6), p_performed_by, clock_timestamp());
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
  'After a verified invoice, restate the cost of sales from that delivery. A row with cost_parts has this order''s part replaced by the paper''s cost and is restated to the new WAC over its parts (r109); a row without parts keeps the r102 single-order rule. Capped rows are never restated and are counted in rows_capped. Writes before/after to wine_consumption_cost_restatements. Idempotent.';

REVOKE ALL ON FUNCTION public.restate_sale_cost(uuid, uuid, uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restate_sale_cost(uuid, uuid, uuid, numeric, uuid) TO service_role;
