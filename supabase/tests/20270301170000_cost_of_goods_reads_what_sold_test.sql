-- A-046 / A-018 (analytics walk, 2026-10-03): "Cost of goods (365d)" summed
-- delivered purchase orders, "revenue" was menu price x bottles on hand, and
-- the revenue Gini read the same shelf value. Migration
-- cost_of_goods_reads_what_sold (ADR 0298) adds public.pos_item_sales, the
-- one read of what the till sold per stock item and the bottles the POS moved.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or a
-- RAISE naming the test), so `psql -v ON_ERROR_STOP=1 -f` stops at the first
-- one. Run it on a database built from supabase/migrations. Synthetic
-- fixtures only, one transaction, rolled back.
--
-- On a build WITHOUT that migration every block from T1 on FAILS: the function
-- and the index do not exist. T10 pins the two clocks the gateway's span
-- check reads; T11 and T12 pin where the function can and cannot raise, as
-- its COMMENT now says.

begin;

create function pg_temp.cg_read(p_house uuid, p_days int default 365) returns jsonb language sql as $$
  select public.pos_item_sales(p_house, now() - make_interval(days => p_days))
$$;
create function pg_temp.cg_item(r jsonb, p uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(r -> 'items') e where (e ->> 'inventory_id')::uuid = p
$$;

do $$
declare
  h1 uuid := 'c0980000-0000-4000-8000-000000000001';
  h2 uuid := 'c0980000-0000-4000-8000-000000000002';
  a uuid := 'c0980000-0000-4000-8000-0000000002a0';
  b uuid := 'c0980000-0000-4000-8000-0000000002b0';
  c uuid := 'c0980000-0000-4000-8000-0000000002c0';
  d uuid := 'c0980000-0000-4000-8000-0000000002d0';
  e uuid := 'c0980000-0000-4000-8000-0000000002e0';
  f uuid := 'c0980000-0000-4000-8000-0000000002f0';
begin
  insert into public.restaurants (id, name, slug) values
    (h1, 'CG test house 1', 'cg-test-house-1'),
    (h2, 'CG test house 2', 'cg-test-house-2');
  insert into public.master_wine_library (id, wine_id, name, primary_type) values
    ('c0980000-0000-4000-8000-0000000001a0', 'CG-TEST-A', 'CG test wine A', 'red'),
    ('c0980000-0000-4000-8000-0000000001b0', 'CG-TEST-B', 'CG test wine B', 'red'),
    ('c0980000-0000-4000-8000-0000000001c0', 'CG-TEST-C', 'CG test wine C', 'red'),
    ('c0980000-0000-4000-8000-0000000001d0', 'CG-TEST-D', 'CG test wine D', 'red'),
    ('c0980000-0000-4000-8000-0000000001e0', 'CG-TEST-E', 'CG test wine E', 'red'),
    ('c0980000-0000-4000-8000-0000000001f0', 'CG-TEST-F', 'CG test wine F', 'red');
  insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml) values
    (a, h1, 'c0980000-0000-4000-8000-0000000001a0', 750, 150),
    (b, h1, 'c0980000-0000-4000-8000-0000000001b0', 750, 150),
    (c, h1, 'c0980000-0000-4000-8000-0000000001c0', 750, 150),
    (d, h2, 'c0980000-0000-4000-8000-0000000001d0', 750, 150),
    (e, h1, 'c0980000-0000-4000-8000-0000000001e0', 750, 150),
    (f, h1, 'c0980000-0000-4000-8000-0000000001f0', 750, 150);

  -- POS mappings. A twice (two sources) and F (never sold) are this house's
  -- and point at its own items. The rest must not mark anything: a mapping
  -- with no inventory_id, h1's mapping at h2's item D, and h2's at h1's C.
  insert into public.pos_item_mappings (restaurant_id, source, external_item_id, item_name, is_wine, inventory_id) values
    (h1, 'cg_test', 'x-a', 'A', true, a),
    (h1, '*', 'x-a', 'A', true, a),
    (h1, 'cg_test', 'x-f', 'F', true, f),
    (h1, 'cg_test', 'x-tea', 'Tea', false, null),
    (h1, 'cg_test', 'x-d', 'D', true, d),
    (h2, 'cg_test', 'x-c', 'C', true, c);

  -- Stock in, through the real write path (a purchase is not a sale).
  perform public.apply_stock_movement(a, 'live', 10, 'purchase', 'order', null, 'cg test', 10, null, null, 'cg-test:in-a', 'invoice');
  perform public.apply_stock_movement(b, 'live', 10, 'purchase', 'order', null, 'cg test', 10, null, null, 'cg-test:in-b', 'invoice');
  perform public.apply_stock_movement(c, 'live', 10, 'purchase', 'order', null, 'cg test', 10, null, null, 'cg-test:in-c', 'invoice');
  perform public.apply_stock_movement(d, 'live', 10, 'purchase', 'order', null, 'cg test', 10, null, null, 'cg-test:in-d', 'invoice');
  perform public.apply_stock_movement(b, 'shadow', 2, 'purchase', 'order', null, 'cg test', 10, null, null, 'cg-test:in-b-shadow', 'invoice');

  -- Counted: POS sales and a POS void, in the window.
  perform public.apply_stock_movement(a, 'live', -2, 'sale', 'pos', null, 'cg test', null, null, null, 'cg-test:sale-a');
  perform public.apply_stock_movement(a, 'live', -1, 'sale', 'pos', null, 'cg test', null, null, null, 'cg-test:sale-a2');
  perform public.apply_stock_movement(a, 'live', 1, 'return', 'pos', null, 'cg test', null, null, null, 'cg-test:sale-a2:void');
  perform public.apply_stock_movement(b, 'live', -1, 'sale', 'pos', null, 'cg test', null, null, null, 'cg-test:sale-b');
  -- A POS void with no sale in the window (ADR 0011 B19's shape): net negative.
  perform public.apply_stock_movement(e, 'live', 3, 'return', 'pos', null, 'cg test', null, null, null, 'cg-test:void-e');
  -- An older POS sale of A, five days ago, written directly: it sets first_sale_at.
  insert into public.inventory_transactions
    (restaurant_id, inventory_id, transaction_type, source, quantity_change, quantity_before, quantity_after, stock_type, transaction_date)
  values (h1, a, 'sale', 'pos', -1, 9, 8, 'live', now() - interval '5 days');

  -- Not counted: a manual sale, a POS-sourced waste, a shadow POS sale, a POS
  -- sale before the window, and the other house's POS sale.
  perform public.apply_stock_movement(c, 'live', -4, 'sale', 'manual', null, 'cg test', null, null, null, 'cg-test:manual-c');
  perform public.apply_stock_movement(b, 'live', -2, 'waste', 'pos', null, 'cg test', null, null, null, 'cg-test:waste-b');
  perform public.apply_stock_movement(b, 'shadow', -1, 'sale', 'pos', null, 'cg test', null, null, null, 'cg-test:shadow-b');
  insert into public.inventory_transactions
    (restaurant_id, inventory_id, transaction_type, source, quantity_change, quantity_before, quantity_after, stock_type, transaction_date)
  values (h1, c, 'sale', 'pos', -3, 9, 6, 'live', now() - interval '400 days');
  perform public.apply_stock_movement(d, 'live', -4, 'sale', 'pos', null, 'cg test', null, null, null, 'cg-test:sale-d');

  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, closed_at, voided, items) values
    -- k1: two mapped lines, an unmapped line, and a line naming A whose qty is unreadable.
    (h1, 'cg_test', 'k1', now() - interval '1 day 1 hour', now() - interval '1 day', false,
     jsonb_build_array(
       jsonb_build_object('name', 'A', 'inventory_id', a, 'qty', 2, 'price', 12),
       jsonb_build_object('name', 'B', 'inventory_id', b, 'qty', 1, 'price', 40),
       jsonb_build_object('name', 'Tea', 'inventory_id', null, 'qty', 3, 'price', 3),
       jsonb_build_object('name', 'A bad', 'inventory_id', a, 'qty', 'x', 'price', 12))),
    -- k2: numbers sent as strings, a line with no inventory_id key, a bad id, a non-object line.
    (h1, 'cg_test', 'k2', now() - interval '2 days 1 hour', now() - interval '2 days', false,
     jsonb_build_array(
       jsonb_build_object('name', 'B', 'inventory_id', b::text, 'qty', '1', 'price', '40.50'),
       jsonb_build_object('name', 'Food', 'qty', 1, 'price', 20),
       jsonb_build_object('name', 'Bad id', 'inventory_id', 'not-a-uuid', 'qty', 1, 'price', 5),
       to_jsonb('a string line'::text))),
    -- k3 voided, k4 still open, k5 closed before the window: none counts.
    (h1, 'cg_test', 'k3', now() - interval '1 day 1 hour', now() - interval '1 day', true,
     jsonb_build_array(jsonb_build_object('name', 'A', 'inventory_id', a, 'qty', 5, 'price', 12))),
    (h1, 'cg_test', 'k4', now() - interval '1 hour', null, false,
     jsonb_build_array(jsonb_build_object('name', 'A', 'inventory_id', a, 'qty', 7, 'price', 12))),
    (h1, 'cg_test', 'k5', now() - interval '400 days 1 hour', now() - interval '400 days', false,
     jsonb_build_array(jsonb_build_object('name', 'C', 'inventory_id', c, 'qty', 9, 'price', 12))),
    -- k6: the other house.
    (h2, 'cg_test', 'k6', now() - interval '1 day 1 hour', now() - interval '1 day', false,
     jsonb_build_array(jsonb_build_object('name', 'D', 'inventory_id', d, 'qty', 4, 'price', 10))),
    -- k7: a closed check whose items is not an array. A check, no lines, no raise.
    (h1, 'cg_test', 'k7', now() - interval '3 days 1 hour', now() - interval '3 days', false, '{}'::jsonb);
end $$;

-- T1 mapped lines: sales = price x qty, units and lines per stock item.
do $$
declare
  r jsonb := pg_temp.cg_read('c0980000-0000-4000-8000-000000000001');
  ia jsonb := pg_temp.cg_item(r, 'c0980000-0000-4000-8000-0000000002a0');
  ib jsonb := pg_temp.cg_item(r, 'c0980000-0000-4000-8000-0000000002b0');
begin
  assert ia is not null, format('T1 FAIL item A missing from %s', r);
  assert (ia ->> 'sales')::numeric = 24 and (ia ->> 'units')::numeric = 2 and (ia ->> 'lines')::int = 1,
    format('T1 FAIL item A is %s, expected sales 24, units 2, lines 1', ia);
  assert (ib ->> 'sales')::numeric = 80.5 and (ib ->> 'units')::numeric = 2 and (ib ->> 'lines')::int = 2,
    format('T1 FAIL item B is %s, expected sales 80.5, units 2, lines 2 (string numbers read)', ib);
end $$;

-- T2 a voided check and an open check add nothing; T3 nor do a check closed
-- before the window or the other house's check.
do $$
declare
  r jsonb := pg_temp.cg_read('c0980000-0000-4000-8000-000000000001');
begin
  assert (r ->> 'checks')::int = 3, format('T2 FAIL checks %s, expected 3 (k1, k2, k7)', r ->> 'checks');
  assert pg_temp.cg_item(r, 'c0980000-0000-4000-8000-0000000002c0') is null,
    format('T3 FAIL item C (a check before the window, a manual sale) appears: %s', r);
  assert pg_temp.cg_item(r, 'c0980000-0000-4000-8000-0000000002d0') is null,
    format('T3 FAIL the other house''s item appears: %s', r);
end $$;

-- T4 unmapped and unreadable lines are counted, never raised.
do $$
declare
  r jsonb := pg_temp.cg_read('c0980000-0000-4000-8000-000000000001');
begin
  assert (r ->> 'lines')::int = 8, format('T4 FAIL lines %s, expected 8', r ->> 'lines');
  assert (r ->> 'unmapped_lines')::int = 2, format('T4 FAIL unmapped_lines %s, expected 2', r ->> 'unmapped_lines');
  assert (r ->> 'unmapped_sales')::numeric = 29, format('T4 FAIL unmapped_sales %s, expected 29', r ->> 'unmapped_sales');
  assert (r ->> 'unreadable_lines')::int = 3, format('T4 FAIL unreadable_lines %s, expected 3', r ->> 'unreadable_lines');
end $$;

-- T5 the ledger: POS sale and return rows net per item; manual, waste,
-- shadow, pre-window and other-house rows are not the till's movement.
do $$
declare
  r jsonb := pg_temp.cg_read('c0980000-0000-4000-8000-000000000001');
  ia jsonb := pg_temp.cg_item(r, 'c0980000-0000-4000-8000-0000000002a0');
  ib jsonb := pg_temp.cg_item(r, 'c0980000-0000-4000-8000-0000000002b0');
  ie jsonb := pg_temp.cg_item(r, 'c0980000-0000-4000-8000-0000000002e0');
begin
  assert (ia ->> 'bottles_out')::numeric = 3, format('T5 FAIL A bottles_out %s, expected 3 (2 + 1 - 1 + 1)', ia ->> 'bottles_out');
  assert (ib ->> 'bottles_out')::numeric = 1, format('T5 FAIL B bottles_out %s, expected 1 (waste and shadow excluded)', ib ->> 'bottles_out');
  -- A void with no sale in the window is reported as it is, not clamped here.
  assert ie is not null and (ie ->> 'bottles_out')::numeric = -3 and (ie ->> 'sales')::numeric = 0,
    format('T5 FAIL item E is %s, expected bottles_out -3 and sales 0', ie);
  assert jsonb_array_length(r -> 'items') = 4, format('T5 FAIL %s items, expected A, B, E and the mapped F', jsonb_array_length(r -> 'items'));
end $$;

-- T6 first_sale_at is the earliest closed check or POS ledger row in the
-- window (here the direct ledger row five days back), and a house with
-- nothing in the window reads zero checks, no items and no date.
do $$
declare
  r jsonb := pg_temp.cg_read('c0980000-0000-4000-8000-000000000001');
  z jsonb := public.pos_item_sales('c0980000-0000-4000-8000-000000000002', now() + interval '1 day');
begin
  assert (r ->> 'first_sale_at')::timestamptz = now() - interval '5 days',
    format('T6 FAIL first_sale_at %s, expected %s', r ->> 'first_sale_at', now() - interval '5 days');
  assert (z ->> 'checks')::int = 0 and z -> 'items' = '[]'::jsonb and z -> 'first_sale_at' = 'null'::jsonb,
    format('T6 FAIL an empty window reads %s', z);
  assert (pg_temp.cg_read('c0980000-0000-4000-8000-000000000001', 4) ->> 'first_sale_at')::timestamptz = now() - interval '3 days',
    'T6 FAIL a 4-day window should start at the 3-day-old check';
end $$;

-- T7 the function is SECURITY INVOKER and only service_role may run it.
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

-- T9 mapped: an item this house's mappings point at is flagged, and listed
-- with zeros when it neither sold nor moved (F); an item that sold but no
-- mapping points at is not flagged (B, E); a null mapping, a mapping at
-- another house's item, and another house's mapping flag nothing.
do $$
declare
  r jsonb := pg_temp.cg_read('c0980000-0000-4000-8000-000000000001');
  ia jsonb := pg_temp.cg_item(r, 'c0980000-0000-4000-8000-0000000002a0');
  ib jsonb := pg_temp.cg_item(r, 'c0980000-0000-4000-8000-0000000002b0');
  ie jsonb := pg_temp.cg_item(r, 'c0980000-0000-4000-8000-0000000002e0');
  i_f jsonb := pg_temp.cg_item(r, 'c0980000-0000-4000-8000-0000000002f0');
  r2 jsonb := pg_temp.cg_read('c0980000-0000-4000-8000-000000000002');
begin
  assert i_f is not null, format('T9 FAIL the mapped, never-sold item F is missing from %s', r);
  assert (i_f -> 'mapped') = 'true'::jsonb and (i_f ->> 'sales')::numeric = 0
     and (i_f ->> 'bottles_out')::numeric = 0 and (i_f ->> 'lines')::int = 0,
    format('T9 FAIL item F is %s, expected mapped, sales 0, bottles_out 0, lines 0', i_f);
  assert (ia -> 'mapped') = 'true'::jsonb, format('T9 FAIL item A is %s, expected mapped (two mapping rows, one item)', ia);
  assert (ib -> 'mapped') = 'false'::jsonb and (ie -> 'mapped') = 'false'::jsonb,
    format('T9 FAIL B %s and E %s should not be mapped', ib, ie);
  assert (select count(*) from jsonb_array_elements(r -> 'items') x
           where (x ->> 'inventory_id')::uuid = 'c0980000-0000-4000-8000-0000000002a0') = 1,
    'T9 FAIL item A is listed more than once';
  assert pg_temp.cg_item(r, 'c0980000-0000-4000-8000-0000000002d0') is null,
    format('T9 FAIL h1''s mapping at h2''s item D lists D for h1: %s', r);
  assert pg_temp.cg_item(r2, 'c0980000-0000-4000-8000-0000000002c0') is null,
    format('T9 FAIL h2''s mapping at h1''s item C lists C for h2: %s', r2);
  assert (pg_temp.cg_item(r2, 'c0980000-0000-4000-8000-0000000002d0') -> 'mapped') = 'false'::jsonb,
    format('T9 FAIL h2''s item D is flagged mapped by h1''s mapping: %s', r2);
end $$;

-- T10 the window's two clocks, apart: sales start at the first closed check
-- (k7, three days back), cost of goods at the first POS ledger row (the
-- direct row, five days back), and first_sale_at is the earlier. An empty
-- window has neither; a 4-day window starts its moves at today's rows.
do $$
declare
  r jsonb := pg_temp.cg_read('c0980000-0000-4000-8000-000000000001');
  r4 jsonb := pg_temp.cg_read('c0980000-0000-4000-8000-000000000001', 4);
  z jsonb := public.pos_item_sales('c0980000-0000-4000-8000-000000000002', now() + interval '1 day');
begin
  assert (r ->> 'first_check_at')::timestamptz = now() - interval '3 days',
    format('T10 FAIL first_check_at %s, expected %s', r ->> 'first_check_at', now() - interval '3 days');
  assert (r ->> 'first_move_at')::timestamptz = now() - interval '5 days',
    format('T10 FAIL first_move_at %s, expected %s', r ->> 'first_move_at', now() - interval '5 days');
  assert (r ->> 'first_sale_at')::timestamptz = least((r ->> 'first_check_at')::timestamptz, (r ->> 'first_move_at')::timestamptz),
    format('T10 FAIL first_sale_at %s is not the earlier clock', r ->> 'first_sale_at');
  assert (r4 ->> 'first_check_at')::timestamptz = now() - interval '3 days'
     and (r4 ->> 'first_move_at')::timestamptz = now(),
    format('T10 FAIL a 4-day window reads check %s and move %s', r4 ->> 'first_check_at', r4 ->> 'first_move_at');
  assert z -> 'first_check_at' = 'null'::jsonb and z -> 'first_move_at' = 'null'::jsonb,
    format('T10 FAIL an empty window reads %s', z);
end $$;

-- T11 what the gateway's ingest can write does not raise: every adapter
-- coerces price and qty to finite JS numbers, and the largest finite double
-- squared fits numeric. The check is undone by a raise this block catches.
do $$
declare
  big numeric := 1.7976931348623157e308;
  r jsonb;
begin
  begin
    insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, closed_at, voided, items) values
      ('c0980000-0000-4000-8000-000000000001', 'cg_test', 'k-max', now() - interval '1 hour', now(), false,
       jsonb_build_array(jsonb_build_object('name', 'A', 'inventory_id', 'c0980000-0000-4000-8000-0000000002a0',
                                            'qty', to_jsonb(big), 'price', to_jsonb(big))));
    r := pg_temp.cg_read('c0980000-0000-4000-8000-000000000001');
    assert (pg_temp.cg_item(r, 'c0980000-0000-4000-8000-0000000002a0') ->> 'sales')::numeric > big * big,
      format('T11 FAIL the largest double squared did not land in A''s sales: %s', r);
    raise exception 'cg-undo';
  exception when others then
    if sqlerrm <> 'cg-undo' then raise; end if;
  end;
end $$;

-- T12 what the function does raise, and so is not "never": a price string
-- longer than numeric holds, written directly (not through ingest), passes
-- the digit pattern and overflows the cast for the whole call. The gateway
-- reads that error as a failed read (null figures), never as a smaller one.
do $$
declare
  raised boolean := false;
begin
  begin
    insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, closed_at, voided, items) values
      ('c0980000-0000-4000-8000-000000000001', 'cg_test', 'k-huge', now() - interval '1 hour', now(), false,
       jsonb_build_array(jsonb_build_object('name', 'A', 'inventory_id', 'c0980000-0000-4000-8000-0000000002a0',
                                            'qty', 1, 'price', repeat('9', 140000))));
    perform pg_temp.cg_read('c0980000-0000-4000-8000-000000000001');
  exception when numeric_value_out_of_range then
    raised := true;
  end;
  assert raised, 'T12 FAIL a 140000-digit price string written directly did not raise 22003';
  assert not exists (select 1 from public.pos_checks where external_check_id = 'k-huge'),
    'T12 FAIL the k-huge check outlived its block';
end $$;

-- T8 the closed-check window has its index.
do $$
begin
  assert exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'pos_checks'
                  and indexname = 'idx_pos_checks_restaurant_closed'),
    'T8 FAIL idx_pos_checks_restaurant_closed is missing';
end $$;

rollback;
