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
end $$;

rollback;
