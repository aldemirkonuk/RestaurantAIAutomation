-- The first house opens in one transaction (onboarding proposal §3 Phase 1,
-- lane OB-2; §4 F14 "one RPC that takes values TS computed"; audit gap G16).
--
-- AuthService.createFirstHouse used to open a house as about seven PostgREST
-- calls: organizations, restaurants, user_onboarding_progress, then
-- organization_members, user_restaurant_access and the users row in parallel.
-- On a failure its catch ran compensating deletes on restaurants and
-- organizations without reading their errors. A failed access row plus a
-- failed (or never-reached, on a process death) delete left an organization
-- and a restaurant nobody could reach, and if the parallel users update had
-- landed, the retry answered 409 "This account already has a house".
--
-- open_first_house does the same six writes, in the same order, inside the one
-- transaction a function call is. Any error rolls every write back, so there is
-- nothing to compensate for and a retry starts clean.
--
-- It only inserts. The gateway still computes and validates every value (the
-- slug, the place id and its look-up, the coordinates, the zone, the currency,
-- the 409 rule), so SQL and TS cannot drift on those rules (F14 kill attempt,
-- ADR 0265). The error a step raises is the database's own (23505, 23514,
-- 22001, ...), so the gateway's isSharedPlace / refuseHouseOpening read it
-- exactly as they read a PostgREST insert error before.
--
-- The onboarding row is still claimed before the access rows and the users row:
-- its UNIQUE(user_id) is what makes a second, concurrent first house by the
-- same account fail before it touches `users` (F-006 OPEN-6, option b).
--
-- SECURITY INVOKER: the gateway calls it with the service-role key, which
-- already holds every write it makes. No client role may call it.

create or replace function public.open_first_house(
  p_user_id uuid,
  p_organization_name text,
  p_name text,
  p_slug text,
  p_email text,
  p_address jsonb,
  p_city text default null,
  p_country text default null,
  p_state_province text default null,
  p_postal_code text default null,
  p_neighborhood text default null,
  p_phone text default null,
  p_timezone text default null,
  p_currency text default null,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_google_place_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_restaurant uuid;
begin
  insert into public.organizations (name, owner_id)
  values (p_organization_name, p_user_id)
  returning id into v_org;

  insert into public.restaurants (
    name, slug, email, address, city, country, state_province, postal_code,
    neighborhood, phone, timezone, currency, organization_id, latitude,
    longitude, google_place_id
  )
  values (
    p_name, p_slug, p_email, p_address, p_city, p_country, p_state_province,
    p_postal_code, p_neighborhood, p_phone, p_timezone, p_currency, v_org,
    p_latitude, p_longitude, p_google_place_id
  )
  returning id into v_restaurant;

  insert into public.user_onboarding_progress (user_id, restaurant_id)
  values (p_user_id, v_restaurant);

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, p_user_id, 'owner');

  insert into public.user_restaurant_access
    (user_id, restaurant_id, role, invited_via, is_active)
  values (p_user_id, v_restaurant, 'owner', null, true);

  update public.users
     set restaurant_id = v_restaurant, role = 'owner'
   where user_id = p_user_id;
  if not found then
    raise exception 'open_first_house: no users row for the person'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'organization_id', v_org,
    'restaurant_id', v_restaurant
  );
end;
$$;

revoke all on function public.open_first_house(
  uuid, text, text, text, text, jsonb, text, text, text, text, text, text,
  text, text, numeric, numeric, text
) from public;
revoke all on function public.open_first_house(
  uuid, text, text, text, text, jsonb, text, text, text, text, text, text,
  text, text, numeric, numeric, text
) from anon, authenticated;
grant execute on function public.open_first_house(
  uuid, text, text, text, text, jsonb, text, text, text, text, text, text,
  text, text, numeric, numeric, text
) to service_role;
