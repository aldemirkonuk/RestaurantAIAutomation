-- a_sale_keeps_six_places (QA round 19, lines 57-61): a six-place lot cost
-- reaches the cost of a sale, and the lot views, without being rounded to 2.
--
-- Self-asserting (assert -> P0004); run with `psql -v ON_ERROR_STOP=1 -f` on a
-- database built from supabase/migrations. CI runs no supabase/tests file
-- (claim SUPABASE-TESTS-RUN-IN-CI). Synthetic fixtures, rolled back.
-- Self-guarding: the six-place checks need #909 (inventory_lots.unit_cost at
-- scale 6); without it they are skipped with a NOTICE, and the column scales
-- and a two-place blend are still asserted.

begin;
set local timezone = 'UTC';
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('c0a00000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;
create function pg_temp.mv(l text, q int, cost numeric default null) returns uuid language sql as $$
  select public.apply_stock_movement(pg_temp.u('2' || l || '0'), 'live', q,
    case when q > 0 then 'purchase' else 'sale' end, 'manual', null, 'six test',
    cost, null, null, null, case when cost is null then null else 'manual' end)
$$;
create function pg_temp.scale(t text, c text) returns int language sql as $$
  select numeric_scale::int from information_schema.columns
   where table_schema = 'public' and table_name = t and column_name = c
$$;

do $$
declare x text;
begin
  insert into public.restaurants (id, name, slug) values (pg_temp.u('1'), 'Six test house', 'six-test-house');
  foreach x in array array['a', 'b', 'c'] loop
    insert into public.master_wine_library (id, wine_id, name, primary_type)
      values (pg_temp.u('1' || x || '0'), 'SIX-TEST-' || upper(x), 'Six test wine ' || upper(x), 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
      values (pg_temp.u('2' || x || '0'), pg_temp.u('1'), pg_temp.u('1' || x || '0'), 750, 150);
  end loop;
end $$;

-- M1-M3 (merged tree): 200 bottles at 10.0049 sold one at a time cost
-- 200 x 10.0049 = 2000.98; the lot's wac is 10.0049; 13 sales at 9.230769
-- carry 119.999997, which is 120.00 rounded once at the end.
do $$
declare i int; s numeric; w numeric; t uuid[] := '{}';
begin
  if pg_temp.scale('inventory_lots', 'unit_cost') < 6 then
    raise notice 'merged-tree checks skipped: #909 not applied';
    return;
  end if;
  perform pg_temp.mv('a', 200, 10.0049);
  select wac into w from public.inventory_lot_rollup where inventory_id = pg_temp.u('2a0');
  for i in 1..200 loop t := t || pg_temp.mv('a', -1); end loop;
  select sum(cost_total) into s from public.inventory_transactions where id = any(t);
  assert s = 2000.98, format('M1 FAIL: 200 one-bottle sales at 10.0049 cost %s, expected 2000.98', s);
  assert w = 10.0049, format('M2 FAIL: inventory_lot_rollup.wac is %s, expected 10.0049', w);
  t := '{}';
  perform pg_temp.mv('b', 13, 9.230769);
  for i in 1..13 loop t := t || pg_temp.mv('b', -1); end loop;
  select sum(cost_total) into s from public.inventory_transactions where id = any(t);
  assert s = 119.999997 and round(s, 2) = 120.00,
    format('M3 FAIL: 13 sales at 9.230769 carry %s (rounded at the end %s), expected 119.999997 / 120.00', s, round(s, 2));
end $$;

-- C1-C2 (any tree): the columns carry six places, and a 10.00 x1 + 10.01 x2
-- blend has wac 30.02 / 3 = 10.006667 in both lot views.
do $$
declare w numeric; wl numeric;
begin
  assert pg_temp.scale('inventory_lot_draws', 'unit_cost') = 6, 'C1 FAIL: inventory_lot_draws.unit_cost is not scale 6';
  assert pg_temp.scale('inventory_transactions', 'cost_total') = 6, 'C1 FAIL: inventory_transactions.cost_total is not scale 6';
  perform pg_temp.mv('c', 1, 10.00);
  perform pg_temp.mv('c', 2, 10.01);
  select wac into w from public.inventory_lot_rollup where inventory_id = pg_temp.u('2c0');
  select wac into wl from public.inventory_location_breakdown where inventory_id = pg_temp.u('2c0');
  assert w = 10.006667 and wl = 10.006667, format('C2 FAIL: blend wac rollup %s, breakdown %s, expected 10.006667', w, wl);
end $$;

select 'a_sale_keeps_six_places: pass' as result;
rollback;
