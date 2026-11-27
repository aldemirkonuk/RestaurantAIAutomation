-- inventory_analytics after days_of_stock_from_real_use. Self-asserting
-- (P0004), rolled back; `psql -v ON_ERROR_STOP=1 -f` on a database built from
-- supabase/migrations (CI runs no supabase/tests file). Movements go through
-- apply_stock_movement / record_stock_count, then are dated back.

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
create function pg_temp.buy(l text, q int, ago text, cost numeric) returns void language sql as $$
  select pg_temp.mv(l, q, 'purchase', 'order', l || '-in' || ago, ago::interval, cost)
$$;
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
insert into public.restaurant_inventory (id, restaurant_id, kind, uom, display_name, wine_name, identity_provenance, stock_live, threshold_min, is_active, created_at)
select pg_temp.item(l), pg_temp.u('1'), k, uom, n, n, 'house_declared', 0, par, true, now() - make_interval(days => age) from (values
  ('a', 'spirit', 'bottle', 'DOS gin', 2, 200),
  ('b', 'spirit', 'bottle', 'DOS new rum', 2, 10),
  ('c', 'spirit', 'bottle', 'DOS voided', 2, 200),
  ('d', 'food', 'g', 'DOS flour', 0, 200),
  ('e', 'food', 'g', 'DOS salt', 0, 200),
  ('f', 'food', 'g', 'DOS sugar', 0, 200),
  ('g', 'supply', 'each', 'DOS napkins', 0, 200),
  ('h', 'food', 'g', 'DOS pepper', 0, 200),
  ('i', 'spirit', 'bottle', 'DOS old port', 0, 200),
  ('j', 'food', 'ml', 'DOS oil', 0, 200),
  ('k', 'food', 'g', 'DOS rice', 0, 200),
  ('l', 'wine', 'bottle', 'DOS slow red', 0, 200),
  ('m', 'food', 'g', 'DOS beans', 0, 200),
  ('n', 'food', 'g', 'DOS lentils', 0, 200)
) v(l, k, uom, n, par, age);

-- a: one sold a day for 20 days.
select pg_temp.buy('a', 40, '60 days', 18.5);
select pg_temp.mv('a', -1, 'sale', 'pos', 'a-s' || g, (g || ' days')::interval) from generate_series(1, 20) g;
-- b: carried 10 days, one sold a day.
select pg_temp.buy('b', 20, '10 days', 20);
select pg_temp.mv('b', -1, 'sale', 'pos', 'b-s' || g, (g || ' days')::interval - interval '1 hour') from generate_series(1, 10) g;
-- c: 6 sold, 2 voided.
select pg_temp.buy('c', 10, '40 days', 20);
select pg_temp.mv('c', -1, 'sale', 'pos', 'c-s' || g, (g || ' days')::interval) from generate_series(1, 6) g;
select pg_temp.mv('c', 1, 'return', 'pos', 'c-v' || g, (g || ' days')::interval - interval '1 hour') from generate_series(1, 2) g;
-- d: flour, never sold.
select pg_temp.buy('d', 10000, '25 days', 0.0012);
select pg_temp.cnt('d', 9000, 'd-c1', '21 days');
select pg_temp.cnt('d', 7000, 'd-c2', '14 days');
select pg_temp.buy('d', 5000, '10 days', 0.0012);
select pg_temp.cnt('d', 10000, 'd-c3', '7 days');
select pg_temp.mv('d', -200, 'waste', 'manual', 'd-w1', '4 days');
select pg_temp.cnt('d', 8200, 'd-c4', '1 day');
-- e: counted once.
select pg_temp.buy('e', 1000, '20 days', 0.001);
select pg_temp.cnt('e', 900, 'e-c1', '5 days');
-- f: sugar, counted 1 day apart.
select pg_temp.buy('f', 1000, '20 days', 0.002);
select pg_temp.cnt('f', 900, 'f-c1', '2 days');
select pg_temp.cnt('f', 850, 'f-c2', '1 day');
-- g: napkins, none used.
select pg_temp.buy('g', 500, '30 days', 0.02);
select pg_temp.cnt('g', 500, 'g-c1', '15 days');
select pg_temp.cnt('g', 500, 'g-c2', '5 days');
-- h: pepper, an unbooked delivery.
select pg_temp.buy('h', 100, '30 days', 0.05);
select pg_temp.cnt('h', 100, 'h-c1', '15 days');
select pg_temp.cnt('h', 300, 'h-c2', '5 days');
-- i: a spirit on the shelf, never sold.
select pg_temp.buy('i', 3, '120 days', 30);
-- j: oil, a manual override down (spillage) between counts.
select pg_temp.buy('j', 10000, '30 days', 0.001);
select pg_temp.cnt('j', 10000, 'j-c1', '11 days');
select pg_temp.mv('j', -3000, 'adjustment', 'manual', 'j-o', '6 days');
select pg_temp.cnt('j', 7000, 'j-c2', '1 day');
-- k: rice, a door correction and a return to the vendor between counts.
select pg_temp.buy('k', 1000, '20 days', 0.002);
select pg_temp.cnt('k', 1000, 'k-c1', '12 days');
select pg_temp.buy('k', 5000, '8 days', 0.002);
select pg_temp.mv('k', -1000, 'adjustment', 'order', 'k-door', '8 days');
select pg_temp.mv('k', -500, 'return', 'manual', 'k-ret', '6 days');
select pg_temp.cnt('k', 2000, 'k-c2', '2 days');
-- l: a wine unsold in 90 days, counted 12 then 10.
select pg_temp.buy('l', 12, '60 days', 15);
select pg_temp.cnt('l', 12, 'l-c1', '10 days');
select pg_temp.cnt('l', 10, 'l-c2', '5 days');
-- m: beans, last counted 40 days ago.
select pg_temp.buy('m', 5000, '60 days', 0.002);
select pg_temp.cnt('m', 5000, 'm-c1', '50 days');
select pg_temp.cnt('m', 4000, 'm-c2', '40 days');
-- n: lentils, 500 written off since the last count.
select pg_temp.buy('n', 5000, '25 days', 0.002);
select pg_temp.cnt('n', 5000, 'n-c1', '20 days');
select pg_temp.cnt('n', 3000, 'n-c2', '10 days');
select pg_temp.mv('n', -500, 'waste', 'manual', 'n-w', '5 days');

do $$
declare r public.inventory_analytics;
begin
  -- T1 20 sold in 30 days: 0.667/day, 20 / 0.667 = 30 days.
  r := pg_temp.a('a');
  assert r.usage_source = 'sales', format('T1 source %s', r.usage_source);
  assert r.sold_30d = 20 and r.velocity_per_day = 0.667, format('T1 %s %s', r.sold_30d, r.velocity_per_day);
  assert r.days_of_cover = 30 and r.on_hand = 20, format('T1 cover %s on hand %s', r.days_of_cover, r.on_hand);
  assert r.usage_qty = 20 and r.dead_stock = false, 'T1 qty/dead';

  -- T2 carried 10 days, sold 10: 1/day (the old /30 said 0.333).
  r := pg_temp.a('b');
  assert r.velocity_per_day = 1.000, format('T2 velocity %s', r.velocity_per_day);
  assert r.days_of_cover = 10, format('T2 cover %s', r.days_of_cover);
  assert r.usage_since between now() - interval '10 days 1 minute' and now() - interval '9 days 23 hours', format('T2 since %s', r.usage_since);

  -- T3 6 sold, 2 voided back: 4 sold.
  r := pg_temp.a('c');
  assert r.sold_30d = 4 and r.sold_90d = 4, format('T3 sold %s/%s', r.sold_30d, r.sold_90d);
  assert r.on_hand = 6, format('T3 on hand %s', r.on_hand);

  -- T4 counts -21 (9000) to -1 (8200), 5000 in: 5800 over 20 days = 290/day; (8200 - 290) / 290 = 27 days.
  r := pg_temp.a('d');
  assert r.usage_source = 'counts', format('T4 source %s', r.usage_source);
  assert r.usage_qty = 5800, format('T4 used %s', r.usage_qty);
  assert r.velocity_per_day = 290.000, format('T4 velocity %s', r.velocity_per_day);
  assert r.days_of_cover = 27 and r.on_hand = 8200, format('T4 cover %s on hand %s', r.days_of_cover, r.on_hand);
  assert r.reorder_point = 2900 and r.reorder_suggested = false, format('T4 reorder %s', r.reorder_point);
  assert r.dead_stock = false and r.sold_30d = 0 and r.last_sold_at is null, 'T4 dead/sold';
  assert r.usage_since::date = (now() - interval '21 days')::date and r.usage_until::date = (now() - interval '1 day')::date, 'T4 window';

  -- T5 counted once: not measured, not dead.
  r := pg_temp.a('e');
  assert r.usage_source is null and r.velocity_per_day = 0 and r.days_of_cover is null, 'T5 unknown';
  assert r.dead_stock = false, 'T5 dead';

  -- T6 counts 1 day apart: not measured.
  r := pg_temp.a('f');
  assert r.usage_source is null and r.velocity_per_day = 0, format('T6 %s', r.usage_source);

  -- T7 counted, none used: 0, dead.
  r := pg_temp.a('g');
  assert r.usage_source = 'counts' and r.velocity_per_day = 0 and r.usage_qty = 0, 'T7 none used';
  assert r.days_of_cover is null and r.dead_stock = true, 'T7 dead';

  -- T8 found 200 more than arrived: not measured, not dead.
  r := pg_temp.a('h');
  assert r.usage_source is null and r.velocity_per_day = 0 and r.usage_qty is null, format('T8 %s %s', r.usage_source, r.usage_qty);
  assert r.dead_stock = false and r.reorder_suggested = false, 'T8 dead/reorder';

  -- T9 a spirit never sold or counted: dead, as before.
  r := pg_temp.a('i');
  assert r.usage_source is null and r.dead_stock = true, 'T9 dead';

  -- T10 the override is use: 10000 - 7000 = 3000 over 10 days; (7000 - 300) / 300 = 22.
  r := pg_temp.a('j');
  assert r.usage_source = 'counts' and r.usage_qty = 3000, format('T10 %s %s', r.usage_source, r.usage_qty);
  assert r.velocity_per_day = 300.000 and r.dead_stock = false, format('T10 velocity %s', r.velocity_per_day);
  assert r.days_of_cover = 22, format('T10 cover %s', r.days_of_cover);

  -- T11 arrived 5000 - 1000 - 500 = 3500; used 1000 + 3500 - 2000 = 2500 over 10 days; (2000 - 500) / 250 = 6.
  r := pg_temp.a('k');
  assert r.usage_source = 'counts' and r.usage_qty = 2500 and r.velocity_per_day = 250.000,
    format('T11 %s %s %s', r.usage_source, r.usage_qty, r.velocity_per_day);
  assert r.on_hand = 2000 and r.days_of_cover = 6, format('T11 cover %s', r.days_of_cover);

  -- T12 a drink's shrink between counts is loss, not a pace.
  r := pg_temp.a('l');
  assert r.usage_source is null and r.velocity_per_day = 0 and r.reorder_suggested = false,
    format('T12 %s %s', r.usage_source, r.velocity_per_day);

  -- T13 a 40-day-old count is no pace for today.
  r := pg_temp.a('m');
  assert r.usage_source is null and r.days_of_cover is null and r.dead_stock = false, format('T13 %s', r.usage_source);

  -- T14 200/day; since the count 2000 more, 500 booked: 2500 - 1500 = 1000 left, 5 days, under 2000.
  r := pg_temp.a('n');
  assert r.usage_source = 'counts' and r.velocity_per_day = 200.000 and r.on_hand = 2500,
    format('T14 %s %s %s', r.usage_source, r.velocity_per_day, r.on_hand);
  assert r.days_of_cover = 5 and r.reorder_point = 2000 and r.reorder_suggested = true,
    format('T14 cover %s point %s suggested %s', r.days_of_cover, r.reorder_point, r.reorder_suggested);
end $$;

rollback;
