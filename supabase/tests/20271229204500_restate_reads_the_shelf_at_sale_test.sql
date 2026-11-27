-- r109 g1: two unchecked deliveries (10 @ 8, 12 @ 9), a pour sold, each paper
-- checked in either order: the sale ends at share x the blended paper cost.
-- Plus a partial-basis row, a capped row, a void, a no-parts row, a rerun.
-- Self-asserting; synthetic; rolled back.

begin;

do $$
declare
  h uuid := 'a0109000-0000-4000-8000-000000000001';
  inv uuid := 'a0109000-0000-4000-8000-000000000201';
  oa uuid := 'a0109000-0000-4000-8000-000000000301';
  ob uuid := 'a0109000-0000-4000-8000-000000000302';
  oc uuid := 'a0109000-0000-4000-8000-000000000303'; -- a delivery checked before the sale
  s1 uuid := 'a0109000-0000-4000-8000-000000000401'; -- pour, A then B
  s2 uuid := 'a0109000-0000-4000-8000-000000000402'; -- pour, B then A
  s3 uuid := 'a0109000-0000-4000-8000-000000000403'; -- partial basis, 2 bottles
  s4 uuid := 'a0109000-0000-4000-8000-000000000404'; -- capped
  s5 uuid := 'a0109000-0000-4000-8000-000000000405'; -- void
  s6 uuid := 'a0109000-0000-4000-8000-000000000406'; -- no parts, oldest lot = A
  shelf jsonb;
  blended numeric := 0.2 * (10 * 7.5 + 12 * 9.4) / 22;  -- 1.70727...
  r jsonb;
  c numeric;
  b text;
begin
  insert into public.restaurants (id, name, slug) values (h, 'SH test house', 'sh-test-house');
  insert into public.master_wine_library (id, wine_id, name, primary_type)
  values ('a0109000-0000-4000-8000-000000000101', 'SH-TEST-1', 'SH test wine', 'red');
  insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
  values (inv, h, 'a0109000-0000-4000-8000-000000000101', 750, 150);

  -- No lots exist: a part keeps its own qty and cost (a spent lot restates).
  shelf := jsonb_build_array(
    jsonb_build_object('order_id', oa::text, 'lot_id', 'lot-a', 'qty', 10, 'unit_cost', 8, 'invoiced', false),
    jsonb_build_object('order_id', ob::text, 'lot_id', 'lot-b', 'qty', 12, 'unit_cost', 9, 'invoiced', false));

  insert into public.wine_consumption_log
    (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source,
     cost_at_sale, cost_basis, cost_unit_at_sale, cost_source_order_id, cost_parts, cost_parts_capped)
  values
    -- a pour at the last price paid (9): 150/750 x 9
    (s1, h, inv, 'w', 'glass', 1, 150, 'pos', 1.8, 'last_purchase_price', 9, oa, shelf, false),
    (s2, h, inv, 'w', 'glass', 1, 150, 'pos', 1.8, 'last_purchase_price', 9, oa, shelf, false),
    -- C already checked at 8, B on an estimate, an unpriced lot off the parts:
    -- WAC over the priced lots = 8.55 (2 places), two bottles = 17.10
    (s3, h, inv, 'w', 'bottle', 2, 1500, 'pos', 17.10, 'invoice_lot_wac_partial', 8.55, oc,
       jsonb_build_array(
         jsonb_build_object('order_id', oc::text, 'lot_id', 'lot-a', 'qty', 10, 'unit_cost', 8, 'invoiced', true),
         jsonb_build_object('order_id', ob::text, 'lot_id', 'lot-b', 'qty', 12, 'unit_cost', 9, 'invoiced', false)),
       false),
    (s4, h, inv, 'w', 'glass', 1, 150, 'pos', 1.8, 'last_purchase_price', 9, oa, null, true),
    (s5, h, inv, 'w', 'glass', 0, 0, 'pos', 0, 'last_purchase_price', 9, oa, shelf, false),
    (s6, h, inv, 'w', 'bottle', 1, 750, 'pos', 9, 'last_purchase_price', 9, oa, null, false);

  -- s1: A's paper (7.50) first. B is still an estimate: partly checked.
  r := public.restate_sale_cost(h, inv, oa, 7.5);
  select cost_at_sale, cost_basis into c, b from public.wine_consumption_log where id = s1;
  if c <> round(0.2 * (10 * 7.5 + 12 * 9) / 22, 4) or b <> 'invoice_lot_wac_partial' then
    raise exception 'SH1: after A only, the pour is 0.2 x (75 + 108) / 22 and partly checked, got % %', c, b;
  end if;
  if (r->>'rows_capped')::int <> 1 then raise exception 'SH2: the capped sale must be counted, got %', r; end if;

  -- s6 has no parts: the single-order rule moves the whole line to A's cost.
  select cost_at_sale into c from public.wine_consumption_log where id = s6;
  if c <> 7.5 then raise exception 'SH3: a row with no parts keeps the single-order rule, got %', c; end if;
  -- s4 is capped: never restated.
  select cost_at_sale into c from public.wine_consumption_log where id = s4;
  if c <> 1.8 then raise exception 'SH4: a capped row must not be restated, got %', c; end if;
  -- s5 is a void: stays 0.
  select cost_at_sale into c from public.wine_consumption_log where id = s5;
  if c <> 0 then raise exception 'SH5: a void must stay 0, got %', c; end if;

  -- B's paper (9.40): every part checked, the exact blend, invoice_restated.
  r := public.restate_sale_cost(h, inv, ob, 9.4);
  select cost_at_sale, cost_basis into c, b from public.wine_consumption_log where id = s1;
  if abs(c - blended) > 0.00005 or b <> 'invoice_restated' then
    raise exception 'SH6: A then B must end at the blend % restated, got % %', blended, c, b;
  end if;
  -- s2 was costed the same and saw the same two papers: it is also at the blend.
  select cost_at_sale, cost_basis into c, b from public.wine_consumption_log where id = s2;
  if abs(c - blended) > 0.00005 or b <> 'invoice_restated' then
    raise exception 'SH7: the blend must not depend on paper order, got % %', c, b;
  end if;

  -- s3: the partial-basis row, restated once B is checked: 2 x (80 + 112.8) / 22.
  select cost_at_sale, cost_basis into c, b from public.wine_consumption_log where id = s3;
  if abs(c - 2 * (10 * 8 + 12 * 9.4) / 22) > 0.00005 or b <> 'invoice_restated' then
    raise exception 'SH8: a part-checked row is restated to the blend, got % %', c, b;
  end if;

  -- The audit keeps every before and after; s1 has two events, the first
  -- keeping the figure it sold at.
  if (select count(*) from public.wine_consumption_cost_restatements where consumption_id = s1) <> 2
     or not exists (select 1 from public.wine_consumption_cost_restatements
                     where consumption_id = s1 and prior_cost_at_sale = 1.8 and prior_unit_cost = 9) then
    raise exception 'SH9: the audit rows must keep the figure before';
  end if;

  -- The same paper again restates nothing.
  r := public.restate_sale_cost(h, inv, ob, 9.4);
  if (r->>'rows_restated')::int <> 0 then raise exception 'SH10: a second run must restate nothing, got %', r; end if;
end $$;

-- B's paper first, then A's, on a fresh sale: the same blend.
do $$
declare
  h uuid := 'a0109000-0000-4000-8000-000000000001';
  inv uuid := 'a0109000-0000-4000-8000-000000000201';
  oa uuid := 'a0109000-0000-4000-8000-000000000311';
  ob uuid := 'a0109000-0000-4000-8000-000000000312';
  s uuid := 'a0109000-0000-4000-8000-000000000411';
  blended numeric := 0.2 * (10 * 7.5 + 12 * 9.4) / 22;
  c numeric;
  b text;
begin
  insert into public.wine_consumption_log
    (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source,
     cost_at_sale, cost_basis, cost_unit_at_sale, cost_source_order_id, cost_parts)
  values
    (s, h, inv, 'w', 'glass', 1, 150, 'pos', 1.8, 'last_purchase_price', 9, oa,
     jsonb_build_array(
       jsonb_build_object('order_id', oa::text, 'lot_id', 'lot-a', 'qty', 10, 'unit_cost', 8, 'invoiced', false),
       jsonb_build_object('order_id', ob::text, 'lot_id', 'lot-b', 'qty', 12, 'unit_cost', 9, 'invoiced', false)));
  perform public.restate_sale_cost(h, inv, ob, 9.4);
  select cost_basis into b from public.wine_consumption_log where id = s;
  if b <> 'invoice_lot_wac_partial' then raise exception 'SH11: B alone is partly checked, got %', b; end if;
  perform public.restate_sale_cost(h, inv, oa, 7.5);
  select cost_at_sale, cost_basis into c, b from public.wine_consumption_log where id = s;
  if abs(c - blended) > 0.00005 or b <> 'invoice_restated' then
    raise exception 'SH12: B then A must end at the blend %, got % %', blended, c, b;
  end if;
end $$;

rollback;
