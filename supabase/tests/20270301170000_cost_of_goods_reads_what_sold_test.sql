-- A-046 / A-018 (analytics walk, 2026-10-03): cost of goods summed delivered
-- purchases and the revenue Gini read shelf value. Migration
-- cost_of_goods_reads_what_sold (ADR 0298) adds public.pos_item_sales, the one
-- read of what the till sold per stock item and the bottles the POS moved.
--
-- Self-asserting (assert -> P0004, or a RAISE naming the test); run with
-- `psql -v ON_ERROR_STOP=1 -f` on a database built from supabase/migrations.
-- Synthetic fixtures, one transaction, rolled back. Without the migration
-- every block from T1 on fails: the function and the index do not exist.
-- Ids: house N is u('N'), item x is u('2x0'), its wine u('1x0').

begin;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('c0980000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;
create function pg_temp.cg_read(p_days int default 365, p_house text default '1') returns jsonb language sql as $$
  select public.pos_item_sales(pg_temp.u(p_house), now() - make_interval(days => p_days))
$$;
create function pg_temp.cg_item(r jsonb, l text) returns jsonb language sql as $$
  select e from jsonb_array_elements(r -> 'items') e where (e ->> 'inventory_id')::uuid = pg_temp.u('2' || l || '0')
$$;
-- A stock write through the real path, keyed 'cg-test:<k>'.
create function pg_temp.mv(l text, st text, q int, ty text, src text, k text, cost numeric default null, prov text default null)
returns void language plpgsql as $$
begin
  perform public.apply_stock_movement(pg_temp.u('2' || l || '0'), st, q, ty, src, null, 'cg test', cost, null, null, 'cg-test:' || k, prov);
end $$;
-- A check of house h closed `ago` back (null: still open), opened an hour before.
create function pg_temp.chk(h text, k text, ago interval, items jsonb, v boolean default false) returns void language sql as $$
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, closed_at, voided, items)
  values (pg_temp.u(h), 'cg_test', k, coalesce(now() - ago, now()) - interval '1 hour', now() - ago, v, items)
$$;
create function pg_temp.ln(l text, q numeric, p numeric) returns jsonb language sql as $$
  select jsonb_build_object('name', upper(l), 'inventory_id', pg_temp.u('2' || l || '0'), 'qty', q, 'price', p)
$$;

do $$
declare
  x text;
begin
  insert into public.restaurants (id, name, slug) values
    (pg_temp.u('1'), 'CG test house 1', 'cg-test-house-1'),
    (pg_temp.u('2'), 'CG test house 2', 'cg-test-house-2');
  foreach x in array array['a', 'b', 'c', 'd', 'e', 'f'] loop
    insert into public.master_wine_library (id, wine_id, name, primary_type)
      values (pg_temp.u('1' || x || '0'), 'CG-TEST-' || upper(x), 'CG test wine ' || upper(x), 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
      values (pg_temp.u('2' || x || '0'), pg_temp.u(case when x = 'd' then '2' else '1' end), pg_temp.u('1' || x || '0'), 750, 150);
  end loop;

  -- Mappings. A twice (two sources) and F (never sold) are house 1's and point
  -- at its own items. None of the rest may mark anything: a mapping with no
  -- inventory_id, house 1's at house 2's item D, and house 2's at house 1's C.
  insert into public.pos_item_mappings (restaurant_id, source, external_item_id, item_name, is_wine, inventory_id) values
    (pg_temp.u('1'), 'cg_test', 'x-a', 'A', true, pg_temp.u('2a0')),
    (pg_temp.u('1'), '*', 'x-a', 'A', true, pg_temp.u('2a0')),
    (pg_temp.u('1'), 'cg_test', 'x-f', 'F', true, pg_temp.u('2f0')),
    (pg_temp.u('1'), 'cg_test', 'x-tea', 'Tea', false, null),
    (pg_temp.u('1'), 'cg_test', 'x-d', 'D', true, pg_temp.u('2d0')),
    (pg_temp.u('2'), 'cg_test', 'x-c', 'C', true, pg_temp.u('2c0'));

  -- Stock in (a purchase is not a sale).
  foreach x in array array['a', 'b', 'c', 'd'] loop
    perform pg_temp.mv(x, 'live', 10, 'purchase', 'order', 'in-' || x, 10, 'invoice');
  end loop;
  perform pg_temp.mv('b', 'shadow', 2, 'purchase', 'order', 'in-b-shadow', 10, 'invoice');

  -- Counted: POS sales and a POS void, in the window.
  perform pg_temp.mv('a', 'live', -2, 'sale', 'pos', 'sale-a');
  perform pg_temp.mv('a', 'live', -1, 'sale', 'pos', 'sale-a2');
  perform pg_temp.mv('a', 'live', 1, 'return', 'pos', 'sale-a2:void');
  perform pg_temp.mv('b', 'live', -1, 'sale', 'pos', 'sale-b');
  -- A POS void with no sale in the window (B19's shape): net negative.
  perform pg_temp.mv('e', 'live', 3, 'return', 'pos', 'void-e');
  -- An older POS sale of A, five days back, written directly: the first move.
  insert into public.inventory_transactions
    (restaurant_id, inventory_id, transaction_type, source, quantity_change, quantity_before, quantity_after, stock_type, transaction_date)
  values (pg_temp.u('1'), pg_temp.u('2a0'), 'sale', 'pos', -1, 9, 8, 'live', now() - interval '5 days');

  -- Not counted: a manual sale, a POS waste, a shadow POS sale, a POS sale
  -- before the window, and the other house's POS sale.
  perform pg_temp.mv('c', 'live', -4, 'sale', 'manual', 'manual-c');
  perform pg_temp.mv('b', 'live', -2, 'waste', 'pos', 'waste-b');
  perform pg_temp.mv('b', 'shadow', -1, 'sale', 'pos', 'shadow-b');
  insert into public.inventory_transactions
    (restaurant_id, inventory_id, transaction_type, source, quantity_change, quantity_before, quantity_after, stock_type, transaction_date)
  values (pg_temp.u('1'), pg_temp.u('2c0'), 'sale', 'pos', -3, 9, 6, 'live', now() - interval '400 days');
  perform pg_temp.mv('d', 'live', -4, 'sale', 'pos', 'sale-d');

  -- k1: two mapped lines, an unmapped line, and a line naming A whose qty is unreadable.
  perform pg_temp.chk('1', 'k1', '1 day', jsonb_build_array(pg_temp.ln('a', 2, 12), pg_temp.ln('b', 1, 40),
    jsonb_build_object('name', 'Tea', 'inventory_id', null, 'qty', 3, 'price', 3),
    jsonb_build_object('name', 'A bad', 'inventory_id', pg_temp.u('2a0'), 'qty', 'x', 'price', 12)));
  -- k2: numbers as strings, a line with no inventory_id key, a bad id, a non-object line.
  perform pg_temp.chk('1', 'k2', '2 days', jsonb_build_array(
    jsonb_build_object('name', 'B', 'inventory_id', pg_temp.u('2b0')::text, 'qty', '1', 'price', '40.50'),
    jsonb_build_object('name', 'Food', 'qty', 1, 'price', 20),
    jsonb_build_object('name', 'Bad id', 'inventory_id', 'not-a-uuid', 'qty', 1, 'price', 5),
    to_jsonb('a string line'::text)));
  -- k3 voided, k4 still open, k5 closed before the window: none counts. k6 is the other house's.
  perform pg_temp.chk('1', 'k3', '1 day', jsonb_build_array(pg_temp.ln('a', 5, 12)), true);
  perform pg_temp.chk('1', 'k4', null, jsonb_build_array(pg_temp.ln('a', 7, 12)));
  perform pg_temp.chk('1', 'k5', '400 days', jsonb_build_array(pg_temp.ln('c', 9, 12)));
  perform pg_temp.chk('2', 'k6', '1 day', jsonb_build_array(pg_temp.ln('d', 4, 10)));
  -- k7: a closed check whose items is not an array. A check, no lines, no raise.
  perform pg_temp.chk('1', 'k7', '3 days', '{}'::jsonb);
end $$;

-- T1 mapped lines: sales = price x qty, units and lines per stock item.
do $$
declare
  r jsonb := pg_temp.cg_read();
  ia jsonb := pg_temp.cg_item(r, 'a');
  ib jsonb := pg_temp.cg_item(r, 'b');
begin
  assert ia is not null, format('T1 FAIL item A missing from %s', r);
  assert (ia ->> 'sales')::numeric = 24 and (ia ->> 'units')::numeric = 2 and (ia ->> 'lines')::int = 1,
    format('T1 FAIL A is %s, expected sales 24, units 2, lines 1', ia);
  assert (ib ->> 'sales')::numeric = 80.5 and (ib ->> 'units')::numeric = 2 and (ib ->> 'lines')::int = 2,
    format('T1 FAIL B is %s, expected sales 80.5, units 2, lines 2 (string numbers read)', ib);
end $$;

-- T2 a voided and an open check add nothing; T3 nor do a check before the
-- window, a manual sale, or the other house's check.
do $$
declare
  r jsonb := pg_temp.cg_read();
begin
  assert (r ->> 'checks')::int = 3, format('T2 FAIL checks %s, expected 3 (k1, k2, k7)', r ->> 'checks');
  assert pg_temp.cg_item(r, 'c') is null, format('T3 FAIL item C appears: %s', r);
  assert pg_temp.cg_item(r, 'd') is null, format('T3 FAIL the other house''s item appears: %s', r);
end $$;

-- T4 unmapped and unreadable lines are counted, never raised.
do $$
declare
  r jsonb := pg_temp.cg_read();
begin
  assert (r ->> 'lines')::int = 8, format('T4 FAIL lines %s, expected 8', r ->> 'lines');
  assert (r ->> 'unmapped_lines')::int = 2, format('T4 FAIL unmapped_lines %s, expected 2', r ->> 'unmapped_lines');
  assert (r ->> 'unmapped_sales')::numeric = 29, format('T4 FAIL unmapped_sales %s, expected 29', r ->> 'unmapped_sales');
  assert (r ->> 'unreadable_lines')::int = 3, format('T4 FAIL unreadable_lines %s, expected 3', r ->> 'unreadable_lines');
end $$;

-- T5 POS sale and return rows net per item; manual, waste, shadow, pre-window
-- and other-house rows are not the till's movement.
do $$
declare
  r jsonb := pg_temp.cg_read();
  ie jsonb := pg_temp.cg_item(r, 'e');
begin
  assert (pg_temp.cg_item(r, 'a') ->> 'bottles_out')::numeric = 3, format('T5 FAIL A bottles_out, expected 3 (2 + 1 - 1 + 1): %s', r);
  assert (pg_temp.cg_item(r, 'b') ->> 'bottles_out')::numeric = 1, format('T5 FAIL B bottles_out, expected 1 (waste, shadow out): %s', r);
  -- A void with no sale in the window is reported as it is, not clamped here.
  assert ie is not null and (ie ->> 'bottles_out')::numeric = -3 and (ie ->> 'sales')::numeric = 0,
    format('T5 FAIL E is %s, expected bottles_out -3 and sales 0', ie);
  assert jsonb_array_length(r -> 'items') = 4, format('T5 FAIL %s items, expected A, B, E and the mapped F', jsonb_array_length(r -> 'items'));
end $$;

-- T6 first_sale_at is the earliest closed check or POS ledger row in the
-- window (the direct row, five days back); an empty window reads zero checks,
-- no items and no date.
do $$
declare
  z jsonb := public.pos_item_sales(pg_temp.u('2'), now() + interval '1 day');
begin
  assert (pg_temp.cg_read() ->> 'first_sale_at')::timestamptz = now() - interval '5 days', 'T6 FAIL first_sale_at is not five days back';
  assert (z ->> 'checks')::int = 0 and z -> 'items' = '[]'::jsonb and z -> 'first_sale_at' = 'null'::jsonb,
    format('T6 FAIL an empty window reads %s', z);
  assert (pg_temp.cg_read(4) ->> 'first_sale_at')::timestamptz = now() - interval '3 days',
    'T6 FAIL a 4-day window should start at the 3-day-old check';
end $$;

-- T7 SECURITY INVOKER, STABLE, and only service_role may run it.
do $$
declare
  f oid := 'public.pos_item_sales(uuid, timestamptz)'::regprocedure;
begin
  assert not (select prosecdef from pg_proc where oid = f), 'T7 FAIL pos_item_sales is SECURITY DEFINER';
  assert (select provolatile from pg_proc where oid = f) = 's', 'T7 FAIL pos_item_sales is not STABLE';
  assert not has_function_privilege('anon', f, 'EXECUTE'), 'T7 FAIL anon may execute pos_item_sales';
  assert not has_function_privilege('authenticated', f, 'EXECUTE'), 'T7 FAIL authenticated may execute pos_item_sales';
  assert has_function_privilege('service_role', f, 'EXECUTE'), 'T7 FAIL service_role may not execute pos_item_sales';
end $$;

-- T8 the closed-check window has its index.
do $$
begin
  assert exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'pos_checks'
                  and indexname = 'idx_pos_checks_restaurant_closed'),
    'T8 FAIL idx_pos_checks_restaurant_closed is missing';
end $$;

-- T9 mapped: an item this house's mappings point at is flagged, and listed
-- with zeros when it neither sold nor moved (F); one that sold but no mapping
-- points at is not (B, E); a null mapping, a mapping at another house's item,
-- and another house's mapping flag nothing.
do $$
declare
  r jsonb := pg_temp.cg_read();
  i_f jsonb := pg_temp.cg_item(r, 'f');
  r2 jsonb := pg_temp.cg_read(365, '2');
begin
  assert (i_f -> 'mapped') = 'true'::jsonb and (i_f ->> 'sales')::numeric = 0
     and (i_f ->> 'bottles_out')::numeric = 0 and (i_f ->> 'lines')::int = 0,
    format('T9 FAIL F is %s, expected mapped, sales 0, bottles_out 0, lines 0', i_f);
  assert (pg_temp.cg_item(r, 'a') -> 'mapped') = 'true'::jsonb, format('T9 FAIL A should be mapped (two rows, one item): %s', r);
  assert (pg_temp.cg_item(r, 'b') -> 'mapped') = 'false'::jsonb and (pg_temp.cg_item(r, 'e') -> 'mapped') = 'false'::jsonb,
    format('T9 FAIL B and E should not be mapped: %s', r);
  assert (select count(*) from jsonb_array_elements(r -> 'items') x where (x ->> 'inventory_id')::uuid = pg_temp.u('2a0')) = 1,
    'T9 FAIL item A is listed more than once';
  assert pg_temp.cg_item(r, 'd') is null, format('T9 FAIL house 1''s mapping at D lists D for house 1: %s', r);
  assert pg_temp.cg_item(r2, 'c') is null, format('T9 FAIL house 2''s mapping at C lists C for house 2: %s', r2);
  assert (pg_temp.cg_item(r2, 'd') -> 'mapped') = 'false'::jsonb, format('T9 FAIL house 1''s mapping flags D for house 2: %s', r2);
end $$;

-- T10 the two clocks, apart: sales start at the first closed check (k7, three
-- days back), cost of goods at the first POS ledger row (five days back), and
-- first_sale_at is the earlier. A 4-day window starts its moves at today's
-- rows; an empty window has neither.
do $$
declare
  r jsonb := pg_temp.cg_read();
  r4 jsonb := pg_temp.cg_read(4);
  z jsonb := public.pos_item_sales(pg_temp.u('2'), now() + interval '1 day');
begin
  assert (r ->> 'first_check_at')::timestamptz = now() - interval '3 days', format('T10 FAIL first_check_at %s', r ->> 'first_check_at');
  assert (r ->> 'first_move_at')::timestamptz = now() - interval '5 days', format('T10 FAIL first_move_at %s', r ->> 'first_move_at');
  assert (r ->> 'first_sale_at')::timestamptz = least((r ->> 'first_check_at')::timestamptz, (r ->> 'first_move_at')::timestamptz),
    format('T10 FAIL first_sale_at %s is not the earlier clock', r ->> 'first_sale_at');
  assert (r4 ->> 'first_check_at')::timestamptz = now() - interval '3 days' and (r4 ->> 'first_move_at')::timestamptz = now(),
    format('T10 FAIL a 4-day window reads check %s and move %s', r4 ->> 'first_check_at', r4 ->> 'first_move_at');
  assert z -> 'first_check_at' = 'null'::jsonb and z -> 'first_move_at' = 'null'::jsonb, format('T10 FAIL an empty window reads %s', z);
end $$;

-- T11 what the gateway's ingest can write does not raise: the adapters coerce
-- price and qty to finite numbers, and the largest finite double squared fits
-- numeric. The check is undone by a raise this block catches.
do $$
declare
  big numeric := 1.7976931348623157e308;
  r jsonb;
begin
  begin
    perform pg_temp.chk('1', 'k-max', '0', jsonb_build_array(pg_temp.ln('a', big, big)));
    r := pg_temp.cg_read();
    assert (pg_temp.cg_item(r, 'a') ->> 'sales')::numeric > big * big,
      format('T11 FAIL the largest double squared did not land in A''s sales: %s', r);
    raise exception 'cg-undo';
  exception when others then
    if sqlerrm <> 'cg-undo' then raise; end if;
  end;
end $$;

-- T12 what does raise: a price string longer than numeric holds, written
-- directly (not through ingest), passes the digit pattern and overflows the
-- cast for the whole call, which the gateway reads as a failed read.
do $$
declare
  raised boolean := false;
begin
  begin
    perform pg_temp.chk('1', 'k-huge', '0', jsonb_build_array(
      jsonb_build_object('name', 'A', 'inventory_id', pg_temp.u('2a0'), 'qty', 1, 'price', repeat('9', 140000))));
    perform pg_temp.cg_read();
  exception when numeric_value_out_of_range then
    raised := true;
  end;
  assert raised, 'T12 FAIL a 140000-digit price string written directly did not raise 22003';
  assert not exists (select 1 from public.pos_checks where external_check_id = 'k-huge'),
    'T12 FAIL the k-huge check outlived its block';
end $$;

-- T13 two columns the function leans on are NOT NULL: a NULL voided would drop
-- a check's sales while its bottles still count, and a NULL ledger
-- inventory_id would surface as an item with no id.
do $$
begin
  assert (select attnotnull from pg_attribute where attrelid = 'public.pos_checks'::regclass and attname = 'voided'),
    'T13 FAIL pos_checks.voided is nullable';
  assert (select attnotnull from pg_attribute where attrelid = 'public.inventory_transactions'::regclass and attname = 'inventory_id'),
    'T13 FAIL inventory_transactions.inventory_id is nullable';
end $$;

rollback;
