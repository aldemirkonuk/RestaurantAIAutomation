-- F-1013 (month close, founder 2026-10-11, option C): a closed month's record
-- is kept as it stood. Migration a_closed_month_keeps_its_figures creates
-- public.month_closes, append-only, gateway-only.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration (T1) and PASS with it. One transaction,
-- rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values ('house', gen_random_uuid()), ('closer', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC close house', 'syn-close-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

insert into public.users (user_id, email, name, role, restaurant_id)
select v, 'syn-close-' || left(replace(v::text, '-', ''), 12) || '@example.invalid',
       'SYNTHETIC closer', 'manager', (select v from t_fx where k = 'house')
  from t_fx where k = 'closer';

-- T1: a close is kept, with its version.
do $$
begin
  if to_regclass('public.month_closes') is null then
    raise exception 'T1 FAIL: there is no month_closes table to keep a closed month in';
  end if;
end $$;

insert into public.month_closes (restaurant_id, month, version, closed_by, zone, figures, till_csv)
select (select v from t_fx where k = 'house'), '2026-07', 1, (select v from t_fx where k = 'closer'),
       'Europe/Istanbul', '{"till": {"revenue": 1000}}'::jsonb, 'Day,Taken';

-- T2: a kept close cannot be edited or deleted by a statement.
do $$
declare refused boolean;
begin
  refused := false;
  begin
    update public.month_closes set figures = '{"till": {"revenue": 1}}'::jsonb
     where restaurant_id = (select v from t_fx where k = 'house');
  exception when others then refused := sqlerrm like '%append-only%';
  end;
  if not refused then
    raise exception 'T2 FAIL: a closed month''s figures could be edited';
  end if;

  refused := false;
  begin
    delete from public.month_closes where restaurant_id = (select v from t_fx where k = 'house');
  exception when others then refused := sqlerrm like '%append-only%';
  end;
  if not refused then
    raise exception 'T2 FAIL: a closed month could be deleted';
  end if;
end $$;

-- T3: one version per close; the month and the figures are checked.
do $$
declare refused boolean;
begin
  refused := false;
  begin
    insert into public.month_closes (restaurant_id, month, version, zone, figures)
    select v, '2026-07', 1, 'Europe/Istanbul', '{"till": {}}'::jsonb from t_fx where k = 'house';
  exception when unique_violation then refused := true;
  end;
  if not refused then
    raise exception 'T3 FAIL: two closes held version 1 of one month';
  end if;

  refused := false;
  begin
    insert into public.month_closes (restaurant_id, month, version, zone, figures)
    select v, '2026-13', 1, 'Europe/Istanbul', '{"till": {}}'::jsonb from t_fx where k = 'house';
  exception when check_violation then refused := true;
  end;
  if not refused then
    raise exception 'T3 FAIL: month 2026-13 was kept';
  end if;

  refused := false;
  begin
    insert into public.month_closes (restaurant_id, month, version, zone, figures)
    select v, '2026-08', 1, 'Europe/Istanbul', '{}'::jsonb from t_fx where k = 'house';
  exception when check_violation then refused := true;
  end;
  if not refused then
    raise exception 'T3 FAIL: a close with no figures was kept';
  end if;
end $$;

-- A second close of the same month is a new version beside the first.
insert into public.month_closes (restaurant_id, month, version, closed_by, zone, figures)
select (select v from t_fx where k = 'house'), '2026-07', 2, (select v from t_fx where k = 'closer'),
       'Europe/Istanbul', '{"till": {"revenue": 1100}}'::jsonb;

-- T4: the database keeps its own keys — the closer removed nulls closed_by
-- and leaves the figures; the house removed takes its closes with it.
do $$
declare n int; f jsonb;
begin
  delete from public.users where user_id = (select v from t_fx where k = 'closer');
  select count(*), min(figures::text)::jsonb into n, f from public.month_closes
   where restaurant_id = (select v from t_fx where k = 'house') and closed_by is null;
  if n <> 2 then
    raise exception 'T4 FAIL: removing the closer left % of 2 closes with no closer', n;
  end if;
  if f->'till'->>'revenue' <> '1000' then
    raise exception 'T4 FAIL: removing the closer changed the figures: %', f;
  end if;

  delete from public.restaurants where id = (select v from t_fx where k = 'house');
  select count(*) into n from public.month_closes
   where restaurant_id = (select v from t_fx where k = 'house');
  if n <> 0 then
    raise exception 'T4 FAIL: % closes outlived their house', n;
  end if;
end $$;

-- T5: locked down — RLS on, no client grant.
do $$
declare rls boolean; grants int;
begin
  select relrowsecurity into rls from pg_class where oid = 'public.month_closes'::regclass;
  if not rls then
    raise exception 'T5 FAIL: month_closes has row level security off';
  end if;
  select count(*) into grants from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'month_closes'
     and grantee in ('anon', 'authenticated');
  if grants > 0 then
    raise exception 'T5 FAIL: month_closes holds % client grant(s)', grants;
  end if;
end $$;

rollback;
