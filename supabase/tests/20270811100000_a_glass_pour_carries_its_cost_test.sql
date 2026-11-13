-- a_glass_pour_carries_its_cost (1 of 2): psql -v ON_ERROR_STOP=1 -f on a migrated DB, rolled back.
-- Without the migration G1 fails: a bottle opened for glasses has no draw and cost_total NULL.
begin;
do $$ begin assert false; raise exception 'plpgsql.check_asserts is off'; exception when assert_failure then null; end $$;
create function pg_temp.u(s text) returns uuid language sql immutable as $$ select ('c0b10000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid $$;
create function pg_temp.h() returns uuid language sql immutable as $$ select pg_temp.u('1') $$;
create function pg_temp.i(x text) returns uuid language sql immutable as $$ select pg_temp.u('2' || x || '0') $$;
create function pg_temp.d(x text) returns uuid language sql immutable as $$ select pg_temp.u('3' || x || '0') $$;
-- a priced (c) or unpriced (c null) lot of q bottles on delivery d(dk), received `ago` days back
create function pg_temp.buy(x text, q int, c numeric, dk text, ago int) returns void language plpgsql as $f$
begin
  perform public.apply_stock_movement(p_inventory_id => pg_temp.i(x), p_stock_state => 'live', p_delta => q,
    p_transaction_type => 'purchase', p_source => 'pos', p_unit_cost => c,
    p_cost_provenance => case when c is not null then 'manual' end,
    p_reference_type => 'delivery', p_reference_id => pg_temp.d(dk));
  update public.inventory_lots set received_at = now() - make_interval(days => ago)
   where inventory_id = pg_temp.i(x) and delivery_id = pg_temp.d(dk);
end $f$;
create function pg_temp.pour(x text, g int, k text) returns jsonb language sql as $$
  select public.record_glass_pour(pg_temp.i(x), g, 150, null, 'pos', null, 'glass test', k) $$;
create function pg_temp.vd(x text, sale text, g int, k text) returns jsonb language sql as $$
  select public.return_glass_pour(pg_temp.h(), pg_temp.i(x), sale, g, k) $$;
create function pg_temp.txn(j jsonb) returns uuid language sql as $$ select nullif(j ->> 'txn', '')::uuid $$;
create function pg_temp.draws(t uuid) returns text language sql as $$
  select string_agg(l.delivery_id::text || ':' || d.qty || '@' || coalesce(d.unit_cost::text, 'null'), ' ' order by l.received_at, l.id)
    from public.inventory_lot_draws d join public.inventory_lots l on l.id = d.lot_id where d.txn_id = t $$;
create function pg_temp.cog(x text) returns jsonb language sql as $$
  select e from jsonb_array_elements(public.pos_cost_of_goods(pg_temp.h(), now() - interval '1 day') -> 'items') e
   where (e ->> 'inventory_id')::uuid = pg_temp.i(x) $$;

do $$ declare x text; begin
  insert into public.restaurants (id, name, slug) values (pg_temp.h(), 'Glass cost house', 'glass-cost-house');
  foreach x in array array['a', 'b', 'c', 'd', 'e', 'f', '9'] loop
    insert into public.master_wine_library (id, wine_id, name, primary_type) values (pg_temp.u('1' || x || '0'), 'GC-' || x, 'GC ' || x, 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
      values (pg_temp.i(x), pg_temp.h(), pg_temp.u('1' || x || '0'), 750, 150);
  end loop;
  foreach x in array array['a', 'b', 'b2', 'c', 'd', 'e', 'f', '9'] loop
    insert into public.deliveries (id, restaurant_id, state) values (pg_temp.d(x), pg_temp.h(), 'DELIVERED');
  end loop;
end $$;

-- G1 a glass that opens a bottle stamps one draw at its lot's cost; G2 the next
-- glass from the open bottle writes no row and no draw; G8 a replay writes nothing.
do $$ declare j jsonb; t uuid; r record; n int; begin
  perform pg_temp.buy('a', 3, 12.00, 'a', 3);
  j := pg_temp.pour('a', 1, 'gc:a1');
  t := pg_temp.txn(j);
  select cost_total, unpriced_qty, quantity_change into r from public.inventory_transactions where id = t;
  assert t is not null and r.quantity_change = -1 and r.cost_total = 12.00 and r.unpriced_qty = 0,
    format('G1 FAIL: %s %s', j, row_to_json(r));
  assert pg_temp.draws(t) = pg_temp.d('a') || ':1@12.000000', format('G1 FAIL draws: %s', pg_temp.draws(t));
  select count(*) into n from public.inventory_lot_draws where inventory_id = pg_temp.i('a');
  j := pg_temp.pour('a', 2, 'gc:a2');
  assert pg_temp.txn(j) is null and (select count(*) from public.inventory_lot_draws where inventory_id = pg_temp.i('a')) = n,
    format('G2 FAIL: %s', j);
  j := pg_temp.pour('a', 1, 'gc:a1');
  assert (j ->> 'idempotent')::boolean and (select count(*) from public.inventory_lot_draws where inventory_id = pg_temp.i('a')) = n,
    format('G8 FAIL: %s', j);
end $$;

-- G3 one pour that opens bottles from two lots stamps one draw per lot, oldest first.
do $$ declare j jsonb; t uuid; begin
  perform pg_temp.buy('b', 1, 10.00, 'b', 5);
  perform pg_temp.buy('b', 3, 11.00, 'b2', 2);
  j := pg_temp.pour('b', 6, 'gc:b1');
  t := pg_temp.txn(j);
  assert (j ->> 'bottles_opened')::int = 2
     and (select cost_total from public.inventory_transactions where id = t) = 21.00
     and pg_temp.draws(t) = pg_temp.d('b') || ':1@10.000000 ' || pg_temp.d('b2') || ':1@11.000000',
    format('G3 FAIL: %s %s', j, pg_temp.draws(t));
  -- G3b a pour that opens two bottles of one lot is one draw of 2.
  perform pg_temp.buy('d', 3, 9.50, 'd', 3);
  j := pg_temp.pour('d', 10, 'gc:d1');
  t := pg_temp.txn(j);
  assert (j ->> 'bottles_opened')::int = 2
     and (select cost_total from public.inventory_transactions where id = t) = 19.00
     and pg_temp.draws(t) = pg_temp.d('d') || ':2@9.500000',
    format('G3b FAIL: %s %s', j, pg_temp.draws(t));
end $$;

-- G4 a bottle opened from an unpriced lot is counted unpriced, never 0, and the
-- invoice's verify settles it like any other draw.
do $$ declare t uuid; v record; begin
  perform pg_temp.buy('c', 2, null, 'c', 3);
  t := pg_temp.txn(pg_temp.pour('c', 1, 'gc:c1'));
  assert (select cost_total is null and unpriced_qty = 1 from public.inventory_transactions where id = t), 'G4 FAIL unpriced';
  perform public.finalise_delivery_cost(pg_temp.d('c'), pg_temp.i('c'), 24.00, 'invoice');
  select * into v from public.inventory_transaction_settled_cost where txn_id = t;
  assert v.settled_cost_total = 24.00 and v.unpriced_qty_remaining = 0, format('G4 FAIL settle: %s', row_to_json(v));
end $$;

-- G7 the table side reaches cost of goods: every glass sale row above is
-- stamped, so the reader has nothing to withhold for them.
do $$ declare c jsonb := public.pos_cost_of_goods(pg_temp.h(), now() - interval '1 day'); begin
  assert (c ->> 'rows_unstamped')::int = 0, format('G7 FAIL unstamped rows: %s', c);
  assert (pg_temp.cog('a') ->> 'cost')::numeric = 12 and (pg_temp.cog('a') ->> 'uncosted_out')::int = 0
     and (pg_temp.cog('b') ->> 'cost')::numeric = 21 and (pg_temp.cog('b') ->> 'uncosted_out')::int = 0
     and (pg_temp.cog('c') ->> 'cost')::numeric = 24 and (pg_temp.cog('c') ->> 'uncosted_out')::int = 0
     and (pg_temp.cog('d') ->> 'cost')::numeric = 19 and (pg_temp.cog('d') ->> 'uncosted_out')::int = 0,
    format('G7 FAIL: %s', c);
end $$;

select 'a_glass_pour_carries_its_cost: G1-G4, G3b, G7, G8 pass' as result;
rollback;
