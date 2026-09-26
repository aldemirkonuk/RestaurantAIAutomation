-- A house membership that ends is remembered, so the web can tell a person who
-- was removed from a house apart from an account that never had one.
--
-- ADR 0164, bracket of 2026-09-25 (the founder, round 4, item 16): "Verified
-- account with zero houses and no ended membership -> straight to
-- /get-started; removed-from-house people still see /no-access." (ADR 0164 vs
-- ADR 0213.)
--
-- Why a table: every removal path deletes the `user_restaurant_access` row
-- (members.service.ts removeMember, team.service.ts deleteMember,
-- auth.service.ts leaveRestaurant and deleteAccount, and the FK cascade when a
-- house is deleted), so after a removal nothing in the database says the
-- person ever had a house. The web's only signal was a sessionStorage note set
-- in the tab that saw the refusal; a removed person signing in the next day, or
-- on another device, would have been sent to /get-started and invited to open
-- a restaurant. A trigger records every ended membership at the one place all
-- of those paths meet, including paths written later.
--
-- Read by AuthService.memberHouses' caller (`GET /auth/houses`, field
-- `accessEnded`) only when the person has no active house.

create table if not exists public.house_memberships_ended (
  user_id       uuid        not null references public.users(user_id) on delete cascade,
  -- No foreign key: the house may itself be gone (deleting a house cascades
  -- its membership rows, and that is an ended membership too).
  restaurant_id uuid        not null,
  ended_at      timestamptz not null default now(),
  primary key (user_id, restaurant_id)
);

comment on table public.house_memberships_ended is
  'One row per (person, house) whose active user_restaurant_access row was deleted or deactivated; '
  'written only by trigger user_restaurant_access_end_is_remembered. ADR 0164 bracket 2026-09-25 '
  '(founder round 4, item 16): a verified account with no house and no row here goes to /get-started; '
  'a person with a row here sees /no-access.';

-- OD-59 / OD-94 house rule: RLS and the client REVOKE in the migration that
-- creates the table. Only the gateway (service role) reads it.
alter table public.house_memberships_ended enable row level security;
revoke all on table public.house_memberships_ended from anon, authenticated;

-- SECURITY INVOKER on purpose (ADR 0159): only the service role writes
-- user_restaurant_access (its client policies are SELECT-only), so the insert
-- below runs as that role. A definer here would be a function PostgreSQL runs
-- for whoever can write the table.
create or replace function public.remember_ended_house_membership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- An orphan access row (no users row; user_restaurant_access.user_id has
  -- no foreign key) cannot be remembered: the FK below would refuse the
  -- insert and, with it, the delete. Account deletion is not affected: it
  -- deletes the access rows first, while the users row still exists, and the
  -- rows written here then go with the users row (ON DELETE CASCADE).
  if not exists (select 1 from public.users u where u.user_id = old.user_id) then
    return null;
  end if;

  insert into public.house_memberships_ended (user_id, restaurant_id, ended_at)
  values (old.user_id, old.restaurant_id, now())
  on conflict (user_id, restaurant_id) do update set ended_at = excluded.ended_at;

  return null;
end
$$;

revoke all on function public.remember_ended_house_membership() from public, anon, authenticated;

drop trigger if exists user_restaurant_access_end_is_remembered on public.user_restaurant_access;
create trigger user_restaurant_access_end_is_remembered
  after delete on public.user_restaurant_access
  for each row
  when (old.is_active)
  execute function public.remember_ended_house_membership();

drop trigger if exists user_restaurant_access_deactivation_is_remembered on public.user_restaurant_access;
create trigger user_restaurant_access_deactivation_is_remembered
  after update of is_active on public.user_restaurant_access
  for each row
  when (old.is_active and not new.is_active)
  execute function public.remember_ended_house_membership();

-- Backfill what the database can still prove about memberships that ended
-- before this trigger existed. Insert-only; nothing existing is changed.
--
-- 1. A membership row that is already inactive.
insert into public.house_memberships_ended (user_id, restaurant_id, ended_at)
select ura.user_id, ura.restaurant_id, coalesce(ura.deactivated_at, now())
from public.user_restaurant_access ura
where ura.is_active = false
  and exists (select 1 from public.users u where u.user_id = ura.user_id)
on conflict (user_id, restaurant_id) do nothing;

-- 2. An invitation the person accepted, to a house they are no longer an
--    active member of. Acceptance stamps used_at and used_by_email
--    (auth.service.ts acceptInvite / joinViaInvite) and a failed join
--    un-stamps it, so a stamped invite is a membership that once existed.
insert into public.house_memberships_ended (user_id, restaurant_id, ended_at)
select distinct on (u.user_id, oi.restaurant_id)
       u.user_id, oi.restaurant_id, oi.used_at
from public.organization_invites oi
join public.users u on lower(u.email) = lower(oi.used_by_email)
where oi.used_at is not null
  and not exists (
    select 1 from public.user_restaurant_access ura
    where ura.user_id = u.user_id
      and ura.restaurant_id = oi.restaurant_id
      and ura.is_active
  )
order by u.user_id, oi.restaurant_id, oi.used_at desc
on conflict (user_id, restaurant_id) do nothing;
