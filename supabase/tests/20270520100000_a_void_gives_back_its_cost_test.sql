-- a_void_gives_back_its_cost: psql -v ON_ERROR_STOP=1 -f on a migrated DB.
begin;
do $$ begin assert false; raise exception 'plpgsql.check_asserts is off'; exception when assert_failure then null; end $$;
create function pg_temp.u(s text) returns uuid language sql immutable as $$ select ('c0b00000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid $$;
create function pg_temp.i(x text) returns uuid language sql immutable as $$ select pg_temp.u('2' || x || '0') $$;
create function pg_temp.mv(x text, q int, ty text, k text default null, sale text default null, c numeric default null, d text default null)
returns uuid language sql as $$
  select public.apply_stock_movement(p_inventory_id => pg_temp.i(x), p_stock_state => 'live', p_delta => q,
    p_transaction_type => ty, p_source => 'pos', p_idempotency_key => k, p_unit_cost => c,
    p_cost_provenance => case when c is not null then 'manual' end, p_reference_type => case when q > 0 and k is null then 'delivery' end,
    p_reference_id => case when q > 0 and k is null then pg_temp.u('3' || coalesce(d, x) || '0') end,
    p_metadata => case when sale is not null then jsonb_build_object('sale_key', sale) end) $$;
create function pg_temp.fin(x text, c numeric) returns jsonb language sql as $$
  select public.finalise_delivery_cost(pg_temp.u('3' || x || '0'), pg_temp.i(x), c, 'invoice') $$;
create function pg_temp.c(t uuid) returns numeric language sql as $$
  select settled_cost_total from public.inventory_transaction_settled_cost where txn_id = t $$;
create function pg_temp.lots(x text) returns int language sql as $$
  select count(*)::int from public.inventory_lots where inventory_id = pg_temp.i(x) $$;
create function pg_temp.raw(x text, q int, ty text, k text default null) returns uuid language sql as $$
  insert into public.inventory_transactions (restaurant_id, inventory_id, transaction_type, source, quantity_change,
    quantity_before, quantity_after, stock_type, performed_by_type, idempotency_key)
  values (pg_temp.u('1'), pg_temp.i(x), ty::inventory_transaction_type, 'pos', q, 4, 4 + q, 'live', 'system', k) returning id $$;

do $$ declare x text; begin
  insert into public.restaurants (id, name, slug) values (pg_temp.u('1'), 'VT', 'vt-1');
  foreach x in array array['a', 'b', 'c', 'd', 'e', '7', '8', '9'] loop
    insert into public.master_wine_library (id, wine_id, name, primary_type) values (pg_temp.u('1' || x || '0'), 'VT-' || x, 'VT ' || x, 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
      values (pg_temp.i(x), pg_temp.u('1'), pg_temp.u('1' || x || '0'), 750, 150);
    insert into public.deliveries (id, restaurant_id, state) values (pg_temp.u('3' || x || '0'), pg_temp.u('1'), 'DELIVERED');
  end loop;
end $$;

-- S4 void then verify; S4c verify then void; S4d re-verify: sale and void net 0, no new lot.
do $$ declare s uuid; r uuid; v record; begin
  perform pg_temp.mv('a', 10, 'purchase');
  s := pg_temp.mv('a', -3, 'sale', 'vt-a');
  r := pg_temp.mv('a', 3, 'return', 'vt-a-v', 'vt-a');
  assert pg_temp.lots('a') = 1, format('S4 FAIL: the void made a new lot (%s lots)', pg_temp.lots('a'));
  perform pg_temp.fin('a', 12.00);
  select * into v from public.inventory_transaction_settled_cost where txn_id = r;
  assert pg_temp.c(s) = 36.00 and v.settled_cost_total = -36.00 and v.unpriced_qty_remaining = 0, format('S4 FAIL: %s %s', pg_temp.c(s), row_to_json(v));
  perform pg_temp.mv('b', 10, 'purchase');
  s := pg_temp.mv('b', -3, 'sale', 'vt-b');
  perform pg_temp.fin('b', 12.00);
  r := pg_temp.mv('b', 3, 'return', 'vt-b-v', 'vt-b');
  assert (select cost_total from public.inventory_transactions where id = r) = -36.00, 'S4c FAIL';
  perform pg_temp.fin('b', 13.00);
  assert pg_temp.c(s) = 39.00 and pg_temp.c(r) = -39.00, format('S4d FAIL: %s %s', pg_temp.c(s), pg_temp.c(r));
end $$;

-- L1 gives back the last-drawn lot at the sale's cost; L2 voids 2+2+1 of a sale of 3 give back 3.
do $$ declare r uuid; r2 uuid; r3 uuid; w record; begin
  perform pg_temp.mv('c', 2, 'purchase', c => 10.00);
  update public.inventory_lots set received_at = now() - interval '2 days' where inventory_id = pg_temp.i('c');
  perform pg_temp.mv('c', 5, 'purchase', c => 11.00, d => '9');
  perform pg_temp.mv('c', -3, 'sale', 'vt-c');
  update public.inventory_lots set unit_cost = 15 where delivery_id = pg_temp.u('390');
  r := pg_temp.mv('c', 1, 'return', 'vt-c-v', 'vt-c');
  select l.delivery_id, d.qty, d.unit_cost, l.qty q into w from public.inventory_lot_draws d join public.inventory_lots l on l.id = d.lot_id where d.txn_id = r;
  assert w.delivery_id = pg_temp.u('390') and w.qty = -1 and w.unit_cost = 11.00 and w.q = 5 and pg_temp.lots('c') = 2, format('L1 FAIL: %s', row_to_json(w));
  perform pg_temp.mv('d', 5, 'purchase', c => 10.00);
  perform pg_temp.mv('d', -3, 'sale', 'vt-d');
  r := pg_temp.mv('d', 2, 'return', 'vt-d1', 'vt-d');
  r2 := pg_temp.mv('d', 2, 'return', 'vt-d2', 'vt-d');
  r3 := pg_temp.mv('d', 1, 'return', 'vt-d3', 'vt-d');
  assert (select sum(cost_total) from public.inventory_transactions where id in (r, r2, r3)) = -30.00
     and (select count(*) from public.inventory_transactions where id in (r2, r3) and metadata ->> 'bottles_not_matched_to_a_draw' = '1') = 2
     and pg_temp.lots('d') = 3, 'L2 FAIL';
end $$;

-- L3 another item's sale, no key, a sale with no draws: as before.
do $$ begin
  perform pg_temp.mv('e', 3, 'purchase', c => 10.00);
  perform pg_temp.raw('e', -1, 'sale', 'vt-e-old');
  perform pg_temp.mv('e', 1, 'return', 'vt-e1', 'vt-d');
  perform pg_temp.mv('e', 1, 'return', 'vt-e2');
  perform pg_temp.mv('e', 1, 'return', 'vt-e3', 'vt-e-old');
  assert pg_temp.lots('e') = 4 and not exists (select 1 from public.inventory_lot_draws d join public.inventory_transactions t on t.id = d.txn_id
    where t.inventory_id = pg_temp.i('e')), 'L3 FAIL';
end $$;

-- P1/P2 (QA S6) a pour and a fold stamped per the owner contract; R1-R3 refusals.
do $$ declare lot uuid; flot uuid; p uuid; f uuid; n int; begin
  perform pg_temp.mv('7', 4, 'purchase');
  select id into lot from public.inventory_lots where inventory_id = pg_temp.i('7');
  update public.inventory_lots set qty = qty - 1 where id = lot;
  p := pg_temp.raw('7', -1, 'sale');
  perform public.stamp_lot_draws(p, array[lot], array[1]);
  update public.inventory_lots set qty = qty + 1 where id = lot;
  f := pg_temp.raw('7', 1, 'return');
  perform public.stamp_lot_draws(f, array[lot], array[-1]);
  perform pg_temp.fin('7', 24.00);
  assert pg_temp.c(p) = 24.00 and pg_temp.c(f) = -24.00, format('P FAIL: %s %s', pg_temp.c(p), pg_temp.c(f));
  select count(*) into n from public.inventory_lot_draws;
  perform pg_temp.mv('8', 2, 'purchase', c => 10.00);
  select id into flot from public.inventory_lots where inventory_id = pg_temp.i('8');
  p := pg_temp.raw('7', -1, 'sale');
  begin perform public.stamp_lot_draws(p, array[flot], array[1]); raise exception 'R1 FAIL';
  exception when sqlstate '42501' then null; end;
  begin perform public.stamp_lot_draws(f, array[lot], array[-1]); raise exception 'R2 FAIL';
  exception when sqlstate '55000' then null; end;
  begin perform public.stamp_lot_draws(p, array[lot], array[-1]); raise exception 'R3 FAIL';
  exception when sqlstate '22023' then null; end;
  assert (select count(*) from public.inventory_lot_draws) = n, 'R FAIL';
end $$;

select 'a_void_gives_back_its_cost: S4, S4c, S4d, L1-L3, P1-P2, R1-R3 pass' as result;
rollback;
