-- F-1605 remainder (sim-ledger S226): a house knows when its old exports were
-- cleared. Migration a_house_knows_when_its_old_exports_were_cleared adds
-- public.report_export_sweeps (one row per house per sweep that removed files).
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration (T1) and PASS with it. One transaction,
-- rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values ('house', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC export-sweep house', 'syn-sweep-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

-- T1: the table exists, RLS on, and no client role holds a grant on it.
do $$
declare
  rls boolean;
  grants int;
begin
  if to_regclass('public.report_export_sweeps') is null then
    raise exception 'T1 FAIL: public.report_export_sweeps does not exist';
  end if;
  select relrowsecurity into rls from pg_class where oid = to_regclass('public.report_export_sweeps');
  if not rls then raise exception 'T1 FAIL: report_export_sweeps has RLS off'; end if;
  select count(*) into grants from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'report_export_sweeps'
     and grantee in ('anon', 'authenticated');
  if grants > 0 then raise exception 'T1 FAIL: % client grant(s) on report_export_sweeps', grants; end if;
end $$;

-- T2: a sweep record keeps how many files, when, and under which rule.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  n int;
begin
  insert into public.report_export_sweeps (restaurant_id, removed_count, kept_days)
  values (h, 3, 90);
  select removed_count into n from public.report_export_sweeps where restaurant_id = h;
  if n is distinct from 3 then raise exception 'T2 FAIL: read back % files removed', n; end if;
end $$;

-- T3: a record of nothing removed, or of no keeping time, is refused.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  refused boolean := false;
begin
  begin
    insert into public.report_export_sweeps (restaurant_id, removed_count, kept_days) values (h, 0, 90);
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: a sweep that removed 0 files was recorded'; end if;

  refused := false;
  begin
    insert into public.report_export_sweeps (restaurant_id, removed_count, kept_days) values (h, 1, 0);
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: a sweep with no keeping time was recorded'; end if;
end $$;

-- T4: a house's sweep records go with the house.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  n int;
begin
  delete from public.restaurants where id = h;
  select count(*) into n from public.report_export_sweeps where restaurant_id = h;
  if n <> 0 then raise exception 'T4 FAIL: % sweep record(s) outlived their house', n; end if;
end $$;

rollback;
