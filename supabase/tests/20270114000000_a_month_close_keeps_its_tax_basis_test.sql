-- F-1606 (wave 52 sim; ADR 0341 F2 "reports mark the switch date"): a closed
-- month keeps the tax basis its net was on. Migration
-- a_month_close_keeps_its_tax_basis adds month_closes.tax_basis (one of the
-- four ADR 0341 values, NULL on a close kept before it) and names the column
-- in the append-only trigger's foreign-key exception.
--
-- Written in integ round 30 (F-1134): the lane shipped the migration with
-- in-migration asserts only, and every other migration in the window has a
-- supabase/tests file.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration (T1) and PASS with it. One transaction,
-- rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values ('house', gen_random_uuid()), ('closer', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC tax-basis close house', 'syn-taxclose-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

insert into public.users (user_id, email, name, role, restaurant_id)
select v, 'syn-taxclose-' || left(replace(v::text, '-', ''), 12) || '@example.invalid',
       'SYNTHETIC closer', 'manager', (select v from t_fx where k = 'house')
  from t_fx where k = 'closer';

-- T1: a close has a tax_basis column to keep the basis in.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'month_closes'
       and column_name = 'tax_basis'
  ) then
    raise exception 'T1 FAIL: month_closes has no tax_basis column';
  end if;
end $$;

-- A close kept with its basis, and one kept before the basis was recorded.
insert into public.month_closes (restaurant_id, month, version, closed_by, zone, figures, tax_basis)
select (select v from t_fx where k = 'house'), '2026-09', 1, (select v from t_fx where k = 'closer'),
       'Europe/Istanbul', '{"till": {"revenue": 1000}}'::jsonb, 'prices_include_tax';
insert into public.month_closes (restaurant_id, month, version, closed_by, zone, figures)
select (select v from t_fx where k = 'house'), '2026-08', 1, (select v from t_fx where k = 'closer'),
       'Europe/Istanbul', '{"till": {"revenue": 900}}'::jsonb;

-- T2: only the four ADR 0341 values, or NULL (not recorded), are kept.
do $$
declare refused boolean; n int;
begin
  refused := false;
  begin
    insert into public.month_closes (restaurant_id, month, version, zone, figures, tax_basis)
    select v, '2026-10', 1, 'Europe/Istanbul', '{"till": {}}'::jsonb, 'gross' from t_fx where k = 'house';
  exception when check_violation then refused := true;
  end;
  if not refused then
    raise exception 'T2 FAIL: a close kept tax basis ''gross'', which is not an ADR 0341 value';
  end if;

  select count(*) into n from public.month_closes
   where restaurant_id = (select v from t_fx where k = 'house') and month = '2026-08' and tax_basis is null;
  if n <> 1 then
    raise exception 'T2 FAIL: a close kept without a basis was not NULL (% rows)', n;
  end if;
end $$;

-- T3: the kept basis is append-only like the rest of the close.
do $$
declare refused boolean;
begin
  refused := false;
  begin
    update public.month_closes set tax_basis = 'prices_exclude_tax'
     where restaurant_id = (select v from t_fx where k = 'house') and month = '2026-09';
  exception when others then refused := sqlerrm like '%append-only%';
  end;
  if not refused then
    raise exception 'T3 FAIL: a closed month''s tax basis could be edited';
  end if;
end $$;

-- T4: the closer removed nulls closed_by through the trigger's FK exception,
-- and the basis the close was kept with stays as it was.
do $$
declare b text; n int;
begin
  delete from public.users where user_id = (select v from t_fx where k = 'closer');
  select count(*) into n from public.month_closes
   where restaurant_id = (select v from t_fx where k = 'house') and closed_by is null;
  if n <> 2 then
    raise exception 'T4 FAIL: removing the closer left % of 2 closes with no closer', n;
  end if;
  select tax_basis into b from public.month_closes
   where restaurant_id = (select v from t_fx where k = 'house') and month = '2026-09';
  if b is distinct from 'prices_include_tax' then
    raise exception 'T4 FAIL: removing the closer changed the kept tax basis to %', b;
  end if;
end $$;

rollback;
