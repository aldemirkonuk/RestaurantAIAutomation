-- the_door_strip_reads_every_open_count (r41 invoices audit, gap 6): every
-- order counted by case and never closed is a row, however many events the
-- house has, and a read of one house reads only that house's events.
--
-- Self-asserting (assert -> P0004); run with `psql -v ON_ERROR_STOP=1 -f` on a
-- database built from supabase/migrations. CI runs no supabase/tests file
-- (claim SUPABASE-TESTS-RUN-IN-CI). Synthetic fixtures, rolled back.

begin;
set local timezone = 'UTC';
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select md5('r41-door-strip:' || s)::uuid
$$;
create function pg_temp.house(h text) returns uuid language sql immutable as $$ select pg_temp.u('1' || h) $$;
create function pg_temp.ord(h text, o text) returns uuid language sql immutable as $$ select pg_temp.u('2' || h || o) $$;

-- Rows READ from one relation in an EXPLAIN ANALYZE plan.
create function pg_temp.rows_read(plan jsonb, rel text) returns numeric language sql as $$
  with recursive n(node) as (
    select plan -> 0 -> 'Plan'
    union all
    select c from n, jsonb_array_elements(coalesce(n.node -> 'Plans', '[]'::jsonb)) c
  )
  select coalesce(sum(((node ->> 'Actual Rows')::numeric
                       + coalesce((node ->> 'Rows Removed by Filter')::numeric, 0)
                       + coalesce((node ->> 'Rows Removed by Index Recheck')::numeric, 0))
                      * coalesce((node ->> 'Actual Loops')::numeric, 1)), 0)
    from n where node ->> 'Relation Name' = rel
$$;

-- Foreign keys are not what is under test; the rows are synthetic.
set local session_replication_role = replica;

insert into public.restaurants (id, name, slug) values
  (pg_temp.house('a'), 'SYNTHETIC House A', 'r41-door-a'), (pg_temp.house('b'), 'SYNTHETIC House B', 'r41-door-b');

create function pg_temp.order_row(h text, o text, st text, other_house text default null) returns void language sql as $$
  insert into public.procurement_orders (id, order_number, restaurant_id, status, inventory_id, provider_id,
                                         quantity, bottles_total, final_price, total_cost)
  values (pg_temp.ord(h, o), 'SYN-' || upper(h) || '-' || o, pg_temp.house(coalesce(other_house, h)), st,
          pg_temp.u('9' || h || o), pg_temp.u('8' || h || o), 1, 12, 0, 0)
$$;
create function pg_temp.ev(h text, o text, stage text, bottles numeric, hours_ago numeric, order_house text default null) returns void language sql as $$
  insert into public.procurement_receipt_events (restaurant_id, order_id, stage, counted_qty_bottles, occurred_at)
  values (pg_temp.house(h), pg_temp.ord(coalesce(order_house, h), o), stage, bottles,
          now() - make_interval(secs => hours_ago * 3600))
$$;

-- House a.
select pg_temp.order_row('a', 'old', 'PARTIALLY_RECEIVED');   -- open, the OLDEST count
select pg_temp.ev('a', 'old', 'case_count', 24, 216);
select pg_temp.order_row('a', 'twice', 'PARTIALLY_RECEIVED'); -- open, counted twice: the latest wins
select pg_temp.ev('a', 'twice', 'case_count', 12, 100);
select pg_temp.ev('a', 'twice', 'case_count', 18, 90);
select pg_temp.order_row('a', 'sign', 'IN_TRANSIT');          -- open, only signed for
select pg_temp.ev('a', 'sign', 'signed_at_door', null, 80);
select pg_temp.order_row('a', 'nullq', 'PARTIALLY_RECEIVED'); -- open, a count with no bottles
select pg_temp.ev('a', 'nullq', 'case_count', null, 70);
select pg_temp.order_row('a', 'btl', 'PARTIALLY_RECEIVED');   -- closed by a bottle count
select pg_temp.ev('a', 'btl', 'case_count', 24, 60);
select pg_temp.ev('a', 'btl', 'bottle_count', 22, 59);
select pg_temp.order_row('a', 'rec', 'PARTIALLY_RECEIVED');   -- closed by a reconcile
select pg_temp.ev('a', 'rec', 'case_count', 24, 50);
select pg_temp.ev('a', 'rec', 'reconciled', null, 49);
select pg_temp.order_row('a', 'done', 'COMPLETED');           -- closed through the one-shot path
select pg_temp.ev('a', 'done', 'case_count', 6, 40);
select pg_temp.order_row('a', 'cxl', 'CANCELLED');            -- cancelled
select pg_temp.ev('a', 'cxl', 'case_count', 6, 30);
select pg_temp.order_row('b', 'xh', 'PARTIALLY_RECEIVED');    -- house b's order, an event filed in house a
select pg_temp.ev('a', 'xh', 'case_count', 6, 20, 'b');
insert into public.procurement_receipt_events (restaurant_id, order_id, stage, counted_qty_bottles, occurred_at)
  values (pg_temp.house('a'), null, 'case_count', 6, now() - interval '10 hours'); -- no order at all
-- 300 newer deliveries, each counted and closed: 600 events, so the newest
-- 500 of house a no longer reach the oldest open counts.
select pg_temp.order_row('a', 'p' || g, 'PARTIALLY_RECEIVED') from generate_series(1, 300) g;
select pg_temp.ev('a', 'p' || g, 'case_count', 12, 5 + g / 100.0) from generate_series(1, 300) g;
select pg_temp.ev('a', 'p' || g, 'bottle_count', 12, 4 + g / 100.0) from generate_series(1, 300) g;

-- House b: one open count, and 3,000 closed events a house-a read must not touch.
select pg_temp.order_row('b', 'b1', 'PARTIALLY_RECEIVED');
select pg_temp.ev('b', 'b1', 'case_count', 48, 3);
select pg_temp.order_row('b', 'q' || g, 'PARTIALLY_RECEIVED') from generate_series(1, 1500) g;
select pg_temp.ev('b', 'q' || g, 'case_count', 12, 2 + g / 1000.0) from generate_series(1, 1500) g;
select pg_temp.ev('b', 'q' || g, 'bottle_count', 12, 1 + g / 1000.0) from generate_series(1, 1500) g;

set local session_replication_role = origin;
analyze public.procurement_receipt_events;
analyze public.procurement_orders;

-- F1: the fixture reproduces the bug. The gateway's old read (house a's
-- newest 500 events) does not reach the oldest open count at all.
do $$
declare n int;
begin
  select count(*) into n from (
    select order_id from public.procurement_receipt_events
     where restaurant_id = pg_temp.house('a') order by occurred_at desc limit 500) w
   where w.order_id = pg_temp.ord('a', 'old');
  assert n = 0, format('F1 FAIL: the newest 500 events still reach the oldest count (%s)', n);
  select count(*) into n from public.procurement_receipt_events where restaurant_id = pg_temp.house('a');
  assert n > 600, format('F1 FAIL: house a has %s events, not past the old cap', n);
end $$;

-- V1: house a's open counts, exactly.
do $$
declare got text; want text;
begin
  select string_agg(format('%s|%s|%s|%s', v.order_number, coalesce(v.counted_qty_bottles::text, 'null'),
                           round(extract(epoch from now() - v.counted_at) / 3600), v.restaurant_id = pg_temp.house('a')),
                    ',' order by v.order_number)
    into got
    from public.procurement_door_counts_open v where v.restaurant_id = pg_temp.house('a');
  want := 'SYN-A-nullq|null|70|t,SYN-A-old|24.000|216|t,SYN-A-sign|null|80|t,SYN-A-twice|18.000|90|t';
  assert got = want, format('V1 FAIL: got %s, want %s', got, want);
end $$;

-- V2: house b reads only its own open count.
do $$
declare got text;
begin
  select string_agg(v.order_number || '|' || v.counted_qty_bottles, ',') into got
    from public.procurement_door_counts_open v where v.restaurant_id = pg_temp.house('b');
  assert got = 'SYN-B-b1|48.000', format('V2 FAIL: got %s', got);
end $$;

-- R1: a read of house a reads no event of house b. Sequential scans are off
-- so the planner plans as it would at production size.
do $$
declare p jsonb; r numeric; own int;
begin
  set local enable_seqscan = off;
  execute format($q$explain (analyze, format json)
    select * from public.procurement_door_counts_open where restaurant_id = %L order by id$q$,
    pg_temp.house('a')) into p;
  r := pg_temp.rows_read(p, 'procurement_receipt_events');
  select count(*) into own from public.procurement_receipt_events where restaurant_id = pg_temp.house('a');
  assert r <= own, format('R1 FAIL: read %s events, house a has %s', r, own);
  reset enable_seqscan;
end $$;

rollback;
