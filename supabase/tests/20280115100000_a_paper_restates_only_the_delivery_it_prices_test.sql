-- r101 invoices: one order arrives as two deliveries (2 @ 35 est, 3 @ 35 est),
-- each paper checked on its own (D1 at 30, D2 at 40): the sale ends at the
-- blend 36 in either order, never at the last paper checked.
-- Self-asserting; synthetic; rolled back.

begin;

do $$
declare
  h uuid := 'a0101100-0000-4000-8000-000000000001';
  inv uuid := 'a0101100-0000-4000-8000-000000000201';
  o uuid := 'a0101100-0000-4000-8000-000000000301';
  d1 uuid := 'a0101100-0000-4000-8000-000000000501';
  d2 uuid := 'a0101100-0000-4000-8000-000000000502';
  sa uuid := 'a0101100-0000-4000-8000-000000000401';
  sb uuid := 'a0101100-0000-4000-8000-000000000402';
  sc uuid := 'a0101100-0000-4000-8000-000000000403';
  parts jsonb;
  c numeric;
  b text;
  p jsonb;
begin
  insert into public.restaurants (id, name, slug) values (h, 'DD test house', 'dd-test-house');
  insert into public.master_wine_library (id, wine_id, name, primary_type)
  values ('a0101100-0000-4000-8000-000000000101', 'DD-TEST-1', 'DD test wine', 'red');
  insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
  values (inv, h, 'a0101100-0000-4000-8000-000000000101', 750, 150);

  parts := jsonb_build_array(
    jsonb_build_object('order_id', o::text, 'delivery_id', d1::text, 'lot_id', 'lot-1', 'qty', 2, 'unit_cost', 35, 'invoiced', false),
    jsonb_build_object('order_id', o::text, 'delivery_id', d2::text, 'lot_id', 'lot-2', 'qty', 3, 'unit_cost', 35, 'invoiced', false));

  insert into public.wine_consumption_log
    (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source,
     cost_at_sale, cost_basis, cost_unit_at_sale, cost_source_order_id, cost_parts)
  values
    (sa, h, inv, 'w', 'bottle', 1, 750, 'pos', 35, 'last_purchase_price', 35, o, parts),
    (sb, h, inv, 'w', 'bottle', 1, 750, 'pos', 35, 'last_purchase_price', 35, o, parts),
    -- an old part with no delivery_id: still matched by order
    (sc, h, inv, 'w', 'bottle', 1, 750, 'pos', 35, 'last_purchase_price', 35, o,
       jsonb_build_array(jsonb_build_object('order_id', o::text, 'lot_id', 'lot-9', 'qty', 5, 'unit_cost', 35, 'invoiced', false)));

  -- D1 first at 30: only D1's part moves; D2 is still an estimate.
  perform public.restate_sale_cost(h, inv, o, 30, null, d1);
  select cost_at_sale, cost_basis, cost_parts into c, b, p from public.wine_consumption_log where id = sa;
  if c <> round((2 * 30 + 3 * 35)::numeric / 5, 4) or b <> 'invoice_lot_wac_partial' then
    raise exception 'DD1: after D1 only the sale is (60 + 105) / 5 and partly checked, got % %', c, b;
  end if;
  if (p->1->>'unit_cost')::numeric <> 35 or (p->1->>'invoiced')::boolean then
    raise exception 'DD2: D2''s part must stay an estimate after D1''s paper, got %', p->1;
  end if;
  -- the part with no delivery_id follows the order's paper
  select cost_at_sale into c from public.wine_consumption_log where id = sc;
  if c <> 30 then raise exception 'DD3: a part with no delivery_id matches by order, got %', c; end if;

  -- D2 at 40: the blend, whatever the order.
  perform public.restate_sale_cost(h, inv, o, 40, null, d2);
  select cost_at_sale, cost_basis into c, b from public.wine_consumption_log where id = sa;
  if c <> 36 or b <> 'invoice_restated' then
    raise exception 'DD4: D1 then D2 must end at 36 restated, got % %', c, b;
  end if;

  -- The other order on a fresh sale: D2 first, then D1.
  perform public.restate_sale_cost(h, inv, o, 40, null, d2);
  update public.wine_consumption_log set cost_parts = parts, cost_at_sale = 35, cost_unit_at_sale = 35,
         cost_basis = 'last_purchase_price' where id = sb;
  delete from public.wine_consumption_cost_restatements where consumption_id = sb;
  perform public.restate_sale_cost(h, inv, o, 40, null, d2);
  select cost_at_sale into c from public.wine_consumption_log where id = sb;
  if c <> round((2 * 35 + 3 * 40)::numeric / 5, 4) then
    raise exception 'DD5: D2 only is (70 + 120) / 5, got %', c;
  end if;
  perform public.restate_sale_cost(h, inv, o, 30, null, d1);
  select cost_at_sale, cost_basis into c, b from public.wine_consumption_log where id = sb;
  if c <> 36 or b <> 'invoice_restated' then
    raise exception 'DD6: D2 then D1 must end at 36 restated, got % %', c, b;
  end if;

  -- Without a delivery the whole order's parts are replaced (verifyReceipt).
  update public.wine_consumption_log set cost_parts = parts, cost_at_sale = 35, cost_unit_at_sale = 35,
         cost_basis = 'last_purchase_price' where id = sb;
  perform public.restate_sale_cost(h, inv, o, 31);
  select cost_at_sale into c from public.wine_consumption_log where id = sb;
  if c <> 31 then raise exception 'DD7: an order-wide paper replaces every part of the order, got %', c; end if;
end $$;

rollback;
