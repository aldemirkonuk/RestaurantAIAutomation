-- OB-2 (onboarding proposal §3 Phase 1, §4 F14; audit G16): migration
-- the_first_house_opens_in_one_transaction adds open_first_house(...), which
-- writes a first house's six rows (organizations, restaurants,
-- user_onboarding_progress, organization_members, user_restaurant_access, the
-- users row) in the one transaction a function call is.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` or the PGlite harness stops
-- at the first one. Run it on a database built from supabase/migrations. It
-- must FAIL on a build without that migration (T1: no such function) and PASS
-- with it. One transaction, rolled back: it leaves nothing behind.
--
-- What the DO-block failure cases prove: each catches the function's error in
-- its own block, so they show the error is RAISED (never swallowed by a step
-- that carries on) and that the person's users row is untouched; that a
-- statement's writes all go when it errors is PostgreSQL's, not this file's.
-- The PGlite proof that drives the same failure as a top-level autocommit
-- call (no enclosing transaction, as PostgREST runs it) is cited in the PR.

begin;

-- T1 the function exists, runs as its caller, pins search_path, and only the
-- server's role may call it.
do $$
declare
  f regprocedure := to_regprocedure(
    'public.open_first_house(uuid, text, text, text, text, jsonb, text, text, text, text, text, text, text, text, numeric, numeric, text)');
  definer boolean;
  config text[];
begin
  assert f is not null, 'T1 FAIL public.open_first_house(...) does not exist';
  select prosecdef, proconfig into definer, config from pg_proc where oid = f;
  assert not definer, 'T1 FAIL open_first_house is SECURITY DEFINER';
  assert config @> array['search_path=public, pg_temp'],
    format('T1 FAIL search_path is not pinned: %s', config);
  assert not has_function_privilege('anon', f, 'execute'),
    'T1 FAIL anon can execute open_first_house';
  assert not has_function_privilege('authenticated', f, 'execute'),
    'T1 FAIL authenticated can execute open_first_house';
  assert has_function_privilege('service_role', f, 'execute'),
    'T1 FAIL service_role cannot execute open_first_house';
  assert not exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = f and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
    'T1 FAIL PUBLIC holds EXECUTE on open_first_house';
end $$;

-- Three people, none with a house. Ids are fixed and unlikely; the whole file
-- rolls back.
insert into public.users (user_id, email, name, role, email_verified) values
  ('0b200000-0000-4000-8000-000000000001', 'ob2-open@example.test', 'Open', 'manager', true),
  ('0b200000-0000-4000-8000-000000000002', 'ob2-refused@example.test', 'Refused', 'manager', true),
  ('0b200000-0000-4000-8000-000000000003', 'ob2-twice@example.test', 'Twice', 'manager', true);

-- T2 one call opens the whole house.
do $$
declare
  u uuid := '0b200000-0000-4000-8000-000000000001';
  answer jsonb;
  org uuid;
  house uuid;
begin
  answer := public.open_first_house(
    u, 'OB2 Open Group', 'OB2 Open', 'ob2-open-a1b2c3', 'ob2-open@example.test',
    '{"street": "1 House Street"}'::jsonb, 'Istanbul', 'Türkiye',
    p_timezone => 'Europe/Istanbul', p_currency => 'TRY',
    p_latitude => 41.0369, p_longitude => 28.985, p_google_place_id => 'ChIJ-ob2-open');
  org := (answer->>'organization_id')::uuid;
  house := (answer->>'restaurant_id')::uuid;
  assert org is not null and house is not null, format('T2 FAIL answer is %s', answer);
  assert (select count(*) from public.organizations where id = org and owner_id = u) = 1,
    'T2 FAIL no organization';
  assert (select count(*) from public.restaurants
           where id = house and organization_id = org and slug = 'ob2-open-a1b2c3'
             and timezone = 'Europe/Istanbul' and currency = 'TRY'
             and google_place_id = 'ChIJ-ob2-open' and latitude = 41.0369) = 1,
    'T2 FAIL the house row is missing or wrong';
  assert (select count(*) from public.user_onboarding_progress where user_id = u and restaurant_id = house) = 1,
    'T2 FAIL no onboarding row';
  assert (select count(*) from public.organization_members where organization_id = org and user_id = u and role = 'owner') = 1,
    'T2 FAIL no owner membership';
  assert (select count(*) from public.user_restaurant_access
           where user_id = u and restaurant_id = house and role = 'owner' and is_active) = 1,
    'T2 FAIL no active owner access row';
  assert (select restaurant_id = house and role = 'owner' from public.users where user_id = u),
    'T2 FAIL the users row does not name the house';
end $$;

-- T3 the access row is refused (the G16 case): the error is raised, and the
-- person is left with no organization, no house, no onboarding claim, and a
-- users row that names no house, so a retry is not answered 409.
create function public.ob2_test_refuse_access() returns trigger
language plpgsql as $$
begin
  if new.user_id = '0b200000-0000-4000-8000-000000000002' then
    raise exception 'ob2 test: the access row is refused' using errcode = '08006';
  end if;
  return new;
end $$;
create trigger ob2_test_refuse_access before insert on public.user_restaurant_access
  for each row execute function public.ob2_test_refuse_access();

do $$
declare
  u uuid := '0b200000-0000-4000-8000-000000000002';
  raised text;
begin
  begin
    perform public.open_first_house(
      u, 'OB2 Refused Group', 'OB2 Refused', 'ob2-refused-a1b2c3',
      'ob2-refused@example.test', '{}'::jsonb);
  exception when others then
    raised := sqlstate;
  end;
  assert raised = '08006', format('T3 FAIL the refusal was not raised (sqlstate %s)', raised);
  assert not exists (select 1 from public.organizations where owner_id = u),
    'T3 FAIL an organization survived the refused access row';
  assert not exists (select 1 from public.restaurants where slug = 'ob2-refused-a1b2c3'),
    'T3 FAIL a house survived the refused access row';
  assert not exists (select 1 from public.user_onboarding_progress where user_id = u),
    'T3 FAIL an onboarding claim survived the refused access row';
  assert (select restaurant_id is null and role = 'manager' from public.users where user_id = u),
    'T3 FAIL the users row was touched';
end $$;

drop trigger ob2_test_refuse_access on public.user_restaurant_access;
drop function public.ob2_test_refuse_access();

-- T4 the retry after T3 opens the house.
do $$
declare
  u uuid := '0b200000-0000-4000-8000-000000000002';
  answer jsonb;
begin
  answer := public.open_first_house(
    u, 'OB2 Refused Group', 'OB2 Refused', 'ob2-refused-d4e5f6',
    'ob2-refused@example.test', '{}'::jsonb);
  assert (select restaurant_id = (answer->>'restaurant_id')::uuid from public.users where user_id = u),
    'T4 FAIL the retry did not open the house';
  assert (select count(*) from public.organizations where owner_id = u) = 1,
    'T4 FAIL the retry left other than one organization';
end $$;

-- T5 a second first house by the same account (the concurrent loser, F-006
-- OPEN-6 option b): the onboarding claim's UNIQUE(user_id) refuses it before
-- the membership, the access row or the users row, and nothing of it stays.
do $$
declare
  u uuid := '0b200000-0000-4000-8000-000000000003';
  first jsonb;
  raised text;
  msg text;
begin
  first := public.open_first_house(
    u, 'OB2 Twice Group', 'OB2 Twice', 'ob2-twice-a1b2c3', 'ob2-twice@example.test', '{}'::jsonb);
  begin
    perform public.open_first_house(
      u, 'OB2 Twice Group', 'OB2 Twice', 'ob2-twice-d4e5f6', 'ob2-twice@example.test', '{}'::jsonb);
  exception when others then
    raised := sqlstate;
    msg := sqlerrm;
  end;
  assert raised = '23505' and msg like '%user_onboarding_progress_user_id_key%',
    format('T5 FAIL the second house was not refused at the onboarding claim: %s %s', raised, msg);
  assert (select count(*) from public.organizations where owner_id = u) = 1,
    'T5 FAIL the refused second house left an organization';
  assert not exists (select 1 from public.restaurants where slug = 'ob2-twice-d4e5f6'),
    'T5 FAIL the refused second house left a house';
  assert (select restaurant_id = (first->>'restaurant_id')::uuid from public.users where user_id = u),
    'T5 FAIL the refused second house moved the users row';
end $$;

-- T6 the database's own error comes back, so the gateway's isSharedPlace still
-- reads a held place (a 23505 naming idx_restaurants_google_place_id).
do $$
declare
  raised text;
  msg text;
begin
  insert into public.users (user_id, email, name, role, email_verified) values
    ('0b200000-0000-4000-8000-000000000004', 'ob2-held@example.test', 'Held', 'manager', true);
  begin
    perform public.open_first_house(
      '0b200000-0000-4000-8000-000000000004', 'OB2 Held Group', 'OB2 Held',
      'ob2-held-a1b2c3', 'ob2-held@example.test', '{}'::jsonb,
      p_latitude => 41.0, p_longitude => 29.0, p_google_place_id => 'ChIJ-ob2-open');
  exception when others then
    raised := sqlstate;
    msg := sqlerrm;
  end;
  assert raised = '23505' and msg like '%"idx_restaurants_google_place_id"%',
    format('T6 FAIL a held place did not come back as the place index''s 23505: %s %s', raised, msg);
end $$;

rollback;
