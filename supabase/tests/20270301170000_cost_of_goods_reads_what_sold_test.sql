-- public.pos_item_sales, migration cost_of_goods_reads_what_sold (ADR 0298
-- decision 8, A-046 / A-018): what the till sold per stock item and the
-- bottles it moved.
--
-- Self-asserting (assert -> P0004); run with `psql -v ON_ERROR_STOP=1 -f` on a
-- database built from supabase/migrations. CI runs no supabase/tests file.
-- Run on 2026-11-01 on PGlite 0.5.8 over every migration: it passes, and
-- without the migration it fails (42883). Synthetic fixtures, one transaction,
-- rolled back. House N is u('N'), item x u('2x0'), wine u('1x0'). Each block
-- says how its figures follow from the fixtures.

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
-- A stock line in the shape the ingest writes (pos-hub.service.ts:1050-1061).
create function pg_temp.ln(l text, q numeric, p numeric) returns jsonb language sql as $$
  select jsonb_build_object('name', upper(l), 'external_item_id', 'x-' || l, 'category', null, 'qty', q,
    'price', p, 'is_wine', true, 'master_wine_id', pg_temp.u('1' || l || '0'),
    'inventory_id', pg_temp.u('2' || l || '0'), 'sale_unit', null, 'sale_volume_ml', null)
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

  -- Mapped: A (twice) and F (never sold). Not: Tea (no item), house 1's at
  -- house 2's D, house 2's at house 1's C.
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

  -- Not counted: manual, waste, shadow, pre-window, other house.
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

-- T1 sales = price x qty, units and lines per item. A: k1's 2 x 12 = 24 (k1's
-- 'A bad' line is unreadable, k3 voided, k4 open). B: k1's 1 x 40 + k2's
-- '1' x '40.50' (strings) = 80.5 over 2 lines.
do $$
declare
  r jsonb := pg_temp.cg_read();
  ia jsonb := pg_temp.cg_item(r, 'a');
  ib jsonb := pg_temp.cg_item(r, 'b');
begin
  assert (ia ->> 'sales')::numeric = 24 and (ia ->> 'units')::numeric = 2 and (ia ->> 'lines')::int = 1, format('T1 A %s', ia);
  assert (ib ->> 'sales')::numeric = 80.5 and (ib ->> 'units')::numeric = 2 and (ib ->> 'lines')::int = 2, format('T1 B %s', ib);
end $$;

-- T2 checks: k1, k2, k7 (k3 voided, k4 open, k5 before the window, k6 house
-- 2's). T3 house 1 lists neither C (k5 and its POS row predate the window,
-- its other rows are a purchase and a manual sale, its one mapping is house
-- 2's) nor D (house 2's item: house 1 neither sold nor moved it, and the house
-- join drops house 1's mapping of it).
do $$
declare
  r jsonb := pg_temp.cg_read();
begin
  assert (r ->> 'checks')::int = 3, format('T2 checks %s', r ->> 'checks');
  assert pg_temp.cg_item(r, 'c') is null, format('T3 C %s', r);
  assert pg_temp.cg_item(r, 'd') is null, format('T3 D %s', r);
end $$;

-- T4 lines: k1's 4 + k2's 4 + k7's 0 = 8. Unmapped: Tea (id null) and Food
-- (no id key), 3 x 3 + 1 x 20 = 29. Unreadable: 'A bad' (qty 'x'), 'Bad id',
-- the string line. The other 3 are T1's mapped lines.
do $$
declare
  r jsonb := pg_temp.cg_read();
begin
  assert (r ->> 'lines')::int = 8 and (r ->> 'unmapped_lines')::int = 2 and (r ->> 'unmapped_sales')::numeric = 29
     and (r ->> 'unreadable_lines')::int = 3, format('T4 %s', r - 'items');
end $$;

-- T5 bottles_out nets POS sale and return rows. A: -(-2 - 1 + 1 - 1) = 3.
-- B: 1 (its waste and shadow rows fall out). E: a return alone, -3. Items:
-- sold {A, B} + moved {A, B, E} + mapped {A, F} = 4.
do $$
declare
  r jsonb := pg_temp.cg_read();
  ie jsonb := pg_temp.cg_item(r, 'e');
begin
  assert (pg_temp.cg_item(r, 'a') ->> 'bottles_out')::numeric = 3, format('T5 A %s', r);
  assert (pg_temp.cg_item(r, 'b') ->> 'bottles_out')::numeric = 1, format('T5 B %s', r);
  assert (ie ->> 'bottles_out')::numeric = -3 and (ie ->> 'sales')::numeric = 0, format('T5 E %s', ie);
  assert jsonb_array_length(r -> 'items') = 4, format('T5 %s items, not 4', jsonb_array_length(r -> 'items'));
end $$;

-- T6 SECURITY INVOKER, STABLE, only service_role may run it; T7 the index.
do $$
declare
  f oid := 'public.pos_item_sales(uuid, timestamptz)'::regprocedure;
begin
  assert not (select prosecdef from pg_proc where oid = f), 'T6 SECURITY DEFINER';
  assert (select provolatile from pg_proc where oid = f) = 's', 'T6 not STABLE';
  assert not has_function_privilege('anon', f, 'EXECUTE')
     and not has_function_privilege('authenticated', f, 'EXECUTE'), 'T6 anon or authenticated may execute';
  assert has_function_privilege('service_role', f, 'EXECUTE'), 'T6 service_role may not execute';
  assert (select indrelid from pg_index where indexrelid = to_regclass('public.idx_pos_checks_restaurant_closed'))
     = 'public.pos_checks'::regclass, 'T7 index missing';
end $$;

-- T8 mapped. House 1: F (never sold) with zeros; A, listed once though two
-- mappings name it; not B or E, which no mapping names. House 2 lists D (k6
-- and sale-d), not mapped, since D's one mapping is house 1's; and not C,
-- whose house-2 mapping names house 1's item.
do $$
declare
  r jsonb := pg_temp.cg_read();
  i_f jsonb := pg_temp.cg_item(r, 'f');
  r2 jsonb := pg_temp.cg_read(365, '2');
begin
  assert (i_f -> 'mapped') = 'true'::jsonb and (i_f ->> 'sales')::numeric = 0
     and (i_f ->> 'bottles_out')::numeric = 0 and (i_f ->> 'lines')::int = 0, format('T8 F %s', i_f);
  assert (pg_temp.cg_item(r, 'a') -> 'mapped') = 'true'::jsonb, format('T8 A %s', r);
  assert (pg_temp.cg_item(r, 'b') -> 'mapped') = 'false'::jsonb and (pg_temp.cg_item(r, 'e') -> 'mapped') = 'false'::jsonb,
    format('T8 B, E %s', r);
  assert (select count(*) from jsonb_array_elements(r -> 'items') x where (x ->> 'inventory_id')::uuid = pg_temp.u('2a0')) = 1,
    'T8 A listed twice';
  assert pg_temp.cg_item(r2, 'c') is null, format('T8 house 2 lists C %s', r2);
  assert (pg_temp.cg_item(r2, 'd') -> 'mapped') = 'false'::jsonb, format('T8 house 2 D %s', r2);
end $$;

-- T9 decision 8's raise: a 140,000-digit price string passes the pattern, and
-- numeric holds at most 131,072 digits before the point, so the call raises
-- 22003. The handler rolls the block's check back.
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
  assert raised, 'T9 a 140000-digit price did not raise 22003';
  assert not exists (select 1 from public.pos_checks where external_check_id = 'k-huge'), 'T9 k-huge outlived its block';
end $$;

-- T10 the NOT NULLs the function leans on.
do $$
begin
  assert (select attnotnull from pg_attribute where attrelid = 'public.pos_checks'::regclass and attname = 'voided'),
    'T10 pos_checks.voided is nullable';
  assert (select attnotnull from pg_attribute where attrelid = 'public.inventory_transactions'::regclass and attname = 'inventory_id'),
    'T10 inventory_transactions.inventory_id is nullable';
end $$;

-- T11 in_house. Every item house 1 lists (A, B, E, F) is its own. A house-1
-- line naming house 2's D lists D with 1 x 10 = 10, in_house false, and not
-- mapped, as T3's house join drops house 1's mapping of D. Raising cg-undo
-- rolls the check back.
do $$
declare
  r jsonb;
begin
  assert (select bool_and((x ->> 'in_house')::boolean) from jsonb_array_elements(pg_temp.cg_read() -> 'items') x),
    'T11 an item of house 1 reads in_house false';
  begin
    perform pg_temp.chk('1', 'k-foreign', '0', jsonb_build_array(pg_temp.ln('d', 1, 10)));
    r := pg_temp.cg_read();
    assert pg_temp.cg_item(r, 'd') @> '{"in_house": false, "mapped": false, "sales": 10}', format('T11 D %s', pg_temp.cg_item(r, 'd'));
    raise exception 'cg-undo';
  exception when others then
    if sqlerrm <> 'cg-undo' then raise; end if;
  end;
end $$;

-- T12 the clocks. first_check_at: k7, 3 days back (k1 and k2 are later, k5
-- predates the window). first_move_at: A's row written 5 days back; every
-- other row here is written at now(), the transaction's start. first_sale_at:
-- the earlier, 5 days. A 4-day window drops that row, so its first move is
-- now(). House 2 from tomorrow on has nothing: every clock is null.
do $$
declare
  r jsonb := pg_temp.cg_read();
  r4 jsonb := pg_temp.cg_read(4);
  z jsonb := public.pos_item_sales(pg_temp.u('2'), now() + interval '1 day');
begin
  assert (r ->> 'first_check_at')::timestamptz = now() - interval '3 days'
     and (r ->> 'first_move_at')::timestamptz = now() - interval '5 days'
     and (r ->> 'first_sale_at')::timestamptz = now() - interval '5 days', format('T12 %s', r - 'items');
  assert (r4 ->> 'first_check_at')::timestamptz = now() - interval '3 days' and (r4 ->> 'first_move_at')::timestamptz = now(),
    format('T12 4 days %s', r4 - 'items');
  assert (z ->> 'checks')::int = 0 and z -> 'items' = '[]'::jsonb and z -> 'first_sale_at' = 'null'::jsonb
     and z -> 'first_check_at' = 'null'::jsonb and z -> 'first_move_at' = 'null'::jsonb, format('T12 empty %s', z);
end $$;

-- T13 what the ingest can write never raises: the largest finite double,
-- 1.7976931348623157e308, squared is about 3.2e616, far inside numeric's
-- 131,072 digits. A then reads k1's 24 plus big x big. Raising cg-undo rolls
-- the check back.
do $$
declare
  big numeric := 1.7976931348623157e308;
  r jsonb;
begin
  begin
    perform pg_temp.chk('1', 'k-max', '0', jsonb_build_array(pg_temp.ln('a', big, big)));
    r := pg_temp.cg_read();
    assert (pg_temp.cg_item(r, 'a') ->> 'sales')::numeric = 24 + big * big, format('T13 %s', pg_temp.cg_item(r, 'a'));
    raise exception 'cg-undo';
  exception when others then
    if sqlerrm <> 'cg-undo' then raise; end if;
  end;
end $$;

rollback;
