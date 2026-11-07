-- public.fold_user_email_case(), migration a_sign_in_address_is_kept_in_lower_case
-- (QA round 11, R11-01): rows written before registration folded the address
-- are folded to trim + lower case, and a row whose folded address another row
-- already holds is left alone and named -- accounts are never merged.
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
begin
  -- Start from a table with only this fixture in it.
  assert (select count(*) from public.users where email <> lower(btrim(email))) = 0,
    'a fresh database already holds an unfolded address';

  insert into public.users (user_id, email, name) values
    -- 1: the R11-01 owner, alone at their address -> folded.
    (pg_temp.u('1'), 'Chef@Bistro.com', 'Chef'),
    -- 2: padded and upper -> folded and trimmed.
    (pg_temp.u('2'), '  OWNER@HOUSE.TEST ', 'Owner'),
    -- 3 + 4: a case-collision with an already-folded row -> 3 held, 4 untouched.
    (pg_temp.u('3'), 'Victim@Gmail.com', 'Squatter'),
    (pg_temp.u('4'), 'victim@gmail.com', 'Victim'),
    -- 5 + 6: two unfolded spellings of one address -> both held.
    (pg_temp.u('5'), 'Twin@Example.com', 'Twin A'),
    (pg_temp.u('6'), 'TWIN@example.com', 'Twin B'),
    -- 7: a capital dotted I lowers differently in Postgres and JS -> held.
    (pg_temp.u('7'), U&'\0130LKER@Example.com', 'Ilker'),
    -- 8: already folded -> untouched.
    (pg_temp.u('8'), 'plain@house.test', 'Plain');

  select * into r from public.fold_user_email_case();
  assert r.folded = 2, format('folded %s rows, expected 2 (1 and 2)', r.folded);
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
  -- Nothing merged, nothing removed.
  assert (select count(*) from public.users where user_id between pg_temp.u('1') and pg_temp.u('8')) = 8,
    'a row was removed';

  -- Re-runnable: a second run folds nothing and names the same rows.
  select * into again from public.fold_user_email_case();
  assert again.folded = 0, 'a second run folded again';
  assert again.held_collision = 3 and again.held_non_ascii = 1, 'a second run named different rows';

  -- After a person resolves the collision (here: the squatter row is renamed),
  -- the next run folds what is left.
  update public.users set email = 'squatter-resolved@house.test' where user_id = pg_temp.u('3');
  delete from public.users where user_id = pg_temp.u('6');
  select * into again from public.fold_user_email_case();
  assert again.folded = 1 and pg_temp.email_of('5') = 'twin@example.com', 'a resolved twin was not folded';
  assert again.held_collision = 0, 'a resolved collision is still held';

  -- Only the owner may run it; no API role can reach it.
  assert not has_function_privilege('anon', 'public.fold_user_email_case()', 'execute'), 'anon can run the fold';
  assert not has_function_privilege('authenticated', 'public.fold_user_email_case()', 'execute'), 'authenticated can run the fold';
  assert not has_function_privilege('service_role', 'public.fold_user_email_case()', 'execute'), 'service_role can run the fold';
end $$;

rollback;
