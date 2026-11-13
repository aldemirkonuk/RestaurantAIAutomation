-- a_glass_void_gives_back_its_cost (2 of 2): psql -v ON_ERROR_STOP=1 -f on a migrated DB, rolled back.
-- Without the migration G5 fails: the bottle a glass void folds back has no draw and cost_total NULL.
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

-- G5 a void that folds the opened bottle back stamps -1 at the lot's cost: the
-- sale and its void net to 0. G6 a void of glasses from an already-open bottle
-- folds nothing and writes no draw.
do $$ declare s uuid; j jsonb; r uuid; n int; begin
  perform pg_temp.buy('e', 2, 12.00, 'e', 3);
  s := pg_temp.txn(pg_temp.pour('e', 2, 'gc:e1'));
  j := pg_temp.vd('e', 'gc:e1', 2, 'gc:e1:void');
  r := pg_temp.txn(j);
  assert (j ->> 'bottles_folded')::int = 1
     and (select cost_total from public.inventory_transactions where id = r) = -12.00
     and pg_temp.draws(r) = pg_temp.d('e') || ':-1@12.000000'
     and (select sum(cost_total) from public.inventory_transactions where id in (s, r)) = 0,
    format('G5 FAIL: %s %s', j, pg_temp.draws(r));
  -- G5b voiding a ten-glass sale that opened two bottles of one lot folds both back: one draw of -2.
  perform pg_temp.buy('d', 3, 9.50, 'd', 3);
  perform pg_temp.pour('d', 10, 'gc:d1');
  j := pg_temp.vd('d', 'gc:d1', 10, 'gc:d1:void');
  r := pg_temp.txn(j);
  assert (j ->> 'bottles_folded')::int = 2
     and pg_temp.draws(r) = pg_temp.d('d') || ':-2@9.500000'
     and (select sum(cost_total) from public.inventory_transactions
           where inventory_id = pg_temp.i('d') and transaction_type in ('sale', 'return')) = 0,
    format('G5b FAIL: %s %s', j, pg_temp.draws(r));
  perform pg_temp.buy('f', 2, 12.00, 'f', 3);
  perform pg_temp.pour('f', 1, 'gc:f1');
  perform pg_temp.pour('f', 1, 'gc:f2');
  select count(*) into n from public.inventory_lot_draws where inventory_id = pg_temp.i('f');
  j := pg_temp.vd('f', 'gc:f2', 1, 'gc:f2:void');
  assert (j ->> 'bottles_folded')::int = 0 and pg_temp.txn(j) is null
     and (select count(*) from public.inventory_lot_draws where inventory_id = pg_temp.i('f')) = n,
    format('G6 FAIL: %s', j);
end $$;

-- G7 cost of goods nets each glass sale and its void to 0 with nothing unknown;
-- G9 a bottle sale's void through return_glass_pour stays matched (kept from
-- a_void_gives_back_the_pour and a_void_gives_back_its_cost).
do $$ declare c jsonb; begin
  perform pg_temp.buy('9', 2, 12.00, '9', 3);
  perform public.apply_stock_movement(p_inventory_id => pg_temp.i('9'), p_stock_state => 'live', p_delta => -1,
    p_transaction_type => 'sale', p_source => 'pos', p_idempotency_key => 'gc:91');
  perform pg_temp.vd('9', 'gc:91', 1, 'gc:91:void');
  assert (pg_temp.cog('9') ->> 'cost')::numeric = 0 and (pg_temp.cog('9') ->> 'uncosted_back')::int = 0,
    format('G9 FAIL: %s', pg_temp.cog('9'));
  c := public.pos_cost_of_goods(pg_temp.h(), now() - interval '1 day');
  assert (c ->> 'rows_unstamped')::int = 0, format('G7 FAIL unstamped rows: %s', c);
  assert (pg_temp.cog('d') ->> 'cost')::numeric = 0 and (pg_temp.cog('d') ->> 'uncosted_back')::int = 0
     and (pg_temp.cog('e') ->> 'cost')::numeric = 0 and (pg_temp.cog('e') ->> 'uncosted_back')::int = 0
     and (pg_temp.cog('f') ->> 'cost')::numeric = 12 and (pg_temp.cog('f') ->> 'uncosted_out')::int = 0,
    format('G7 FAIL: %s', c);
end $$;

select 'a_glass_void_gives_back_its_cost: G5, G5b, G6, G7, G9 pass' as result;
rollback;
