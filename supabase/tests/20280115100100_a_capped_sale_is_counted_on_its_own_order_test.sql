-- r101 invoices: two capped sales of one item on different orders; a paper
-- for order A reports one capped row, not both. Self-asserting; rolled back.

begin;

do $$
declare
  h uuid := 'a0101200-0000-4000-8000-000000000001';
  inv uuid := 'a0101200-0000-4000-8000-000000000201';
  oa uuid := 'a0101200-0000-4000-8000-000000000301';
  ob uuid := 'a0101200-0000-4000-8000-000000000302';
  r jsonb;
begin
  insert into public.restaurants (id, name, slug) values (h, 'CN test house', 'cn-test-house');
  insert into public.master_wine_library (id, wine_id, name, primary_type)
  values ('a0101200-0000-4000-8000-000000000101', 'CN-TEST-1', 'CN test wine', 'red');
  insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
  values (inv, h, 'a0101200-0000-4000-8000-000000000101', 750, 150);

  insert into public.wine_consumption_log
    (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source,
     cost_at_sale, cost_basis, cost_unit_at_sale, cost_source_order_id, cost_parts, cost_parts_capped)
  values
    ('a0101200-0000-4000-8000-000000000401', h, inv, 'w', 'glass', 1, 150, 'pos', 1.8, 'last_purchase_price', 9, oa, null, true),
    ('a0101200-0000-4000-8000-000000000402', h, inv, 'w', 'glass', 1, 150, 'pos', 1.8, 'last_purchase_price', 9, ob, null, true);

  r := public.restate_sale_cost(h, inv, oa, 7.5);
  if (r->>'rows_capped')::int <> 1 then
    raise exception 'CN1: only the capped sale of order A is counted on A''s paper, got %', r;
  end if;
  r := public.restate_sale_cost(h, inv, ob, 7.5);
  if (r->>'rows_capped')::int <> 1 then
    raise exception 'CN2: only the capped sale of order B is counted on B''s paper, got %', r;
  end if;

  -- CN3: a capped sale keeps no parts and names only the order of the OLDEST
  -- lot it drew on. Order C's lots arrived before that sale, so C's paper
  -- must still count it; order D's lots arrive after it, so D's must not.
  update public.wine_consumption_log set recorded_at = now() - interval '10 days'
   where id in ('a0101200-0000-4000-8000-000000000401', 'a0101200-0000-4000-8000-000000000402');
  insert into public.wine_consumption_log
    (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source,
     cost_at_sale, cost_basis, cost_unit_at_sale, cost_source_order_id, cost_parts, cost_parts_capped, recorded_at)
  values
    ('a0101200-0000-4000-8000-000000000403', h, inv, 'w', 'glass', 1, 150, 'pos', 1.8, 'last_purchase_price', 9,
     'a0101200-0000-4000-8000-000000000303', null, true, now() - interval '2 days');
  insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, qty, open_bottle_ml, received_at, source_order_id)
  values
    (h, inv, 'a0101200-0000-4000-8000-000000000101', 1, 0, now() - interval '3 days', 'a0101200-0000-4000-8000-000000000304'),
    (h, inv, 'a0101200-0000-4000-8000-000000000101', 1, 0, now() - interval '1 day', 'a0101200-0000-4000-8000-000000000305');
  r := public.restate_sale_cost(h, inv, 'a0101200-0000-4000-8000-000000000304', 7.5);
  if (r->>'rows_capped')::int <> 1 then
    raise exception 'CN3: a sale drawn over older orders is counted on a later order''s paper, got %', r;
  end if;
  r := public.restate_sale_cost(h, inv, 'a0101200-0000-4000-8000-000000000305', 7.5);
  if (r->>'rows_capped')::int <> 0 then
    raise exception 'CN4: a sale made before the order''s lots arrived is not counted on its paper, got %', r;
  end if;
end $$;

rollback;
