-- public.fold_user_email_case(), migration a_sign_in_address_is_kept_in_lower_case
-- (QA round 11, R11-01; QA round 13): rows written before registration folded
-- the address are folded to trim + lower case; a row whose folded address
-- another row already holds, or whose folded address is not ASCII, is left
-- alone and listed in public.sign_in_addresses_held -- accounts are never
-- merged -- and the gateway's users.email_folded filter still finds it,
-- through the index.
--
-- Locale-free: this file must pass on a tr_TR.UTF-8 database as well as on
-- C and en_US (QA round 13 measured the first version folding I to dotless ı
-- there). The fixture's capital I rows are the probe.
--
-- Self-asserting (assert -> P0004); run with `psql -v ON_ERROR_STOP=1 -f` on a
-- database built from supabase/migrations. CI runs no supabase/tests file
-- (claim SUPABASE-TESTS-RUN-IN-CI), so the proof is the pgtest harness
-- (p4-scratch/sim-run/fixes/db/pgtest.sh lane): it passes with the migration
-- and fails without it (42883, no such function). Synthetic rows, one
-- transaction, rolled back.

begin;
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('f0d10000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;
create function pg_temp.email_of(s text) returns text language sql stable as $$
  select email::text from public.users where user_id = pg_temp.u(s)
$$;

do $$
declare
  r record;
  again record;
  plan record;
  plan_text text := '';
begin
  -- Start from a table with only this fixture in it.
  assert (select count(*) from public.users where email is distinct from public.sign_in_address_fold(email)) = 0,
    'a fresh database already holds an unfolded address';

  insert into public.users (user_id, email, name) values
    -- 1: the R11-01 owner, alone at their address -> folded.
    (pg_temp.u('1'), 'Chef@Bistro.com', 'Chef'),
    -- 2: padded and upper -> folded and trimmed.
    (pg_temp.u('2'), '  OWNER@HOUSE.TEST ', 'Owner'),
    -- 3 + 4: a case-collision with an already-folded row -> 3 held, 4 untouched.
    (pg_temp.u('3'), 'Victim@Gmail.com', 'Squatter'),
    (pg_temp.u('4'), 'victim@gmail.com', 'Victim'),
    -- 5 + 6: two unfolded spellings of one address -> both held. Under tr_TR a
    -- locale lower() made these two different addresses (twın / twin).
    (pg_temp.u('5'), 'Twin@Example.com', 'Twin A'),
    (pg_temp.u('6'), 'TWIN@example.com', 'Twin B'),
    -- 7: a capital dotted I lowers differently in Postgres and JS -> held.
    (pg_temp.u('7'), U&'\0130LKER@Example.com', 'Ilker'),
    -- 8: already folded -> untouched.
    (pg_temp.u('8'), 'plain@house.test', 'Plain'),
    -- 9: ASCII capital I -> i on every locale (tr_TR lower() gave dotless ı).
    (pg_temp.u('9'), 'ISIK@Example.com', 'Isik'),
    -- 10: a trailing no-break space: the folded form is ASCII -> folded.
    (pg_temp.u('10'), U&'Nbsp@X.com\00A0', 'Nbsp');

  select * into r from public.fold_user_email_case();
  assert r.folded = 4, format('folded %s rows, expected 4 (1, 2, 9, 10)', r.folded);
  assert r.held_collision = 3, format('held %s for a shared address, expected 3 (3, 5, 6)', r.held_collision);
  assert r.held_non_ascii = 1, format('held %s for non-ASCII, expected 1 (7)', r.held_non_ascii);

  assert pg_temp.email_of('1') = 'chef@bistro.com', 'the R11-01 owner was not folded';
  assert pg_temp.email_of('2') = 'owner@house.test', 'a padded address was not trimmed and folded';
  assert pg_temp.email_of('3') = 'Victim@Gmail.com', 'a colliding row was changed';
  assert pg_temp.email_of('4') = 'victim@gmail.com', 'the folded twin of a collision was changed';
  assert pg_temp.email_of('5') = 'Twin@Example.com', 'an unfolded twin was changed';
  assert pg_temp.email_of('6') = 'TWIN@example.com', 'an unfolded twin was changed';
  assert pg_temp.email_of('7') = U&'\0130LKER@Example.com', 'a non-ASCII address was guessed at';
  assert pg_temp.email_of('8') = 'plain@house.test', 'a folded address was changed';
  assert pg_temp.email_of('9') = 'isik@example.com',
    format('capital I folded to %s, not isik@example.com (a locale lower()?)', pg_temp.email_of('9'));
  assert pg_temp.email_of('10') = 'nbsp@x.com', 'a trailing no-break space was not trimmed';
  -- Nothing merged, nothing removed.
  assert (select count(*) from public.users where user_id between pg_temp.u('1') and pg_temp.u('10')) = 10,
    'a row was removed';

  -- The held rows are recorded where a person can read them, with the reason.
  assert (select count(*) from public.sign_in_addresses_held) = 4, 'the held list is not 4 rows';
  assert (select reason from public.sign_in_addresses_held where user_id = pg_temp.u('3')) = 'shared_address', 'row 3 not held as shared';
  assert (select shared_with from public.sign_in_addresses_held where user_id = pg_temp.u('3')) = array[pg_temp.u('4')], 'row 3 does not name row 4';
  assert (select reason from public.sign_in_addresses_held where user_id = pg_temp.u('7')) = 'non_ascii', 'row 7 not held as non-ASCII';

  -- The gateway's third read (findUserBySignInAddress: .eq('email_folded',
  -- asciiFoldAddress(typed.trim()))) still finds a held row typed in another
  -- ASCII case. The value is what the TypeScript fold sends.
  assert (select array_agg(u.user_id) from public.users u where u.email_folded = U&'\0130lker@example.com') = array[pg_temp.u('7')],
    'a held non-ASCII row is not found under the fold';
  assert (select array_agg(u.user_id) from public.users u where u.email_folded = 'chef@bistro.com') = array[pg_temp.u('1')],
    'a folded row is not found under the fold';
  -- Two holders: both returned (the gateway then names nobody).
  assert (select count(*) from public.users u where u.email_folded = 'twin@example.com') = 2, 'held twins not both returned';
  assert (select count(*) from public.users u where u.email_folded = 'nobody@house.test') = 0, 'an unknown address found someone';
  -- The fold is the gateway's normalizeEmail on ASCII, on any locale.
  assert public.sign_in_address_fold(U&'\00A0 MiXeD.I@Example.COM\FEFF') = 'mixed.i@example.com', 'the fold is not trim + ASCII lower';
  -- The computed field reaches the index (both functions inline).
  assert exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'users'
                  and indexname = 'users_sign_in_address_fold_idx'), 'no index on the folded address';
  set local enable_seqscan = off;
  for plan in execute 'explain select user_id from public.users u where u.email_folded = ''x@y.z''' loop
    plan_text := plan_text || plan."QUERY PLAN" || E'\n';
  end loop;
  reset enable_seqscan;
  assert plan_text like '%users_sign_in_address_fold_idx%', format('the email_folded filter does not use the index: %s', plan_text);

  -- Re-runnable: a second run folds nothing and names the same rows.
  select * into again from public.fold_user_email_case();
  assert again.folded = 0, 'a second run folded again';
  assert again.held_collision = 3 and again.held_non_ascii = 1, 'a second run named different rows';
  assert (select count(*) from public.sign_in_addresses_held) = 4, 'a second run duplicated the held list';

  -- After a person resolves the collision (here: the squatter row is renamed),
  -- the next run folds what is left and drops it from the held list.
  update public.users set email = 'squatter-resolved@house.test' where user_id = pg_temp.u('3');
  delete from public.users where user_id = pg_temp.u('6');
  select * into again from public.fold_user_email_case();
  assert again.folded = 1 and pg_temp.email_of('5') = 'twin@example.com', 'a resolved twin was not folded';
  assert again.held_collision = 0, 'a resolved collision is still held';
  assert (select count(*) from public.sign_in_addresses_held) = 1, 'resolved rows are still on the held list';

  -- Only the owner may run the fold or read the held list; only the gateway's
  -- service role may filter on the folded address.
  assert not has_function_privilege('anon', 'public.fold_user_email_case()', 'execute'), 'anon can run the fold';
  assert not has_function_privilege('authenticated', 'public.fold_user_email_case()', 'execute'), 'authenticated can run the fold';
  assert not has_function_privilege('service_role', 'public.fold_user_email_case()', 'execute'), 'service_role can run the fold';
  assert not has_table_privilege('anon', 'public.sign_in_addresses_held', 'select'), 'anon can read the held list';
  assert not has_table_privilege('authenticated', 'public.sign_in_addresses_held', 'select'), 'authenticated can read the held list';
  assert not has_function_privilege('anon', 'public.email_folded(public.users)', 'execute'), 'anon can filter on the folded address';
  assert not has_function_privilege('authenticated', 'public.email_folded(public.users)', 'execute'), 'authenticated can filter on the folded address';
  assert has_function_privilege('service_role', 'public.email_folded(public.users)', 'execute'), 'the gateway cannot filter on the folded address';
end $$;

rollback;
