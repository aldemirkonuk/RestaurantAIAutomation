-- r109 (DD-r108-20): the database half of a correction re-cost. The gateway
-- (DeliveryStockService.recostAfterCorrection) posts the corrected paper's
-- cost through finalise_delivery_cost with the reason
-- 'correction revision n of document X', then restate_sale_cost when the
-- delivery has an order. This pins what those two calls do to a lot that is
-- ALREADY final (ADR 0103 QA 10a (6), amended: a corrected line revalues).
-- Self-asserting; synthetic fixtures; one transaction, rolled back.
-- Run on a database built from supabase/migrations (PGlite in r109, superuser).

begin;

do $$
declare
  h uuid := 'a0109000-0000-4000-8000-000000000001';
  w uuid := 'a0109000-0000-4000-8000-000000000101';
  inv uuid := 'a0109000-0000-4000-8000-000000000201';
  d_none uuid := 'a0109000-0000-4000-8000-000000000501';
  d_ord uuid := 'a0109000-0000-4000-8000-000000000502';
  ord uuid := 'a0109000-0000-4000-8000-000000000301';
  lot_live uuid := 'a0109000-0000-4000-8000-000000000601';
  lot_drawn uuid := 'a0109000-0000-4000-8000-000000000602';
  lot_ord uuid := 'a0109000-0000-4000-8000-000000000603';
  why text := 'correction revision 2 of document a0109000-0000-4000-8000-000000000701';
  r jsonb;
  c numeric;
begin
  insert into public.restaurants (id, name, slug) values (h, 'CR test house', 'cr-test-house');
  insert into public.master_wine_library (id, wine_id, name, primary_type) values (w, 'CR-TEST-1', 'CR test wine', 'red');
  insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
  values (inv, h, w, 750, 150);
  insert into public.deliveries (id, restaurant_id, state, provenance)
  values (d_none, h, 'VERIFIED', 'UNORDERED'), (d_ord, h, 'VERIFIED', 'UNORDERED');
  -- The paper first read 30 a bottle; the lots are final at that.
  insert into public.inventory_lots
    (id, restaurant_id, inventory_id, master_wine_id, qty, unit_cost, cost_provenance, cost_state, delivery_id, source_order_id)
  values
    (lot_live, h, inv, w, 3, 30, 'invoice', 'final', d_none, null),
    (lot_drawn, h, inv, w, 0, 30, 'invoice', 'final', d_none, null),
    (lot_ord, h, inv, w, 2, 30, 'invoice', 'final', d_ord, ord);

  -- C1: a delivery with NO order: its final lot is revalued, and the audit row names the revision.
  r := public.finalise_delivery_cost(d_none, inv, 33.333333, 'invoice', null, why);
  if (r->>'lots_finalised')::int <> 1 or (r->>'bottles_matched')::int <> 3 then
    raise exception 'C1: expected the one live lot revalued, got %', r;
  end if;
  if not exists (select 1 from public.inventory_lot_revaluations
                  where lot_id = lot_live and reason = why and prior_unit_cost = 30 and new_unit_cost = 33.333333) then
    raise exception 'C1: the revaluation row must keep 30 before and name the revision';
  end if;

  -- C2: the invariant on the stored cost: |unit_cost x 3 - 100.00| <= 3 x 5e-7.
  select unit_cost into c from public.inventory_lots where id = lot_live;
  if abs(c * 3 - 100.00) > 3 * 0.0000005 then
    raise exception 'C2: the lot keeps % a bottle, which does not come back to 100.00 over 3', c;
  end if;

  -- C3: a lot already drawn to nothing is not touched (its draws keep their cost).
  if (select unit_cost from public.inventory_lots where id = lot_drawn) <> 30
     or exists (select 1 from public.inventory_lot_revaluations where lot_id = lot_drawn) then
    raise exception 'C3: a drawn lot must keep 30 and have no revaluation';
  end if;

  -- C4: a replay of the same revision writes nothing.
  r := public.finalise_delivery_cost(d_none, inv, 33.333333, 'invoice', null, why);
  if (r->>'lots_finalised')::int <> 0
     or (select count(*) from public.inventory_lot_revaluations where lot_id = lot_live) <> 1 then
    raise exception 'C4: a replay must revalue nothing, got %', r;
  end if;

  -- C5: the ordered delivery: lot revalued, then the estimate-costed sale
  -- restated; a sale already costed on invoiced lots keeps its cost.
  insert into public.wine_consumption_log
    (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source,
     cost_at_sale, cost_basis, cost_unit_at_sale, cost_source_order_id)
  values
    ('a0109000-0000-4000-8000-000000000401', h, inv, 'w', 'bottle', 1, 750, 'pos', 28, 'last_purchase_price', 28, ord),
    ('a0109000-0000-4000-8000-000000000402', h, inv, 'w', 'bottle', 1, 750, 'pos', 30, 'invoice_lot_wac', 30, ord);
  r := public.finalise_delivery_cost(d_ord, inv, 27.5, 'invoice', null, why);
  if (r->>'lots_finalised')::int <> 1 then raise exception 'C5: the ordered lot must be revalued, got %', r; end if;
  r := public.restate_sale_cost(h, inv, ord, 27.5);
  if (r->>'rows_restated')::int <> 1 then raise exception 'C5: one estimate sale restated, got %', r; end if;
  if (select cost_at_sale from public.wine_consumption_log where id = 'a0109000-0000-4000-8000-000000000402') <> 30 then
    raise exception 'C5: an invoiced-lot draw must keep its cost';
  end if;
  if (select cost_at_sale from public.wine_consumption_log where id = 'a0109000-0000-4000-8000-000000000401') <> 27.5 then
    raise exception 'C5: the estimate sale must follow the corrected paper';
  end if;
end $$;

rollback;
