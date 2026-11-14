-- A window read walks one house's rows (migration
-- 20271119103700_a_window_read_walks_one_houses_rows.sql, r41 /reports gap 3).
--
-- Run against a database built from supabase/migrations. Everything it writes
-- is inside one transaction that is ROLLED BACK at the end. It prints one row
-- per test: id, ok, detail. Every "ok" must be true. Without the migration the
-- plan tests fail: the page walks the primary key, the count and the first
-- line read the house's whole history.
--
-- The fixture is two houses at the one real house's measured volume (131
-- consumption lines and 58 checks a day, r41 audit) over a year, a quarter of
-- the checks voided. A smaller fixture lets the planner sort a few hundred rows
-- instead, which proves nothing about a real house. FKs and triggers
-- are off for the fixture only (session_replication_role), because the plan,
-- not the row's neighbours, is under test.

begin;

create temp table _t (id text primary key, ok boolean, detail text) on commit drop;

set local session_replication_role = replica;
insert into public.wine_consumption_log (restaurant_id, inventory_id, consumption_type, quantity, volume_ml, created_at)
select ('00000000-0000-0000-0000-00000000000' || h)::uuid, gen_random_uuid(), 'bottle', 1, 750,
       now() - (random() * 365 || ' days')::interval
from generate_series(1, 2) h, generate_series(1, 131 * 365) i;
insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, total, voided)
select ('00000000-0000-0000-0000-00000000000' || h)::uuid, 'r41-test', h || '-' || i,
       now() - (random() * 365 || ' days')::interval, 50, (i % 4 = 0)
from generate_series(1, 2) h, generate_series(1, 58 * 365) i;
set local session_replication_role = origin;
analyze public.wine_consumption_log;
analyze public.pos_checks;

-- The index the planner reads a statement through, or the node type when none.
create or replace function pg_temp.reads_through(q text) returns text language plpgsql as $$
declare j json; names text[] := '{}';
begin
  execute 'explain (format json) ' || q into j;
  select array_agg(m[1]) into names
    from regexp_matches(j::text, '"Index Name": "([^"]+)"', 'g') as m;
  return coalesce(array_to_string(names, ','), '(no index)');
end $$;

-- T1: a page of a consumption window is a range of one house's ids.
insert into _t select 'T1', r = 'idx_consumption_house_id_created', 'page reads through ' || r
from (select pg_temp.reads_through($q$
  select id, inventory_id, quantity, created_at from public.wine_consumption_log
  where restaurant_id = '00000000-0000-0000-0000-000000000001'
    and created_at >= now() - interval '90 days'
    and id > '80000000-0000-0000-0000-000000000000'
  order by id limit 1000$q$) r) s;

-- T2: the page's exact count reads only this house's window, through one of
-- the two new indexes, not the house's whole history. (Inside this transaction
-- the visibility map is not set, so the planner cannot pick the index-only
-- count it picks on a vacuumed table; that plan, 175 buffers against 16,777,
-- was measured outside the test and is recorded in the migration's header.)
insert into _t select 'T2', r in ('idx_consumption_house_id_created', 'idx_consumption_house_created'), 'count reads through ' || r
from (select pg_temp.reads_through($q$
  select count(*) from public.wine_consumption_log
  where restaurant_id = '00000000-0000-0000-0000-000000000001'
    and created_at >= now() - interval '90 days'
    and id > '80000000-0000-0000-0000-000000000000'$q$) r) s;

-- T3: the house's first consumption line is one index probe.
insert into _t select 'T3', r = 'idx_consumption_house_created', 'first line reads through ' || r
from (select pg_temp.reads_through($q$
  select created_at from public.wine_consumption_log
  where restaurant_id = '00000000-0000-0000-0000-000000000001'
  order by created_at limit 1$q$) r) s;

-- T4: a page of the till's check window is a range of one house's live checks.
insert into _t select 'T4', r = 'idx_pos_checks_house_id_opened', 'check page reads through ' || r
from (select pg_temp.reads_through($q$
  select id, total, opened_at, closed_at from public.pos_checks
  where restaurant_id = '00000000-0000-0000-0000-000000000001' and voided = false
    and opened_at >= now() - interval '365 days'
    and id > '80000000-0000-0000-0000-000000000000'
  order by id limit 1000$q$) r) s;

-- T5: the check index is partial on live checks and keyed house, id, opened_at,
-- so the page's count can be answered inside it (it must test `voided` there).
-- A definition test: in a transaction the count cannot be planned index-only.
insert into _t select 'T5',
  coalesce((select pg_get_indexdef(indexrelid) from pg_index
             where indexrelid = to_regclass('public.idx_pos_checks_house_id_opened')), '')
    like '%(restaurant_id, id, opened_at) WHERE (voided = false)',
  coalesce((select pg_get_indexdef(indexrelid) from pg_index
             where indexrelid = to_regclass('public.idx_pos_checks_house_id_opened')), 'no index');

-- T8: the consumption page index carries the window column as its third key,
-- so out-of-window rows are passed over in the index, not fetched.
insert into _t select 'T8',
  coalesce((select pg_get_indexdef(indexrelid) from pg_index
             where indexrelid = to_regclass('public.idx_consumption_house_id_created')), '')
    like '%(restaurant_id, id, created_at)',
  coalesce((select pg_get_indexdef(indexrelid) from pg_index
             where indexrelid = to_regclass('public.idx_consumption_house_id_created')), 'no index');

-- T6: the check index holds only live checks, so a reader that asks for voided
-- checks is never answered from it (a partial index cannot leave rows out of
-- a read that wants them).
insert into _t select 'T6', r not like '%idx_pos_checks_house_id_opened%', 'voided read goes through ' || r
from (select pg_temp.reads_through($q$
  select count(*) from public.pos_checks
  where restaurant_id = '00000000-0000-0000-0000-000000000001' and voided = true$q$) r) s;

-- T7: the indexes change no row: the house's window counts the same through
-- the index and through a plain scan.
do $$ declare a bigint; b bigint; begin
  select count(*) into a from public.pos_checks
   where restaurant_id = '00000000-0000-0000-0000-000000000001' and voided = false
     and opened_at >= now() - interval '365 days';
  set local enable_indexscan = off; set local enable_bitmapscan = off; set local enable_indexonlyscan = off;
  select count(*) into b from public.pos_checks
   where restaurant_id = '00000000-0000-0000-0000-000000000001' and voided = false
     and opened_at >= now() - interval '365 days';
  reset enable_indexscan; reset enable_bitmapscan; reset enable_indexonlyscan;
  insert into _t values ('T7', a = b and a = 15878, format('index %s, scan %s, expected 15878', a, b));
end $$;

select id, ok, detail from _t order by id;

do $$ begin
  if exists (select 1 from _t where not ok) then
    raise exception 'FAIL: %', (select string_agg(id || ' ' || detail, '; ' order by id) from _t where not ok);
  end if;
end $$;

rollback;
