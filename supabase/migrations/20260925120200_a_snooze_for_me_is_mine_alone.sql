-- A snooze a person makes for themselves hides the card from them alone.
--
-- WHY
-- ---
-- The founder, 2026-09-21 (ADR 0191 round 3, answer 4), asked who stops
-- seeing a card a staff member snoozes: "Only them". Everyone else keeps
-- seeing it; it is not written to the house history; "Not now" in the
-- dismiss list becomes this same snooze. Snooze for everyone stays with
-- owners and managers (and area leads in their area, once that lane lands).
--
-- `recommendation_actions` is the HOUSE's state -- one row per key, read by
-- every surface, the digest and the MCP reader. A per-person snooze written
-- there would hide the card from the house, which is exactly what the answer
-- rules out. So it is its own small table, read only where a named person is
-- looking (their feed, their catalogue, their rails and Reports).
--
-- WHAT A ROW HOLDS -- the minimum (KVKK)
-- --------------------------------------
--   the house, the person (public.users(user_id) -- the JWT's user; NOT
--   auth.users, which is disjoint from it in production), the card's key,
--   until when, and the card's own words so the person's Snoozed leaf can
--   show what they put away. No reason, and nothing another person can read:
--   the gateway reads a person's rows only for that person.
--
-- A row is deleted when the person wakes the card, when it has ended (the
-- gateway clears ended rows on the person's next snooze), and with the
-- person (ON DELETE CASCADE on user_id) or the house.
--
-- Additive and re-runnable. RLS on, service role only; anon and
-- authenticated have no grant.

create table if not exists public.recommendation_personal_snoozes (
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  user_id uuid not null
    references public.users(user_id) on delete cascade,
  rule_key text not null check (length(btrim(rule_key)) > 0),
  snooze_until timestamptz not null,
  observation text,
  recommendation text,
  category text,
  urgency text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, user_id, rule_key)
);

create index if not exists idx_rps_person_until
  on public.recommendation_personal_snoozes (restaurant_id, user_id, snooze_until);

comment on table public.recommendation_personal_snoozes is
  'A card one person snoozed for themselves: hidden from them alone until snooze_until, shown to everyone else, never in the house state or its history (ADR 0191 round 3, founder 2026-09-21: "Only them"). The minimum: no reason, deleted when woken, ended, or with the person.';

alter table public.recommendation_personal_snoozes enable row level security;
drop policy if exists recommendation_personal_snoozes_service_role
  on public.recommendation_personal_snoozes;
create policy recommendation_personal_snoozes_service_role
  on public.recommendation_personal_snoozes
  for all to service_role using (true) with check (true);
revoke all on public.recommendation_personal_snoozes from anon, authenticated;

do $$
begin
  if not (select relrowsecurity from pg_class
          where oid = 'public.recommendation_personal_snoozes'::regclass) then
    raise exception 'recommendation_personal_snoozes has RLS off';
  end if;
  if has_table_privilege('authenticated', 'public.recommendation_personal_snoozes', 'SELECT')
     or has_table_privilege('anon', 'public.recommendation_personal_snoozes', 'SELECT') then
    raise exception 'recommendation_personal_snoozes is still reachable by anon/authenticated';
  end if;
end
$$;
