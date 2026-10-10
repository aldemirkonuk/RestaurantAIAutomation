-- F-1087: migration 20270104900000 cancels every pending invite its issuer's
-- CURRENT role in the house can no longer give (grantRefusal, ADR 0162):
-- owner gives owner/manager/staff, manager gives manager/staff, anyone else
-- or no active row gives nothing.
--
-- Self-asserting: every block raises on a failure, so `psql -v
-- ON_ERROR_STOP=1 -f` stops at the first one. One transaction, rolled back.
-- The migration is a one-time UPDATE and has already run by the time this
-- file runs, so the fixtures below cannot meet it: the statement between the
-- MIGRATION markers is the migration's own UPDATE, copied verbatim, and must
-- be kept identical to it. The lane proof replaces that block with the
-- migration file itself and runs the asserts again (same result). It also
-- runs twice, to show a second run changes nothing.

begin;

insert into public.organizations (id, name) values
  ('f1087000-0000-4000-8000-0000000000a0', 'F1087 org');
insert into public.restaurants (id, name, slug) values
  ('f1087000-0000-4000-8000-000000000001', 'F1087 house', 'f1087-house'),
  ('f1087000-0000-4000-8000-000000000002', 'F1087 other', 'f1087-other');
insert into public.users (user_id, email, name, role) values
  ('f1087000-0000-4000-8000-0000000000b1', 'f1087-owner@x.test',   'Owner',   'owner'),
  ('f1087000-0000-4000-8000-0000000000b2', 'f1087-manager@x.test', 'Manager', 'manager'),
  ('f1087000-0000-4000-8000-0000000000b3', 'f1087-demoted@x.test', 'Demoted', 'staff'),
  ('f1087000-0000-4000-8000-0000000000b4', 'f1087-gone@x.test',    'Gone',    'manager'),
  ('f1087000-0000-4000-8000-0000000000b5', 'f1087-elsewhere@x.test','Else',   'owner');
insert into public.user_restaurant_access (user_id, restaurant_id, role, is_active) values
  ('f1087000-0000-4000-8000-0000000000b1', 'f1087000-0000-4000-8000-000000000001', 'owner',   true),
  ('f1087000-0000-4000-8000-0000000000b2', 'f1087000-0000-4000-8000-000000000001', 'manager', true),
  ('f1087000-0000-4000-8000-0000000000b3', 'f1087000-0000-4000-8000-000000000001', 'staff',   true),
  ('f1087000-0000-4000-8000-0000000000b4', 'f1087000-0000-4000-8000-000000000001', 'manager', false),
  ('f1087000-0000-4000-8000-0000000000b5', 'f1087000-0000-4000-8000-000000000002', 'owner',   true);

-- code, issuer, role, and whether the invite must still be live afterwards.
insert into public.organization_invites
  (organization_id, restaurant_id, code, invited_by, role, expires_at, used_at)
select 'f1087000-0000-4000-8000-0000000000a0', 'f1087000-0000-4000-8000-000000000001',
       v.code, v.issuer::uuid, v.role, now() + interval '5 days', v.used_at
  from (values
    ('F1087OW1', 'f1087000-0000-4000-8000-0000000000b1', 'owner',   null::timestamptz), -- owner gives owner: live
    ('F1087MM1', 'f1087000-0000-4000-8000-0000000000b2', 'manager', null),              -- manager gives manager: live
    ('F1087MS1', 'f1087000-0000-4000-8000-0000000000b2', 'staff',   null),              -- manager gives staff: live
    ('F1087MO1', 'f1087000-0000-4000-8000-0000000000b2', 'owner',   null),              -- manager gives owner: cancelled
    ('F1087DM1', 'f1087000-0000-4000-8000-0000000000b3', 'manager', null),              -- demoted to staff: cancelled
    ('F1087DS1', 'f1087000-0000-4000-8000-0000000000b3', 'staff',   null),              -- staff gives nothing: cancelled
    ('F1087GN1', 'f1087000-0000-4000-8000-0000000000b4', 'staff',   null),              -- inactive row: cancelled
    ('F1087EL1', 'f1087000-0000-4000-8000-0000000000b5', 'staff',   null),              -- owner of ANOTHER house only: cancelled
    ('F1087US1', 'f1087000-0000-4000-8000-0000000000b3', 'manager', now() - interval '1 day') -- already used: untouched
  ) as v(code, issuer, role, used_at);

-- One already-expired invite from the demoted issuer: its date must not move.
insert into public.organization_invites
  (organization_id, restaurant_id, code, invited_by, role, expires_at)
values ('f1087000-0000-4000-8000-0000000000a0', 'f1087000-0000-4000-8000-000000000001',
        'F1087XP1', 'f1087000-0000-4000-8000-0000000000b3', 'manager', '2026-01-01T00:00:00Z');

create temp table f1087_before on commit drop as
  select code, expires_at from public.organization_invites where code like 'F1087%';

-- MIGRATION BEGIN (verbatim: supabase/migrations/20270104900000_an_invite_its_issuer_can_no_longer_give_is_cancelled.sql)
update public.organization_invites as i
   set expires_at = now()
 where i.used_at is null
   and i.expires_at > now()
   and not exists (
     select 1
       from public.user_restaurant_access a
      where a.user_id = i.invited_by
        and a.restaurant_id = i.restaurant_id
        and a.is_active = true
        and (
              a.role = 'owner'
           or (a.role = 'manager' and i.role in ('manager', 'staff'))
        )
   );
-- MIGRATION END

-- T1 every invite its issuer can still give is live, every other pending one
-- is cancelled, and used or already-expired ones keep their date.
do $$
declare bad text;
begin
  select string_agg(i.code, ', ') into bad
    from public.organization_invites i
    join f1087_before b using (code)
   where (i.code in ('F1087OW1', 'F1087MM1', 'F1087MS1') and i.expires_at <= now())
      or (i.code in ('F1087MO1', 'F1087DM1', 'F1087DS1', 'F1087GN1', 'F1087EL1')
          and i.expires_at > now())
      or (i.code in ('F1087US1', 'F1087XP1') and i.expires_at <> b.expires_at)
      or i.used_at is distinct from case when i.code = 'F1087US1' then i.used_at end;
  if bad is not null then
    raise exception 'T1 wrong outcome for: %', bad;
  end if;
end $$;

-- T2 a second run changes nothing (idempotent): the same WHERE, with a
-- setter that would show any row it still matched.
create temp table f1087_after on commit drop as
  select code, expires_at from public.organization_invites where code like 'F1087%';
update public.organization_invites as i
   set expires_at = now() + interval '1 second'
 where i.used_at is null
   and i.expires_at > now()
   and not exists (
     select 1
       from public.user_restaurant_access a
      where a.user_id = i.invited_by
        and a.restaurant_id = i.restaurant_id
        and a.is_active = true
        and (
              a.role = 'owner'
           or (a.role = 'manager' and i.role in ('manager', 'staff'))
        )
   );
do $$
begin
  if exists (
    select 1 from public.organization_invites i join f1087_after a using (code)
     where i.expires_at <> a.expires_at
  ) then
    raise exception 'T2 a second run found more to cancel';
  end if;
end $$;

rollback;
