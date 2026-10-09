-- F-577 and F-582 (owner-quarter sim, wave 17). Migration
-- a_removal_ends_their_grants_and_a_house_keeps_an_owner:
--   F-577 a person who leaves a house leaves the vendor-send grants they held
--         there (revoked, on the security ledger), so a re-invite starts with
--         none;
--   F-582 a change that would leave a house with no owner is refused (23514).
--
-- Self-asserting: every block raises on a failure. It must FAIL on a build
-- without that migration (T2, T3, T5, T6) and PASS with it. One transaction,
-- rolled back. The concurrent half of F-582 (two sessions) cannot run in one
-- session; T5/T6 prove the count and the refusal, the lock is read from the
-- function (T8).

begin;

-- A house with two owners (O1, O2), a staff member S holding a grant vouched
-- by O1, and a second staff member L known only by a users row.
insert into public.restaurants (id, name, slug)
values ('7b000000-0000-4000-8000-000000000001', 'Grant Test House', 'f577-grant-test-house'),
       ('7b000000-0000-4000-8000-000000000002', 'Other House', 'f577-other-house');
insert into public.users (user_id, email, name, role, restaurant_id) values
  ('7b000000-0000-4000-8000-0000000000e1', 'o1@example.test', 'Owner One', 'owner', '7b000000-0000-4000-8000-000000000001'),
  ('7b000000-0000-4000-8000-0000000000e2', 'o2@example.test', 'Owner Two', 'owner', '7b000000-0000-4000-8000-000000000001'),
  ('7b000000-0000-4000-8000-0000000000e3', 's@example.test', 'Staff Sam', 'staff', '7b000000-0000-4000-8000-000000000001'),
  ('7b000000-0000-4000-8000-0000000000e4', 'l@example.test', 'Legacy Lee', 'staff', '7b000000-0000-4000-8000-000000000001');
insert into public.user_restaurant_access (user_id, restaurant_id, role, is_active) values
  ('7b000000-0000-4000-8000-0000000000e1', '7b000000-0000-4000-8000-000000000001', 'owner', true),
  ('7b000000-0000-4000-8000-0000000000e2', '7b000000-0000-4000-8000-000000000001', 'owner', true),
  ('7b000000-0000-4000-8000-0000000000e3', '7b000000-0000-4000-8000-000000000001', 'staff', true);
insert into public.authority_grants (id, restaurant_id, grantor_user_id, grantee_user_id, scope, limit_amount, limit_currency, vouched_by_user_id, vouched_at) values
  ('7b000000-0000-4000-8000-0000000000f1', '7b000000-0000-4000-8000-000000000001', '7b000000-0000-4000-8000-0000000000e1', '7b000000-0000-4000-8000-0000000000e3', 'vendor_send', 500, 'TRY', '7b000000-0000-4000-8000-0000000000e1', now()),
  ('7b000000-0000-4000-8000-0000000000f2', '7b000000-0000-4000-8000-000000000001', '7b000000-0000-4000-8000-0000000000e1', '7b000000-0000-4000-8000-0000000000e4', 'vendor_send', null, null, '7b000000-0000-4000-8000-0000000000e1', now());

-- T1 the removal's first write (users row stops naming the house) leaves the
-- grant alone: Sam is still a member by the access row.
update public.users set restaurant_id = null where user_id = '7b000000-0000-4000-8000-0000000000e3';
do $$
begin
  assert (select revoked_at from public.authority_grants where id = '7b000000-0000-4000-8000-0000000000f1') is null,
    'T1 FAIL the grant was revoked while its holder was still a member';
end $$;

-- T2 the second write (access row deleted) revokes it, on the ledger.
delete from public.user_restaurant_access
 where user_id = '7b000000-0000-4000-8000-0000000000e3' and restaurant_id = '7b000000-0000-4000-8000-000000000001';
do $$
declare n int;
begin
  assert (select revoked_at from public.authority_grants where id = '7b000000-0000-4000-8000-0000000000f1') is not null,
    'T2 FAIL the removed person still holds a live grant';
  select count(*) into n from public.security_events
   where subject_id = '7b000000-0000-4000-8000-0000000000f1' and kind = 'grant_revoked'
     and detail->>'reason' = 'grantee_left';
  assert n = 1, format('T2 FAIL %s grant_revoked ledger rows, expected 1', n);
end $$;

-- T3 invited back: the grant does not come back.
insert into public.user_restaurant_access (user_id, restaurant_id, role, is_active)
values ('7b000000-0000-4000-8000-0000000000e3', '7b000000-0000-4000-8000-000000000001', 'staff', true);
do $$
begin
  assert (select revoked_at from public.authority_grants where id = '7b000000-0000-4000-8000-0000000000f1') is not null,
    'T3 FAIL a re-invite brought the grant back';
end $$;

-- T4 a member known only by the users row: clearing it ends their grant.
update public.users set restaurant_id = null where user_id = '7b000000-0000-4000-8000-0000000000e4';
do $$
begin
  assert (select revoked_at from public.authority_grants where id = '7b000000-0000-4000-8000-0000000000f2') is not null,
    'T4 FAIL a legacy member left and kept their grant';
end $$;

-- T5 an owner may step down while another owner stays...
update public.user_restaurant_access set role = 'manager'
 where user_id = '7b000000-0000-4000-8000-0000000000e2' and restaurant_id = '7b000000-0000-4000-8000-000000000001';
update public.users set role = 'manager' where user_id = '7b000000-0000-4000-8000-0000000000e2';
-- ...but the last one may not be demoted.
do $$
begin
  begin
    update public.user_restaurant_access set role = 'manager'
     where user_id = '7b000000-0000-4000-8000-0000000000e1' and restaurant_id = '7b000000-0000-4000-8000-000000000001';
    raise exception 'T5 FAIL the last owner was demoted';
  exception when check_violation then
    assert sqlerrm like 'house_keeps_an_owner%', format('T5 FAIL wrong refusal: %s', sqlerrm);
  end;
end $$;

-- T6 nor removed, nor deactivated (the removal clears the users row first,
-- so the access row is all that still makes them an owner).
update public.users set restaurant_id = null where user_id = '7b000000-0000-4000-8000-0000000000e1';
do $$
begin
  begin
    delete from public.user_restaurant_access
     where user_id = '7b000000-0000-4000-8000-0000000000e1' and restaurant_id = '7b000000-0000-4000-8000-000000000001';
    raise exception 'T6 FAIL the last owner was removed';
  exception when check_violation then null;
  end;
  begin
    update public.user_restaurant_access set is_active = false
     where user_id = '7b000000-0000-4000-8000-0000000000e1' and restaurant_id = '7b000000-0000-4000-8000-000000000001';
    raise exception 'T6 FAIL the last owner was deactivated';
  exception when check_violation then null;
  end;
end $$;

-- T7 a change that keeps an owner passes: a new owner first, then the old one
-- steps down; and a house with no owner rows is not blocked from other edits.
insert into public.user_restaurant_access (user_id, restaurant_id, role, is_active)
values ('7b000000-0000-4000-8000-0000000000e2', '7b000000-0000-4000-8000-000000000002', 'owner', true);
update public.user_restaurant_access set role = 'owner'
 where user_id = '7b000000-0000-4000-8000-0000000000e2' and restaurant_id = '7b000000-0000-4000-8000-000000000001';
update public.user_restaurant_access set role = 'staff'
 where user_id = '7b000000-0000-4000-8000-0000000000e1' and restaurant_id = '7b000000-0000-4000-8000-000000000001';
update public.user_restaurant_access set role = 'manager'
 where user_id = '7b000000-0000-4000-8000-0000000000e3' and restaurant_id = '7b000000-0000-4000-8000-000000000001';

-- T8 the refusal counts under a per-house lock (the concurrent half).
do $$
begin
  assert pg_get_functiondef('public.user_restaurant_access_keeps_an_owner()'::regprocedure)
           like '%pg_advisory_xact_lock%house_owners:%house_owner_count%',
    'T8 FAIL the owner count is not taken under the per-house lock';
end $$;

-- T9 deleting the house is not blocked by its last owner.
delete from public.restaurants where id = '7b000000-0000-4000-8000-000000000002';
do $$
begin
  assert not exists (select 1 from public.user_restaurant_access
                      where restaurant_id = '7b000000-0000-4000-8000-000000000002'),
    'T9 FAIL the deleted house kept access rows';
end $$;

-- T10 deleting an account still works with both triggers in place: the
-- access row goes first (as AuthService.deleteAccount does it), then the
-- account, and the grants it held go by cascade.
delete from public.user_restaurant_access where user_id = '7b000000-0000-4000-8000-0000000000e3';
delete from public.users where user_id = '7b000000-0000-4000-8000-0000000000e3';
do $$
begin
  assert not exists (select 1 from public.authority_grants
                      where grantee_user_id = '7b000000-0000-4000-8000-0000000000e3'),
    'T10 FAIL the deleted account kept its grants';
end $$;

rollback;
