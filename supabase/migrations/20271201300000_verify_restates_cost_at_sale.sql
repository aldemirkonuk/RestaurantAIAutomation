-- A verified invoice restates what the sales from that delivery cost (r102).
--
-- WHY. A line costed at the delivery's estimate (basis last_purchase_price)
-- keeps that estimate forever: verifying the invoice revalues the lots
-- (revalue_lot) and nothing else, and a sale snapshot never reads a lot again
-- (r57 D4). So every pour sold between the delivery and the check of the
-- paper kept the guess, and cost of goods and margin stayed wrong for exactly
-- the sales made before the paper was checked.
--
-- WHAT. restate_sale_cost moves those rows, and only those, to the invoice's
-- unit cost: rows costed at the last price paid that name this delivery as
-- their source. A row costed on invoiced lots already (invoice_lot_wac) is not
-- touched: D4 still holds for it. The row's cost scales from the unit cost it
-- was sold at (cost_unit_at_sale) to the invoice's. Every move writes its
-- before and after to wine_consumption_cost_restatements first, and the row's
-- basis becomes invoice_restated, which the check reads out in words.
-- Idempotent: a row already at this unit cost is not a correction.

ALTER TABLE public.wine_consumption_log
  ADD COLUMN IF NOT EXISTS cost_unit_at_sale numeric(14,6);

COMMENT ON COLUMN public.wine_consumption_log.cost_unit_at_sale IS
  'The cost of one whole bottle the line was costed at when it sold. Lets a verified invoice restate cost_at_sale exactly. Null = cost not kept.';

ALTER TABLE public.wine_consumption_log
  DROP CONSTRAINT IF EXISTS wine_consumption_log_cost_basis_check;
ALTER TABLE public.wine_consumption_log
  ADD CONSTRAINT wine_consumption_log_cost_basis_check
  CHECK (cost_basis IS NULL OR cost_basis IN
    ('invoice_lot_wac', 'invoice_lot_wac_partial', 'last_purchase_price', 'invoice_restated'));

CREATE TABLE IF NOT EXISTS public.wine_consumption_cost_restatements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_id uuid NOT NULL,
  consumption_id uuid NOT NULL,
  source_order_id uuid NOT NULL,
  prior_cost_at_sale numeric(12,4) NOT NULL,
  prior_cost_basis text NOT NULL,
  prior_unit_cost numeric(14,6) NOT NULL,
  new_cost_at_sale numeric(12,4) NOT NULL,
  new_unit_cost numeric(14,6) NOT NULL,
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cost_restatements_consumption
  ON public.wine_consumption_cost_restatements (consumption_id, created_at DESC);
ALTER TABLE public.wine_consumption_cost_restatements ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.wine_consumption_cost_restatements IS
  'Append-only: the cost a sale kept before a verified invoice restated it, and after. Service role only.';

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
  v_before numeric := 0;
  v_after numeric := 0;
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

  FOR v_row IN
    SELECT id, cost_at_sale, cost_basis, cost_unit_at_sale
      FROM public.wine_consumption_log
     WHERE restaurant_id = p_restaurant_id
       AND inventory_id = p_inventory_id
       AND cost_source_order_id = p_source_order_id
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

  RETURN jsonb_build_object('rows_restated', v_rows, 'cost_before', v_before, 'cost_after', v_after);
END;
$$;

COMMENT ON FUNCTION public.restate_sale_cost IS
  'After a verified invoice, restate the cost of sales that were costed at the delivery''s estimate (basis last_purchase_price) and name this delivery. Writes before/after to wine_consumption_cost_restatements. Rows costed on invoiced lots are not touched. Idempotent.';

REVOKE ALL ON FUNCTION public.restate_sale_cost(uuid, uuid, uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restate_sale_cost(uuid, uuid, uuid, numeric, uuid) TO service_role;
