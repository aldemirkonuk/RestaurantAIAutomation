-- DD-r104-16: wine_consumption_log.cost_basis accepts agreed_lot_wac, keeps the
-- other three, and still refuses a basis nobody named. Self-asserting; run on a
-- database built from supabase/migrations; synthetic fixtures, rolled back.

begin;

do $$
declare
  h  uuid := 'a0100000-0000-4000-8000-000000000001';
  mw uuid := 'a0100000-0000-4000-8000-000000000101';
  it uuid := 'a0100000-0000-4000-8000-000000000201';
  b  text;
  n  int := 0;
begin
  insert into public.restaurants (id, name, slug) values (h, 'AW test house', 'aw-test-house');
  insert into public.master_wine_library (id, wine_id, name, primary_type) values (mw, 'AW-TEST-1', 'AW test wine', 'red');
  insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
  values (it, h, mw, 750, 150);

  -- A1..A4: each of the four bases is kept on the row.
  foreach b in array array['invoice_lot_wac', 'invoice_lot_wac_partial', 'agreed_lot_wac', 'last_purchase_price'] loop
    n := n + 1;
    insert into public.wine_consumption_log
      (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source, cost_at_sale, cost_basis)
    values (('a0100000-0000-4000-8000-0000000003' || lpad(n::text, 2, '0'))::uuid, h, it,
            'SYNTHETIC AW', 'bottle', 1, 750, 'pos', 20, b);
  end loop;
  assert (select count(*) from public.wine_consumption_log where inventory_id = it and cost_basis = 'agreed_lot_wac') = 1,
    'A3: agreed_lot_wac was not kept on the sale row';

  -- A5: a null basis (cost not kept) is still fine.
  insert into public.wine_consumption_log
    (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source)
  values ('a0100000-0000-4000-8000-000000000399', h, it, 'SYNTHETIC AW', 'bottle', 1, 750, 'pos');

  -- A6: a basis nobody named is still refused.
  begin
    insert into public.wine_consumption_log
      (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source, cost_at_sale, cost_basis)
    values ('a0100000-0000-4000-8000-000000000398', h, it, 'SYNTHETIC AW', 'bottle', 1, 750, 'pos', 20, 'made_up_basis');
    raise exception 'A6: a made-up cost_basis was accepted';
  exception when check_violation then null;
  end;
end $$;

rollback;
