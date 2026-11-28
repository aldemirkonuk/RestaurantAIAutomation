-- SQL tests for 20271203100000_every_good_and_dish_has_a_taste_profile.sql.
-- Plain psql assertions against a throwaway Postgres built from
-- supabase/migrations (see 20260905232000_..._test.sql for the recipe):
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/20271203100000_every_good_and_dish_has_a_taste_profile_test.sql
-- Every assertion RAISEs on failure; the file runs in one transaction that is
-- ROLLED BACK. NEVER run it against production. All fixtures are SYNTHETIC.
begin;

insert into public.restaurants (id, name, slug)
values ('f1000000-0000-4000-8000-000000000001', 'SYNTHETIC Taste House', 'synthetic-taste');
insert into public.users (user_id, email, name, restaurant_id, role) values
  ('f2000000-0000-4000-8000-000000000001', 'taste-a@x.test', 'Taste A', 'f1000000-0000-4000-8000-000000000001', 'staff'),
  ('f2000000-0000-4000-8000-000000000002', 'taste-b@x.test', 'Taste B', 'f1000000-0000-4000-8000-000000000001', 'staff');
insert into public.cocktails (id, restaurant_id, name)
values ('f3000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'SYNTHETIC Sour');

-- T1: a valid axes object is accepted (including a typed 0).
insert into public.taste_profiles (restaurant_id, subject_kind, cocktail_id, source, version, method, axes, stated_by)
values ('f1000000-0000-4000-8000-000000000001', 'cocktail', 'f3000000-0000-4000-8000-000000000001',
        'house', 1, 'line', '{"sweet":{"v":4,"conf":0.6},"bitter":{"v":0,"conf":0.6,"sd":1.2}}',
        'f2000000-0000-4000-8000-000000000001');

-- T2: v = 11, conf = 2, sd = 0, a string v, an odd key, a non-object are all refused.
do $$
declare bad text; refused int := 0;
begin
  foreach bad in array array[
    '{"sweet":{"v":11,"conf":0.5}}', '{"sweet":{"v":4,"conf":2}}', '{"sweet":{"v":4,"conf":0.5,"sd":0}}',
    '{"sweet":{"v":"4","conf":0.5}}', '{"Sweet!":{"v":4,"conf":0.5}}', '{"sweet":4}', '[]', '{"sweet":{"v":4}}',
    '{"sweet":{"v":-1,"conf":0.5}}', '{"sweet":{"v":4,"conf":0.5,"sd":null}}'
  ] loop
    begin
      insert into public.taste_profiles (restaurant_id, subject_kind, cocktail_id, source, version, method, axes)
      values ('f1000000-0000-4000-8000-000000000001', 'cocktail', 'f3000000-0000-4000-8000-000000000001',
              'recipe', 1, 'computed', bad::jsonb);
    exception when check_violation then refused := refused + 1;
    end;
  end loop;
  if refused <> 10 then raise exception 'T2: expected 10 refusals, got %', refused; end if;
end $$;

-- T3: two subject ids on one row, no subject, and a kind that names another column are refused.
do $$
declare refused int := 0;
begin
  begin
    insert into public.taste_profiles (restaurant_id, subject_kind, cocktail_id, dish_id, source, version, method)
    values ('f1000000-0000-4000-8000-000000000001', 'cocktail', 'f3000000-0000-4000-8000-000000000001', gen_random_uuid(), 'house', 9, 'line');
  exception when check_violation then refused := refused + 1; end;
  begin
    insert into public.taste_profiles (restaurant_id, subject_kind, source, version, method)
    values ('f1000000-0000-4000-8000-000000000001', 'dish', 'house', 9, 'line');
  exception when check_violation then refused := refused + 1; end;
  begin
    insert into public.taste_profiles (restaurant_id, subject_kind, dish_id, source, version, method)
    values ('f1000000-0000-4000-8000-000000000001', 'cocktail', gen_random_uuid(), 'house', 9, 'line');
  exception when check_violation then refused := refused + 1; end;
  if refused <> 3 then raise exception 'T3: expected 3 refusals, got %', refused; end if;
end $$;

-- T4: two people's house layers coexist at version 1; one person's re-entry supersedes only their own.
insert into public.taste_profiles (restaurant_id, subject_kind, cocktail_id, source, version, method, axes, stated_by)
values ('f1000000-0000-4000-8000-000000000001', 'cocktail', 'f3000000-0000-4000-8000-000000000001',
        'house', 1, 'line', '{"sweet":{"v":6,"conf":0.6}}', 'f2000000-0000-4000-8000-000000000002'),
       ('f1000000-0000-4000-8000-000000000001', 'cocktail', 'f3000000-0000-4000-8000-000000000001',
        'house', 2, 'line', '{"sweet":{"v":5,"conf":0.6}}', 'f2000000-0000-4000-8000-000000000001');
do $$
declare n int; v1 numeric; v2 numeric;
begin
  select count(*) into n from public.taste_profile_current
   where cocktail_id = 'f3000000-0000-4000-8000-000000000001' and source = 'house';
  if n <> 2 then raise exception 'T4: expected 2 current house layers, got %', n; end if;
  select (axes->'sweet'->>'v')::numeric into v1 from public.taste_profile_current
   where stated_by = 'f2000000-0000-4000-8000-000000000001';
  select (axes->'sweet'->>'v')::numeric into v2 from public.taste_profile_current
   where stated_by = 'f2000000-0000-4000-8000-000000000002';
  if v1 <> 5 or v2 <> 6 then raise exception 'T4: wrong current values % %', v1, v2; end if;
end $$;

-- T5: the same (subject, source, author, version) twice is a unique violation.
do $$
begin
  begin
    insert into public.taste_profiles (restaurant_id, subject_kind, cocktail_id, source, version, method, stated_by)
    values ('f1000000-0000-4000-8000-000000000001', 'cocktail', 'f3000000-0000-4000-8000-000000000001',
            'house', 2, 'line', 'f2000000-0000-4000-8000-000000000001');
    raise exception 'T5: duplicate version accepted';
  exception when unique_violation then null; end;
end $$;

-- T6: anon and authenticated hold nothing on the table or the view.
do $$
declare r text; t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach t in array array['public.taste_profiles', 'public.taste_profile_current'] loop
      if has_table_privilege(r, t, 'SELECT') or has_table_privilege(r, t, 'INSERT') then
        raise exception 'T6: % can reach %', r, t;
      end if;
    end loop;
  end loop;
end $$;

rollback;
