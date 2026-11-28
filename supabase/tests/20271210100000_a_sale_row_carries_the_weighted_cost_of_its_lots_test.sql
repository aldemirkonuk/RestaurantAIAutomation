-- a_sale_row_carries_the_weighted_cost_of_its_lots (r103, DD-r102-21): a till
-- sale's depletion row says what its bottles cost, weighted by the lots it
-- drew, and the draws say which lots. Self-asserting; run with
-- `psql -v ON_ERROR_STOP=1 -f` on a database built from supabase/migrations.
begin;
do $$ begin assert false; raise exception 'plpgsql.check_asserts is off'; exception when assert_failure then null; end $$;
create function pg_temp.u(s text) returns uuid language sql immutable as $$ select ('c0c10000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid $$;
create function pg_temp.i(x text) returns uuid language sql immutable as $$ select pg_temp.u('2' || x || '0') $$;
create function pg_temp.mv(x text, q int, ty text, k text default null, c numeric default null) returns uuid language sql as $$
  select public.apply_stock_movement(p_inventory_id => pg_temp.i(x), p_stock_state => 'live', p_delta => q,
    p_transaction_type => ty, p_source => 'pos', p_idempotency_key => k, p_unit_cost => c,
    p_cost_provenance => case when c is not null and q > 0 then 'manual' end) $$;
-- FIFO order inside one test transaction: stamp the lots' arrival explicitly.
create function pg_temp.lot(x text, q int, c numeric, ago int) returns uuid language plpgsql as $$
declare l uuid; begin
  perform pg_temp.mv(x, q, 'purchase', null, c);
  select id into l from public.inventory_lots where inventory_id = pg_temp.i(x) and received_at = (select max(received_at) from public.inventory_lots where inventory_id = pg_temp.i(x)) order by created_at desc limit 1;
  update public.inventory_lots set received_at = now() - make_interval(hours => ago), created_at = now() - make_interval(hours => ago) where id = l;
  return l; end $$;

do $$ declare x text; begin
  insert into public.restaurants (id, name, slug) values (pg_temp.u('1'), 'WC', 'wc-1');
  foreach x in array array['a', 'b', 'c', 'd', 'e'] loop
    insert into public.master_wine_library (id, wine_id, name, primary_type) values (pg_temp.u('1' || x || '0'), 'WC-' || x, 'WC ' || x, 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
      values (pg_temp.i(x), pg_temp.u('1'), pg_temp.u('1' || x || '0'), 750, 150);
  end loop;
end $$;

-- W1 the brief's example: 3 at 12.00 then 2 at 14.00, sell 5: (36 + 28) / 5 = 12.80,
-- on the row, and the draws name the two lots.
do $$ declare l1 uuid; l2 uuid; s uuid; r record; n int; begin
  l1 := pg_temp.lot('a', 3, 12.00, 3);
  l2 := pg_temp.lot('a', 2, 14.00, 2);
  s := pg_temp.mv('a', -5, 'sale', 'wc-a');
  select * into r from public.inventory_transactions where id = s;
  assert r.unit_cost = 12.80, format('W1 FAIL: unit_cost %s', r.unit_cost);
  assert r.cost_total = 64.00, format('W1 FAIL: cost_total %s', r.cost_total);
  assert r.unit_cost * 5 = r.cost_total, 'W1 FAIL: the row disagrees with its own total';
  select count(*) into n from public.inventory_lot_draws where txn_id = s and (
    (lot_id = l1 and qty = 3 and unit_cost = 12.00) or (lot_id = l2 and qty = 2 and unit_cost = 14.00));
  assert n = 2 and (select count(*) from public.inventory_lot_draws where txn_id = s) = 2,
    format('W1 FAIL: the draws do not name the two lots (%s)', n);
  assert r.cost_total = (select sum(qty * unit_cost) from public.inventory_lot_draws where txn_id = s), 'W1 FAIL: total is not the draws';
end $$;

-- W2 a sale inside one lot is that lot's price.
do $$ declare s uuid; begin
  perform pg_temp.lot('b', 6, 9.50, 2);
  s := pg_temp.mv('b', -2, 'sale', 'wc-b');
  assert (select unit_cost from public.inventory_transactions where id = s) = 9.50, 'W2 FAIL';
end $$;

-- W3 six places, not two: 1 at 10.00 and 2 at 10.01 cost 30.02 for 3 bottles, 10.006667 each.
do $$ declare s uuid; begin
  perform pg_temp.lot('c', 1, 10.00, 3);
  perform pg_temp.lot('c', 4, 10.01, 2);
  s := pg_temp.mv('c', -3, 'sale', 'wc-c');
  assert (select unit_cost from public.inventory_transactions where id = s) = 10.006667,
    format('W3 FAIL: %s', (select unit_cost from public.inventory_transactions where id = s));
end $$;

-- W4 any unpriced bottle: the weighted cost is unknown, not the priced part's.
do $$ declare s uuid; r record; begin
  perform pg_temp.lot('d', 2, null, 3);
  perform pg_temp.lot('d', 3, 14.00, 2);
  s := pg_temp.mv('d', -5, 'sale', 'wc-d');
  select * into r from public.inventory_transactions where id = s;
  assert r.unit_cost is null and r.unpriced_qty = 2 and r.cost_total = 42.00,
    format('W4 FAIL: %s', row_to_json(r));
end $$;

-- W5 a waste row keeps what its caller gave; a return and a purchase too.
do $$ declare w uuid; p uuid; begin
  perform pg_temp.lot('e', 6, 12.00, 3);
  w := pg_temp.mv('e', -1, 'waste', 'wc-e1', 99.00);
  assert (select unit_cost from public.inventory_transactions where id = w) = 99.00, 'W5 FAIL: waste row rewritten';
  w := pg_temp.mv('e', -1, 'waste', 'wc-e2');
  assert (select unit_cost from public.inventory_transactions where id = w) is null, 'W5 FAIL: waste row given a cost';
  p := (select id from public.inventory_transactions where inventory_id = pg_temp.i('e') and transaction_type = 'purchase');
  assert (select unit_cost from public.inventory_transactions where id = p) = 12.00, 'W5 FAIL: purchase row rewritten';
end $$;

rollback;
