-- A house's vendors are read by the house (r41 onboarding gap 6; migration
-- 20271121093000_a_houses_vendors_are_read_by_house.sql).
--
-- Run against a database built from supabase/migrations. Everything it writes
-- is inside one transaction that is ROLLED BACK at the end. It prints one row
-- per test: id, ok, detail. Every "ok" must be true. Without the migration
-- T1, T2 and T3 are false (the reads are sequential scans), which is the
-- control.

begin;

create temp table _t (id text primary key, ok boolean, detail text) on commit drop;

-- T1: the index exists as a plain btree on (restaurant_id, created_at), in
-- that order, with no predicate (reads that do not filter deleted_at use it).
insert into _t
select 'T1',
  coalesce(bool_and(am.amname = 'btree' and i.indpred is null
    and pg_get_indexdef(i.indexrelid) like '%(restaurant_id, created_at)'), false),
  coalesce(string_agg(pg_get_indexdef(i.indexrelid), '; '), 'no index named idx_providers_restaurant_created')
from pg_index i
join pg_class c on c.oid = i.indexrelid
join pg_am am on am.oid = c.relam
where c.relname = 'idx_providers_restaurant_created';

-- Fixture: 60 houses x 50 vendors, so a scan of the whole table costs more
-- than the index and the planner's choice is the one production would make.
do $$
declare h uuid; k int;
begin
  for k in 1..60 loop
    insert into public.restaurants (name, slug)
      values ('Vendors ' || k, 'vendors-' || k || '-' || gen_random_uuid())
      returning id into h;
    insert into public.providers (name, primary_contact, restaurant_id, created_at, notes)
    select 'idx-test vendor ' || k || '-' || v, '{}'::jsonb, h, now() - (v || ' minutes')::interval, repeat('n', 400)
    from generate_series(1, 50) v;
  end loop;
end $$;
analyze public.providers;

create or replace function pg_temp.plan_of(q text) returns text language plpgsql as $$
declare line text; out text := '';
begin
  for line in execute 'explain (costs off) ' || q loop out := out || line || E'\n'; end loop;
  return out;
end $$;

-- T2: the setup read's first vendor (menus.service.ts) walks the index in
-- order and stops: no sequential scan, no sort.
with p as (
  select pg_temp.plan_of(format(
    'select created_at from public.providers where restaurant_id = %L and deleted_at is null order by created_at asc limit 1',
    (select restaurant_id from public.providers where name = 'idx-test vendor 30-1'))) as plan
)
insert into _t select 'T2',
  plan like '%idx_providers_restaurant_created%' and plan not like '%Seq Scan%' and plan not like '%Sort%', plan from p;

-- T3: /vendors (providers.service.ts listProviders) reads by the house.
with p as (
  select pg_temp.plan_of(format(
    'select * from public.providers where restaurant_id = %L and deleted_at is null order by created_at desc',
    (select restaurant_id from public.providers where name = 'idx-test vendor 30-1'))) as plan
)
insert into _t select 'T3', plan like '%idx_providers_restaurant_created%' and plan not like '%Seq Scan%', plan from p;

select id, ok, detail from _t order by id;

rollback;
