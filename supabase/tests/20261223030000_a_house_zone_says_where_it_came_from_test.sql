-- ADR 0304, PR-1 of lane zoneaddr: a house's time zone says where it came
-- from. Migration a_house_zone_says_where_it_came_from adds
-- restaurants.timezone_source ('address' | 'device' | 'stated') and
-- restaurants.timezone_source_zone (the zone that source vouches for), tied by
-- CHECK restaurants_timezone_source_known.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or a
-- RAISE naming the test), so `psql -v ON_ERROR_STOP=1 -f` stops at the first
-- one. Run it on a database built from supabase/migrations. Synthetic
-- fixtures only, one transaction, rolled back.
--
-- On a build WITHOUT the migration every test FAILS (T0 first: the columns
-- are not there). T5 and T6 pin what the migration keeps for other writers:
-- a zone with no recorded source, and a blind rewrite of timezone.

begin;

-- T0 the two columns exist, have the right types, carry no default, and the
-- CHECK is there and validated.
do $$
declare
  t_src text;
  t_zone text;
  t_tz text;
begin
  select format_type(a.atttypid, a.atttypmod) into t_src
    from pg_attribute a
   where a.attrelid = 'public.restaurants'::regclass and a.attname = 'timezone_source' and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into t_zone
    from pg_attribute a
   where a.attrelid = 'public.restaurants'::regclass and a.attname = 'timezone_source_zone' and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into t_tz
    from pg_attribute a
   where a.attrelid = 'public.restaurants'::regclass and a.attname = 'timezone' and not a.attisdropped;
  if t_src is distinct from 'text' then
    raise exception 'T0 FAIL restaurants.timezone_source is %, expected text', coalesce(t_src, 'absent');
  end if;
  if t_zone is distinct from t_tz then
    raise exception 'T0 FAIL restaurants.timezone_source_zone is %, expected the type of timezone (%)', coalesce(t_zone, 'absent'), t_tz;
  end if;
  if exists (
    select 1 from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = 'public.restaurants'::regclass and a.attname in ('timezone_source', 'timezone_source_zone')
  ) then
    raise exception 'T0 FAIL a source column carries a default (ADR 0116)';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'restaurants_timezone_source_known'
       and conrelid = 'public.restaurants'::regclass and contype = 'c' and convalidated
  ) then
    raise exception 'T0 FAIL restaurants_timezone_source_known is missing or not validated';
  end if;
end $$;

-- A refusal helper: runs one insert and says which constraint refused it, or
-- 'ADMITTED' when nothing did.
create function pg_temp.zs_refusal(p_id uuid, p_tz text, p_src text, p_zone text) returns text
language plpgsql as $$
declare
  c text;
begin
  begin
    insert into public.restaurants (id, name, slug, timezone, timezone_source, timezone_source_zone)
    values (p_id, 'zoneaddr test house', 'zoneaddr-test-' || p_id::text, p_tz, p_src, p_zone);
  exception when check_violation then
    get stacked diagnostics c = constraint_name;
    return c;
  end;
  delete from public.restaurants where id = p_id;
  return 'ADMITTED';
end $$;

-- T1 a source that is not one of the three is refused, by name.
do $$
declare
  r text;
  bad text;
begin
  foreach bad in array array['guessed', 'Address', '', 'house', 'country'] loop
    r := pg_temp.zs_refusal('a3040000-0000-4000-8000-000000000101', 'Europe/Istanbul', bad, 'Europe/Istanbul');
    if r is distinct from 'restaurants_timezone_source_known' then
      raise exception 'T1 FAIL source "%" was %, expected refused by restaurants_timezone_source_known', bad, r;
    end if;
  end loop;
end $$;

-- T2 a source that vouches for no zone is refused.
do $$
declare
  r text;
begin
  r := pg_temp.zs_refusal('a3040000-0000-4000-8000-000000000102', 'Europe/Istanbul', 'address', null);
  if r is distinct from 'restaurants_timezone_source_known' then
    raise exception 'T2 FAIL a source with no zone was %, expected refused', r;
  end if;
end $$;

-- T3 a vouched zone with NO source is refused. This is the NULL-IN trap: the
-- "(both null) OR (source IN (...) AND zone IS NOT NULL)" form evaluates to
-- NULL here and a NULL CHECK passes.
do $$
declare
  r text;
begin
  r := pg_temp.zs_refusal('a3040000-0000-4000-8000-000000000103', 'Europe/Istanbul', null, 'Europe/Istanbul');
  if r is distinct from 'restaurants_timezone_source_known' then
    raise exception 'T3 FAIL a zone with no source was %, expected refused (the NULL-IN trap)', r;
  end if;
end $$;

-- T4 each of the three sources is admitted with the zone it vouches for.
do $$
declare
  r text;
  src text;
begin
  foreach src in array array['address', 'device', 'stated'] loop
    r := pg_temp.zs_refusal('a3040000-0000-4000-8000-000000000104', 'America/Chicago', src, 'America/Chicago');
    if r is distinct from 'ADMITTED' then
      raise exception 'T4 FAIL source % with its zone was refused by %', src, r;
    end if;
  end loop;
end $$;

-- T5 a zone whose source was never recorded (null/null) is admitted, and a
-- house that names nothing reads null/null: no default fills either column.
do $$
declare
  r text;
  h uuid := 'a3040000-0000-4000-8000-000000000105';
  s text;
  z text;
begin
  r := pg_temp.zs_refusal('a3040000-0000-4000-8000-000000000106', 'Europe/Istanbul', null, null);
  if r is distinct from 'ADMITTED' then
    raise exception 'T5 FAIL a zone with no recorded source was refused by %', r;
  end if;
  insert into public.restaurants (id, name, slug) values (h, 'zoneaddr bare house', 'zoneaddr-bare-house');
  select timezone_source, timezone_source_zone into s, z from public.restaurants where id = h;
  if s is not null or z is not null then
    raise exception 'T5 FAIL a bare insert read source % zone %, expected null/null', s, z;
  end if;
end $$;

-- T6 a writer that knows nothing of the pair (the sim seed RPC,
-- scripts/synth/seed.py) can still rewrite timezone over a recorded pair. The
-- pair stays as it was, so it no longer matches: the gateway reads that as
-- "source not recorded" rather than a stale label.
do $$
declare
  h uuid := 'a3040000-0000-4000-8000-000000000107';
  s text;
  z text;
  tz text;
begin
  insert into public.restaurants (id, name, slug, timezone, timezone_source, timezone_source_zone)
  values (h, 'zoneaddr seeded house', 'zoneaddr-seeded-house', 'America/Los_Angeles', 'address', 'America/Los_Angeles');
  begin
    update public.restaurants set timezone = 'Europe/Istanbul' where id = h;
  exception when others then
    raise exception 'T6 FAIL a blind rewrite of timezone was refused: % %', sqlstate, sqlerrm;
  end;
  select timezone, timezone_source, timezone_source_zone into tz, s, z from public.restaurants where id = h;
  if tz <> 'Europe/Istanbul' or s <> 'address' or z <> 'America/Los_Angeles' then
    raise exception 'T6 FAIL after the blind rewrite: timezone % source % zone %', tz, s, z;
  end if;
  -- Clearing the zone alone is also a blind write the CHECK lets through.
  update public.restaurants set timezone = null where id = h;
end $$;

rollback;
