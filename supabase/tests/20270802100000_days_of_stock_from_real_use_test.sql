-- public.inventory_analytics, migration days_of_stock_from_real_use: usage a
-- day and days of cover from what was really used.
--
-- Self-asserting (assert -> P0004); run with `psql -v ON_ERROR_STOP=1 -f` on a
-- database built from supabase/migrations. CI runs no supabase/tests file
-- (claim SUPABASE-TESTS-RUN-IN-CI). Synthetic fixtures, one transaction,
-- rolled back. House u('1'); item x is pg_temp.item('x'). Every movement goes through
-- apply_stock_movement / record_stock_count, then its date is moved back.
-- Each block says how its figures follow from the fixtures.

begin;
set local timezone = 'UTC';
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('d0570000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;
create function pg_temp.item(l text) returns uuid language sql immutable as $$
  select ('d0570000-0000-4000-8000-2' || substr(md5(l), 1, 11))::uuid
$$;
-- A movement dated `ago` back, keyed 'dos-test:<k>'.
create function pg_temp.mv(l text, q int, ty text, src text, k text, ago interval, cost numeric default null)
returns void language plpgsql as $$
begin
  perform public.apply_stock_movement(pg_temp.item(l), 'live', q, ty, src, null, 'dos test', cost, null, null,
    'dos-test:' || k, case when cost is null then null else 'invoice' end, null, null, null, null, null,
    pg_temp.u('1'), now() - ago);
end $$;
-- A live count of `n` dated `ago` back (the count and its correction row both).
create function pg_temp.cnt(l text, n int, k text, ago interval) returns void language plpgsql as $$
begin
  perform public.record_stock_count(pg_temp.item(l), n, 'dos-test:' || k, 'live', 'mobile_count', 'reconciliation', null, 'dos test');
  update public.stock_counts set counted_at = now() - ago where idempotency_key = 'dos-test:' || k;
  update public.inventory_transactions set transaction_date = now() - ago where idempotency_key = 'dos-test:' || k;
end $$;
create function pg_temp.a(l text) returns public.inventory_analytics language sql as $$
  select * from public.inventory_analytics where inventory_id = pg_temp.item(l)
$$;

insert into public.restaurants (id, name, slug) values (pg_temp.u('1'), 'DOS test house', 'dos-test-house-1');
insert into public.restaurant_inventory (id, restaurant_id, kind, uom, display_name, wine_name, identity_provenance, stock_live, threshold_min, is_active, created_at) values
  (pg_temp.item('a'), pg_temp.u('1'), 'spirit', 'bottle', 'DOS gin',      'DOS gin',      'house_declared', 0, 2, true, now() - interval '200 days'),
  (pg_temp.item('b'), pg_temp.u('1'), 'spirit', 'bottle', 'DOS new rum',  'DOS new rum',  'house_declared', 0, 2, true, now() - interval '10 days'),
  (pg_temp.item('c'), pg_temp.u('1'), 'spirit', 'bottle', 'DOS voided',   'DOS voided',   'house_declared', 0, 2, true, now() - interval '200 days'),
  (pg_temp.item('d'), pg_temp.u('1'), 'food',   'g',      'DOS flour',    'DOS flour',    'house_declared', 0, 0, true, now() - interval '200 days'),
  (pg_temp.item('e'), pg_temp.u('1'), 'food',   'g',      'DOS salt',     'DOS salt',     'house_declared', 0, 0, true, now() - interval '200 days'),
  (pg_temp.item('f'), pg_temp.u('1'), 'food',   'g',      'DOS sugar',    'DOS sugar',    'house_declared', 0, 0, true, now() - interval '200 days'),
  (pg_temp.item('g'), pg_temp.u('1'), 'supply', 'each',   'DOS napkins',  'DOS napkins',  'house_declared', 0, 0, true, now() - interval '200 days'),
  (pg_temp.item('h'), pg_temp.u('1'), 'food',   'g',      'DOS pepper',   'DOS pepper',   'house_declared', 0, 0, true, now() - interval '200 days'),
  (pg_temp.item('i'), pg_temp.u('1'), 'spirit', 'bottle', 'DOS old port', 'DOS old port', 'house_declared', 0, 0, true, now() - interval '200 days'),
  (pg_temp.item('j'), pg_temp.u('1'), 'food',   'ml',     'DOS oil',      'DOS oil',      'house_declared', 0, 0, true, now() - interval '200 days'),
  (pg_temp.item('k'), pg_temp.u('1'), 'food',   'g',      'DOS rice',     'DOS rice',     'house_declared', 0, 0, true, now() - interval '200 days'),
  (pg_temp.item('l'), pg_temp.u('1'), 'wine',   'bottle', 'DOS slow red', 'DOS slow red', 'house_declared', 0, 0, true, now() - interval '200 days'),
  (pg_temp.item('m'), pg_temp.u('1'), 'food',   'g',      'DOS beans',    'DOS beans',    'house_declared', 0, 0, true, now() - interval '200 days'),
  (pg_temp.item('n'), pg_temp.u('1'), 'food',   'g',      'DOS lentils',  'DOS lentils',  'house_declared', 0, 0, true, now() - interval '200 days');

-- a: 40 in 60 days ago, one sold a day for the last 20 days.
select pg_temp.mv('a', 40, 'purchase', 'order', 'a-in', '60 days', 18.5);
select pg_temp.mv('a', -1, 'sale', 'pos', 'a-s' || g, (g || ' days')::interval) from generate_series(1, 20) g;
-- b: carried 10 days; 20 in 10 days ago, one sold a day for 10 days.
select pg_temp.mv('b', 20, 'purchase', 'order', 'b-in', '10 days', 20);
select pg_temp.mv('b', -1, 'sale', 'pos', 'b-s' || g, (g || ' days')::interval - interval '1 hour') from generate_series(1, 10) g;
-- c: 10 in, 6 sold, 2 of them voided back.
select pg_temp.mv('c', 10, 'purchase', 'order', 'c-in', '40 days', 20);
select pg_temp.mv('c', -1, 'sale', 'pos', 'c-s' || g, (g || ' days')::interval) from generate_series(1, 6) g;
select pg_temp.mv('c', 1, 'return', 'pos', 'c-v' || g, (g || ' days')::interval - interval '1 hour') from generate_series(1, 2) g;
-- d: flour, never sold. 10 kg in at -25; counts 9000 @-21, 7000 @-14; 5 kg in
-- at -10; count 10000 @-7; 200 g wasted at -4; count 8200 @-1.
select pg_temp.mv('d', 10000, 'purchase', 'order', 'd-in1', '25 days', 0.0012);
select pg_temp.cnt('d', 9000, 'd-c1', '21 days');
select pg_temp.cnt('d', 7000, 'd-c2', '14 days');
select pg_temp.mv('d', 5000, 'purchase', 'order', 'd-in2', '10 days', 0.0012);
select pg_temp.cnt('d', 10000, 'd-c3', '7 days');
select pg_temp.mv('d', -200, 'waste', 'manual', 'd-w1', '4 days');
select pg_temp.cnt('d', 8200, 'd-c4', '1 day');
-- e: salt, counted once.
select pg_temp.mv('e', 1000, 'purchase', 'order', 'e-in', '20 days', 0.001);
select pg_temp.cnt('e', 900, 'e-c1', '5 days');
-- f: sugar, two counts only 1 day apart (a recount), nothing to measure.
select pg_temp.mv('f', 1000, 'purchase', 'order', 'f-in', '20 days', 0.002);
select pg_temp.cnt('f', 900, 'f-c1', '2 days');
select pg_temp.cnt('f', 850, 'f-c2', '1 day');
-- g: napkins, counted twice 10 days apart, none used.
select pg_temp.mv('g', 500, 'purchase', 'order', 'g-in', '30 days', 0.02);
select pg_temp.cnt('g', 500, 'g-c1', '15 days');
select pg_temp.cnt('g', 500, 'g-c2', '5 days');
-- h: pepper, a delivery that was not booked: the later count finds more.
select pg_temp.mv('h', 100, 'purchase', 'order', 'h-in', '30 days', 0.05);
select pg_temp.cnt('h', 100, 'h-c1', '15 days');
select pg_temp.cnt('h', 300, 'h-c2', '5 days');
-- i: a spirit on the shelf, never sold.
select pg_temp.mv('i', 3, 'purchase', 'order', 'i-in', '120 days', 30);
-- j: oil. Counted 10000 @-11; an owner's manual override takes it to 7000
-- @-6 (spillage, an 'adjustment'); the count @-1 agrees with the book at 7000.
select pg_temp.mv('j', 10000, 'purchase', 'order', 'j-in', '30 days', 0.001);
select pg_temp.cnt('j', 10000, 'j-c1', '11 days');
select pg_temp.mv('j', -3000, 'adjustment', 'manual', 'j-o', '6 days');
select pg_temp.cnt('j', 7000, 'j-c2', '1 day');
-- k: rice. Counted 1000 @-12; 5000 booked in @-8 and the door count takes
-- 1000 of it back (an order-sourced 'adjustment'); 500 returned to the vendor
-- @-6; counted 2000 @-2.
select pg_temp.mv('k', 1000, 'purchase', 'order', 'k-in0', '20 days', 0.002);
select pg_temp.cnt('k', 1000, 'k-c1', '12 days');
select pg_temp.mv('k', 5000, 'purchase', 'order', 'k-in', '8 days', 0.002);
select pg_temp.mv('k', -1000, 'adjustment', 'order', 'k-door', '8 days');
select pg_temp.mv('k', -500, 'return', 'manual', 'k-ret', '6 days');
select pg_temp.cnt('k', 2000, 'k-c2', '2 days');
-- l: a wine no one has bought in 90 days, counted 12 then 10 five days apart.
select pg_temp.mv('l', 12, 'purchase', 'order', 'l-in', '60 days', 15);
select pg_temp.cnt('l', 12, 'l-c1', '10 days');
select pg_temp.cnt('l', 10, 'l-c2', '5 days');
-- m: beans, counted twice, but the later count was 40 days ago.
select pg_temp.mv('m', 5000, 'purchase', 'order', 'm-in', '60 days', 0.002);
select pg_temp.cnt('m', 5000, 'm-c1', '50 days');
select pg_temp.cnt('m', 4000, 'm-c2', '40 days');
-- n: lentils, counted 5000 @-20 and 3000 @-10; 500 written off @-5 since.
select pg_temp.mv('n', 5000, 'purchase', 'order', 'n-in', '25 days', 0.002);
select pg_temp.cnt('n', 5000, 'n-c1', '20 days');
select pg_temp.cnt('n', 3000, 'n-c2', '10 days');
select pg_temp.mv('n', -500, 'waste', 'manual', 'n-w', '5 days');

do $$
declare r public.inventory_analytics;
begin
  -- T1 sold 20 in the last 30 days, carried 200 days: 20/30 a day; 20 on hand / (2/3) = 30 days.
  r := pg_temp.a('a');
  assert r.usage_source = 'sales', format('T1 source %s', r.usage_source);
  assert r.sold_30d = 20 and r.velocity_per_day = 0.667, format('T1 %s %s', r.sold_30d, r.velocity_per_day);
  assert r.days_of_cover = 30 and r.on_hand = 20, format('T1 cover %s on hand %s', r.days_of_cover, r.on_hand);
  assert r.usage_qty = 20 and r.dead_stock = false, 'T1 qty/dead';

  -- T2 carried 10 days, sold 10: 1 a day, 10 on hand = 10 days (the old /30 said 0.333 and 30 days).
  r := pg_temp.a('b');
  assert r.velocity_per_day = 1.000, format('T2 velocity %s', r.velocity_per_day);
  assert r.days_of_cover = 10, format('T2 cover %s', r.days_of_cover);
  assert r.usage_since between now() - interval '10 days 1 minute' and now() - interval '9 days 23 hours', format('T2 since %s', r.usage_since);

  -- T3 6 sold, 2 voided back: 4 sold.
  r := pg_temp.a('c');
  assert r.sold_30d = 4 and r.sold_90d = 4, format('T3 sold %s/%s', r.sold_30d, r.sold_90d);
  assert r.on_hand = 6, format('T3 on hand %s', r.on_hand);

  -- T4 flour: first count of the window -21 (9000), last -1 (8200), 5000 received:
  -- used 9000 + 5000 - 8200 = 5800 = 200 wasted + gaps 2000 + 2000 + 1600, over 20 days = 290 g a day;
  -- the last count was 1 day ago, so 290 more is gone: (8200 - 290) / 290 = 27 days.
  -- Used, so not dead stock.
  r := pg_temp.a('d');
  assert r.usage_source = 'counts', format('T4 source %s', r.usage_source);
  assert r.usage_qty = 5800, format('T4 used %s', r.usage_qty);
  assert r.velocity_per_day = 290.000, format('T4 velocity %s', r.velocity_per_day);
  assert r.days_of_cover = 27 and r.on_hand = 8200, format('T4 cover %s on hand %s', r.days_of_cover, r.on_hand);
  assert r.reorder_point = 2900 and r.reorder_suggested = false, format('T4 reorder %s', r.reorder_point);
  assert r.dead_stock = false and r.sold_30d = 0 and r.last_sold_at is null, 'T4 dead/sold';
  assert r.usage_since::date = (now() - interval '21 days')::date and r.usage_until::date = (now() - interval '1 day')::date, 'T4 window';

  -- T5 salt counted once: nothing measured, as before; a food is not dead for want of a sale.
  r := pg_temp.a('e');
  assert r.usage_source is null and r.velocity_per_day = 0 and r.days_of_cover is null, 'T5 unknown';
  assert r.dead_stock = false, 'T5 a food with no measure is not dead stock';

  -- T6 two counts 1 day apart: below the 3-day floor, nothing measured.
  r := pg_temp.a('f');
  assert r.usage_source is null and r.velocity_per_day = 0, format('T6 %s', r.usage_source);

  -- T7 napkins counted 10 days apart, none used: measured as 0, and that is dead stock.
  r := pg_temp.a('g');
  assert r.usage_source = 'counts' and r.velocity_per_day = 0 and r.usage_qty = 0, 'T7 none used';
  assert r.days_of_cover is null and r.dead_stock = true, 'T7 dead';

  -- T8 pepper: the later count found 200 more than arrived (a delivery nobody
  -- booked): the counts cannot say what was used, so it is not measured, and
  -- not called dead stock either.
  r := pg_temp.a('h');
  assert r.usage_source is null and r.velocity_per_day = 0 and r.usage_qty is null, format('T8 %s %s', r.usage_source, r.usage_qty);
  assert r.dead_stock = false and r.reorder_suggested = false, 'T8 dead/reorder';

  -- T9 a spirit never sold and never counted: dead stock, exactly as before.
  r := pg_temp.a('i');
  assert r.usage_source is null and r.dead_stock = true, 'T9 dead';

  -- T10 oil: the override is use the counts already hold: 10000 - 7000 = 3000
  -- over 10 days = 300 a day (summing only sale/waste/comp read 0 and dead stock).
  r := pg_temp.a('j');
  assert r.usage_source = 'counts' and r.usage_qty = 3000, format('T10 %s %s', r.usage_source, r.usage_qty);
  assert r.velocity_per_day = 300.000 and r.dead_stock = false, format('T10 velocity %s', r.velocity_per_day);
  -- (7000 - 300 since the count) / 300 = 22.3
  assert r.days_of_cover = 22, format('T10 cover %s', r.days_of_cover);

  -- T11 rice: arrived = 5000 - 1000 at the door - 500 back to the vendor = 3500;
  -- used = 1000 + 3500 - 2000 = 2500 over 10 days = 250 a day. Neither the
  -- door correction nor the return is use.
  r := pg_temp.a('k');
  assert r.usage_source = 'counts' and r.usage_qty = 2500 and r.velocity_per_day = 250.000,
    format('T11 %s %s %s', r.usage_source, r.usage_qty, r.velocity_per_day);
  -- (2000 - 250 x 2 days) / 250 = 6
  assert r.on_hand = 2000 and r.days_of_cover = 6, format('T11 cover %s', r.days_of_cover);

  -- T12 a wine the till has not sold in 90 days: its shrink between counts is
  -- loss, not a pace, so it is not measured and no reorder is suggested.
  r := pg_temp.a('l');
  assert r.usage_source is null and r.velocity_per_day = 0 and r.reorder_suggested = false,
    format('T12 %s %s', r.usage_source, r.velocity_per_day);

  -- T13 beans: two counts, but the later one is 40 days old: no pace for today.
  r := pg_temp.a('m');
  assert r.usage_source is null and r.days_of_cover is null and r.dead_stock = false, format('T13 %s', r.usage_source);

  -- T14 lentils: 2000 used over 10 days = 200 a day. 10 days since the last
  -- count is 2000 more, 500 of it already booked as waste: left = 2500 -
  -- (2000 - 500) = 1000, so 5 days, and 1000 is under the reorder point 2000.
  r := pg_temp.a('n');
  assert r.usage_source = 'counts' and r.velocity_per_day = 200.000 and r.on_hand = 2500,
    format('T14 %s %s %s', r.usage_source, r.velocity_per_day, r.on_hand);
  assert r.days_of_cover = 5 and r.reorder_point = 2000 and r.reorder_suggested = true,
    format('T14 cover %s point %s suggested %s', r.days_of_cover, r.reorder_point, r.reorder_suggested);
end $$;

rollback;
