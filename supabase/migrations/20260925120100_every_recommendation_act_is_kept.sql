-- Every dismiss, restore, done and snooze of a recommendation is kept.
--
-- WHY
-- ---
-- The founder, 2026-09-21 (ADR 0191 round 3, answer 2): "Keep every label"
-- -- an append-only history of every dismiss, restore, done and snooze, with
-- its reason label, who and when. The state row may keep the latest; the
-- history is the record.
--
-- `recommendation_actions` is one row per (restaurant, key), upserted. A
-- restore followed by a re-dismissal overwrote the first label, and
-- `created_by` names whoever acted last. That is the current state, which is
-- what the shared per-item state needs -- and it is not a record of anything.
--
-- WHAT A ROW HOLDS
-- ----------------
--   act           dismiss | restore | done | snooze -- the founder's words
--   status_from   what the act lifted or replaced (NULL: the key had no row)
--   status_to     the state it wrote (active | dismissed | done | snoozed)
--   reason        the dismissal label, on a dismiss and only on a dismiss --
--                 the closed set the gateway enforces (not_relevant |
--                 disagree). "Already handled" is recorded as done and "Not
--                 now" as the person's own snooze (round 3, answers 3 and 4),
--                 so neither is ever a label here.
--   snooze_until  the instant, on a snooze for everyone and only on one
--   rule_wide     whether the key silences a whole rule or catalogue type
--                 (no subject and no period) -- the owner/manager act
--   actor_id      public.users(user_id), the JWT's user. NOT auth.users: the
--                 two tables are disjoint in production and the token carries
--                 public.users.user_id. ON DELETE SET NULL: when a person's
--                 user row is deleted their name leaves the history (KVKK:
--                 the minimum, and nothing kept past the person).
--   acted_at
--
-- NOT HERE: a person's own snooze. The founder (answer 4, "Only them"): a
-- staff snooze hides the card from that person alone and is not written to
-- the house history. It has its own table, 20260925120200.
--
-- APPEND-ONLY, ENFORCED
-- ---------------------
-- A trigger refuses UPDATE and DELETE -- the pattern of 20260906030000 (the
-- identity decision log). Two changes pass, and only when Postgres itself
-- makes them through a foreign key:
--   * a person's user row is deleted: actor_id is set to NULL, nothing else;
--   * a house is deleted: its history goes with it (ON DELETE CASCADE).
-- A referential action runs one trigger level down (the foreign key's own
-- trigger issues it), so `pg_trigger_depth() > 1` tells it apart from a
-- statement anyone -- the service role included -- sends directly. Unlike
-- 20260906030000, whose SET NULL actor would be refused by its own trigger.
--
-- Additive and re-runnable. RLS on, service role only; anon and
-- authenticated have no grant. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

create table if not exists public.recommendation_action_history (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  rule_key text not null check (length(btrim(rule_key)) > 0),
  act text not null check (act in ('dismiss', 'restore', 'done', 'snooze')),
  -- Whatever the state row held, unchecked: a record of what was there is
  -- not the place to refuse a value an older writer left behind.
  status_from text,
  status_to text not null
    check (status_to in ('active', 'dismissed', 'snoozed', 'done')),
  reason text check (reason in ('not_relevant', 'disagree')),
  snooze_until timestamptz,
  rule_wide boolean not null,
  actor_id uuid references public.users(user_id) on delete set null,
  acted_at timestamptz not null default now(),
  -- The act and the state it wrote are one fact, said twice; they must agree.
  constraint rah_act_matches_status check (
    (act = 'dismiss' and status_to = 'dismissed')
    or (act = 'restore' and status_to = 'active')
    or (act = 'done' and status_to = 'done')
    or (act = 'snooze' and status_to = 'snoozed')
  ),
  -- A label belongs to a dismissal and every dismissal carries one.
  constraint rah_label_is_a_dismissals check ((reason is not null) = (act = 'dismiss')),
  -- An instant belongs to a snooze and every snooze carries one.
  constraint rah_instant_is_a_snoozes check ((snooze_until is not null) = (act = 'snooze'))
);

create index if not exists idx_rah_restaurant_key
  on public.recommendation_action_history (restaurant_id, rule_key, acted_at desc);
create index if not exists idx_rah_restaurant_time
  on public.recommendation_action_history (restaurant_id, acted_at desc);
create index if not exists idx_rah_actor
  on public.recommendation_action_history (actor_id)
  where actor_id is not null;

comment on table public.recommendation_action_history is
  'Append-only: every dismiss, restore, done and snooze of a recommendation or insight item, with its label, who and when (ADR 0191 round 3, founder 2026-09-21: "Keep every label"). recommendation_actions holds the latest state; this is the record. A person''s own snooze is never here.';
comment on column public.recommendation_action_history.status_from is
  'The state the act lifted or replaced, read before the write. NULL when the key had no row.';
comment on column public.recommendation_action_history.actor_id is
  'public.users.user_id of the person who acted (the JWT''s user). Set NULL, by the foreign key only, when that user row is deleted.';

create or replace function public.recommendation_action_history_append_only()
returns trigger
language plpgsql
as $function$
begin
  -- A foreign key's own action runs one trigger level down; a statement sent
  -- to this table directly runs at level 1.
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      return old; -- the house was deleted
    end if;
    -- The person's user row was deleted: their name leaves, nothing else moves.
    if new.actor_id is null
       and old.actor_id is not null
       and (new.id, new.restaurant_id, new.rule_key, new.act, new.status_from,
            new.status_to, new.reason, new.snooze_until, new.rule_wide, new.acted_at)
           is not distinct from
           (old.id, old.restaurant_id, old.rule_key, old.act, old.status_from,
            old.status_to, old.reason, old.snooze_until, old.rule_wide, old.acted_at)
    then
      return new;
    end if;
  end if;
  raise exception
    'recommendation_action_history is append-only: % is not permitted. A restore is a NEW row.',
    tg_op
    using errcode = 'P0001';
end
$function$;

comment on function public.recommendation_action_history_append_only() is
  'Refuses UPDATE and DELETE on the recommendation history, except the two a foreign key makes itself: a deleted user''s actor_id set NULL, and a deleted house''s rows removed. ADR 0191 round 3.';

drop trigger if exists trg_recommendation_action_history_append_only
  on public.recommendation_action_history;
create trigger trg_recommendation_action_history_append_only
  before update or delete on public.recommendation_action_history
  for each row execute function public.recommendation_action_history_append_only();

alter table public.recommendation_action_history enable row level security;
drop policy if exists recommendation_action_history_service_role
  on public.recommendation_action_history;
create policy recommendation_action_history_service_role
  on public.recommendation_action_history
  for all to service_role using (true) with check (true);
revoke all on public.recommendation_action_history from anon, authenticated;

-- Said, not assumed: the lock-down and the trigger are in place.
do $$
begin
  if not (select relrowsecurity from pg_class
          where oid = 'public.recommendation_action_history'::regclass) then
    raise exception 'recommendation_action_history has RLS off';
  end if;
  if not exists (select 1 from pg_trigger
                 where tgrelid = 'public.recommendation_action_history'::regclass
                   and tgname = 'trg_recommendation_action_history_append_only'
                   and not tgisinternal) then
    raise exception 'recommendation_action_history has no append-only trigger';
  end if;
  if has_table_privilege('authenticated', 'public.recommendation_action_history', 'SELECT')
     or has_table_privilege('anon', 'public.recommendation_action_history', 'SELECT') then
    raise exception 'recommendation_action_history is still reachable by anon/authenticated';
  end if;
end
$$;
