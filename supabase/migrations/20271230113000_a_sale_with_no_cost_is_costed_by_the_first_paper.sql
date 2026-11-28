-- A sale that sold with no cost is costed by the first checked paper for its good (r110 invoices-g3).
--
-- WHY. snapshotLineCost writes an all-null snapshot when the house had no cost
-- for the good at the till (NO_COST_SNAPSHOT), and both restate_sale_cost
-- loops require cost_at_sale > 0, so nothing ever costed that row: its check
-- read 'cost not kept' for good. NetSuite's underwater-inventory rule: the
-- estimate is settled when the receipt posts.
--
-- WHAT.
--  - cost_share numeric(14,6): the row's share of one bottle, written at sale
--    on EVERY new row, costed or not: qty for whole bottles, volume_ml /
--    bottle_ml for a pour, null when the bottle size is unknown.
--  - cost_unpriced_sales(house, item, order, unit cost, by): every row of this
--    house and item with cost_at_sale IS NULL and cost_share > 0, not voided,
--    is costed at round(cost_share x unit cost, 4) under the basis
--    'costed_after_sale', naming the order, with a restatement row whose prior
--    is null. Rows lock FOR UPDATE and the UPDATE re-checks IS NULL, so two
--    seals at once cost a row once: the first seal wins.
--  - restate_sale_cost rule 1 also takes 'costed_after_sale', so a correction
--    of that paper re-costs the row from its share and keeps the word. That
--    function is rebuilt in 20280115100100, on the 6-argument body of
--    20280115100000 (#2532): a second CREATE OR REPLACE here would have made a
--    5-argument twin that is ambiguous with it (42725) or erased by it.
--
-- Invariant: a costed_after_sale row has cost_at_sale = round(cost_share x u,
-- 4), u the per-bottle landed cost of cost_source_order_id's checked paper.
--
-- Not: a backfill of rows booked before cost_share existed (D4: their share
-- was never kept and is not guessed); a costing on read (it would let a later
-- paper move a closed check, which D4 forbids). Earliest-received was
-- rejected for first-sealed: a later-sealed earlier delivery would re-cost a
-- row already costed and chain the re-costs. There is no period close in the
-- schema to bound by, so none is applied here (stated in the PR).

ALTER TABLE public.wine_consumption_log
  ADD COLUMN IF NOT EXISTS cost_share numeric(14,6);
COMMENT ON COLUMN public.wine_consumption_log.cost_share IS
  'The row''s share of one bottle, kept at sale whether or not it was costed: qty for whole bottles, volume_ml / bottle_ml for a pour. Null = the bottle size was not known, or the row predates r110.';

ALTER TABLE public.wine_consumption_log
  DROP CONSTRAINT IF EXISTS wine_consumption_log_cost_basis_check;
ALTER TABLE public.wine_consumption_log
  ADD CONSTRAINT wine_consumption_log_cost_basis_check
  CHECK (cost_basis IS NULL OR cost_basis IN
    ('invoice_lot_wac', 'invoice_lot_wac_partial', 'last_purchase_price', 'invoice_restated',
     'pour_lot_wac', 'pour_lot_wac_partial', 'costed_after_sale'));

-- A row costed after its sale had no prior cost: the audit row says null.
ALTER TABLE public.wine_consumption_cost_restatements
  ALTER COLUMN prior_cost_at_sale DROP NOT NULL,
  ALTER COLUMN prior_cost_basis DROP NOT NULL,
  ALTER COLUMN prior_unit_cost DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.cost_unpriced_sales(
  p_restaurant_id uuid,
  p_inventory_id uuid,
  p_order_id uuid,
  p_unit_cost numeric,
  p_performed_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row record;
  v_new numeric(12,4);
  v_rows int := 0;
  v_cost numeric := 0;
BEGIN
  IF p_unit_cost IS NULL OR p_unit_cost <= 0 THEN
    RAISE EXCEPTION 'cost_unpriced_sales: p_unit_cost must be above zero (an unknown cost costs nothing)'
      USING ERRCODE = '22023';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'cost_unpriced_sales: p_order_id is required; a cost names the paper it came from'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.restaurant_inventory
                  WHERE id = p_inventory_id AND restaurant_id = p_restaurant_id) THEN
    RAISE EXCEPTION 'cost_unpriced_sales: item % is not this house''s', p_inventory_id
      USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    SELECT id, cost_share
      FROM public.wine_consumption_log
     WHERE restaurant_id = p_restaurant_id
       AND inventory_id = p_inventory_id
       AND cost_at_sale IS NULL
       AND cost_share > 0
       -- a voided line keeps quantity 0 and volume 0 (DD-r57): it sold nothing
       AND NOT (coalesce(quantity, 0) = 0 AND coalesce(volume_ml, 0) = 0)
     ORDER BY recorded_at, id
       FOR UPDATE
  LOOP
    v_new := round(v_row.cost_share * p_unit_cost, 4);
    -- Re-check under the lock: a seal that took the row first has costed it.
    UPDATE public.wine_consumption_log
       SET cost_at_sale = v_new,
           cost_unit_at_sale = p_unit_cost,
           cost_source_order_id = p_order_id,
           cost_basis = 'costed_after_sale'
     WHERE id = v_row.id
       AND cost_at_sale IS NULL;
    CONTINUE WHEN NOT FOUND;
    INSERT INTO public.wine_consumption_cost_restatements
      (restaurant_id, inventory_id, consumption_id, source_order_id,
       prior_cost_at_sale, prior_cost_basis, prior_unit_cost,
       new_cost_at_sale, new_unit_cost, performed_by)
    VALUES
      (p_restaurant_id, p_inventory_id, v_row.id, p_order_id,
       NULL, NULL, NULL, v_new, p_unit_cost, p_performed_by);
    v_rows := v_rows + 1;
    v_cost := v_cost + v_new;
  END LOOP;

  RETURN jsonb_build_object('rows_costed', v_rows, 'cost_added', v_cost);
END;
$$;

COMMENT ON FUNCTION public.cost_unpriced_sales IS
  'After a verified paper, cost the sales of its good that sold with no cost: cost_at_sale = round(cost_share x p_unit_cost, 4), basis costed_after_sale, naming the order, with a restatement row whose prior is null. First seal wins; a costed row is never re-costed here. 42501 for another house''s item.';

REVOKE ALL ON FUNCTION public.cost_unpriced_sales(uuid, uuid, uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cost_unpriced_sales(uuid, uuid, uuid, numeric, uuid) TO service_role;
