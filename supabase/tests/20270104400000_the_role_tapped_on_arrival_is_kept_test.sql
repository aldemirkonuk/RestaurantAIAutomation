-- F-899 (sim wave 65): the role tapped on get-started step 01 was kept in the
-- browser only. Migration the_role_tapped_on_arrival_is_kept adds
-- user_restaurant_access.job_role, nullable and CHECKed to the four chips.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration (T1) and PASS with it. One transaction,
-- rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values ('house', gen_random_uuid()), ('person', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC arrival-role house', 'syn-arole-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

insert into public.users (user_id, email, name)
select v, 'syn-arole-' || left(replace(v::text, '-', ''), 12) || '@example.invalid', 'SYNTHETIC person'
  from t_fx where k = 'person';

-- T1 the column exists, nullable, no default.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'user_restaurant_access'
       and column_name = 'job_role' and is_nullable = 'YES' and column_default is null
  ) then
    raise exception 'T1: user_restaurant_access.job_role is missing, not nullable, or defaulted';
  end if;
end $$;

-- T2 a tapped role is kept; none tapped is NULL.
insert into public.user_restaurant_access (user_id, restaurant_id, role, job_role)
select (select v from t_fx where k = 'person'), (select v from t_fx where k = 'house'), 'owner', 'beverage_lead';
do $$
begin
  if (select job_role from public.user_restaurant_access
       where restaurant_id = (select v from t_fx where k = 'house')) is distinct from 'beverage_lead' then
    raise exception 'T2: the tapped role was not kept';
  end if;
  update public.user_restaurant_access set job_role = null
   where restaurant_id = (select v from t_fx where k = 'house');
end $$;

-- T3 anything but the four is refused.
do $$
begin
  begin
    update public.user_restaurant_access set job_role = 'sommelier'
     where restaurant_id = (select v from t_fx where k = 'house');
    raise exception 'T3: job_role took a value outside the four';
  exception when check_violation then null;
  end;
end $$;

-- T4 no client may write it.
do $$
begin
  if has_column_privilege('anon', 'public.user_restaurant_access', 'job_role', 'UPDATE')
     or has_column_privilege('authenticated', 'public.user_restaurant_access', 'job_role', 'UPDATE')
     or has_column_privilege('authenticated', 'public.user_restaurant_access', 'job_role', 'INSERT') then
    raise exception 'T4: a client may write user_restaurant_access.job_role';
  end if;
end $$;

rollback;
