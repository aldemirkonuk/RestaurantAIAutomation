-- r105: a pour's own basis words are accepted, an unknown word is still refused,
-- and restate_sale_cost leaves a pour costed on invoiced lots alone.
-- Self-asserting; one transaction, rolled back. NOT RUN in the authoring
-- session (no local database); run on a database built from supabase/migrations.
begin;
do $$
declare
  h uuid := 'a0105000-0000-4000-8000-000000000001';
  inv uuid := 'a0105000-0000-4000-8000-000000000201';
  ord uuid := 'a0105000-0000-4000-8000-000000000301';
  c numeric;
begin
  insert into public.restaurants (id, name, slug) values (h, 'PW test house', 'pw-test-house');
  insert into public.master_wine_library (id, wine_id, name, primary_type)
  values ('a0105000-0000-4000-8000-000000000101', 'PW-TEST-1', 'PW test wine', 'red');
  insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
  values (inv, h, 'a0105000-0000-4000-8000-000000000101', 750, 150);

  insert into public.wine_consumption_log
    (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source,
     cost_at_sale, cost_basis, cost_unit_at_sale, cost_source_order_id)
  values
    ('a0105000-0000-4000-8000-000000000401', h, inv, 'w', 'glass', 1, 150, 'pos', 12.8, 'pour_lot_wac', 64, ord),
    ('a0105000-0000-4000-8000-000000000402', h, inv, 'w', 'glass', 1, 150, 'pos', 12.8, 'pour_lot_wac_partial', 64, ord),
    -- the other PRs' words survive this CHECK too (the list is the whole set of seven)
    ('a0105000-0000-4000-8000-000000000403', h, inv, 'w', 'bottle', 1, 750, 'pos', 64, 'agreed_lot_wac', 64, ord),
    ('a0105000-0000-4000-8000-000000000404', h, inv, 'w', 'bottle', 1, 750, 'pos', 64, 'invoice_restated', 64, ord);

  begin
    insert into public.wine_consumption_log
      (restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source, cost_basis)
    values (h, inv, 'w', 'glass', 1, 150, 'pos', 'pour_guess');
    raise exception 'PW1: an unknown basis word was accepted';
  exception when check_violation then null; end;

  perform public.restate_sale_cost(h, inv, ord, 80);
  select cost_at_sale into c from public.wine_consumption_log where id = 'a0105000-0000-4000-8000-000000000401';
  if c <> 12.8 then raise exception 'PW2: a pour costed on invoiced lots must not move, got %', c; end if;
end $$;
rollback;
