-- A name in the recommendation history is kept for two years; the act stays.
--
-- WHY
-- ---
-- The founder, 2026-09-21 (ADR 0191 round 4, answer 6 -- one of the seven
-- options he took with "Take all seven"): the action history keeps people's
-- names for 2 years; then the name is removed, and the act is kept.
--
-- `recommendation_action_history` (20260925120100) names who dismissed,
-- restored, finished or snoozed a card, in `actor_id`. Until now the only
-- way a name left was the person's user row being deleted. Nothing bounded
-- how long a name was kept -- round 3 recorded "there is no retention period
-- yet".
--
-- WHAT THIS DOES
-- --------------
--   recommendation_action_history_name_kept_for()
--       The period, once: two calendar years. The trigger and the sweep both
--       read it, so the number lives in one place.
--
--   recommendation_action_history_append_only()   (replaced)
--       Still refuses every direct UPDATE and DELETE. It now passes ONE more
--       change, at any trigger depth: an UPDATE that only sets `actor_id` to
--       NULL on a row acted on more than two years ago. Everything else on the
--       row -- the act, the key, the label, the instant, when -- must be
--       unchanged. So the most any caller can do through this door is what
--       the retention rule does anyway: forget a name that is due to go. A
--       name younger than two years cannot be removed this way, and a row can
--       never be deleted.
--
--   recommendation_action_history_forget_old_names()
--       The sweep. Removes every name older than two years and returns how
--       many it removed (0 is a real answer, never a failure). Service role
--       only: anon, authenticated and PUBLIC have no EXECUTE.
--
-- REMOVED, NOT PSEUDONYMISED. The founder allowed either. A stable pseudonym
-- (a hash of the user id, say) can be joined back to the person by anyone
-- who can compute it, so under KVKK it is still personal data; NULL keeps the
-- minimum. The consequence, said: after two years the history can no longer
-- tell two acts by one person from acts by two people.
--
-- WHO RUNS IT. The gateway, daily (`RecommendationHistoryRetention.sweep`,
-- 03:45 UTC). If the gateway does not run, nothing removes names -- the
-- trigger only permits the removal, it does not perform it.
--
-- Additive and re-runnable: CREATE OR REPLACE, grants re-stated. No explicit
-- BEGIN/COMMIT: the Supabase CLI wraps each migration file in a transaction.

create or replace function public.recommendation_action_history_name_kept_for()
returns interval
language sql
immutable
as $function$
  select interval '2 years'
$function$;

comment on function public.recommendation_action_history_name_kept_for() is
  'How long a person''s name (actor_id) is kept on a recommendation_action_history row: two years (ADR 0191 round 4, founder 2026-09-21). Read by the append-only trigger and by recommendation_action_history_forget_old_names().';

create or replace function public.recommendation_action_history_append_only()
returns trigger
language plpgsql
as $function$
begin
  -- Two years on, a name leaves and the act stays (ADR 0191 round 4). Only
  -- actor_id may change, only to NULL, only on a row older than the period.
  if tg_op = 'UPDATE'
     and new.actor_id is null
     and old.actor_id is not null
     and old.acted_at < now() - public.recommendation_action_history_name_kept_for()
     and (new.id, new.restaurant_id, new.rule_key, new.act, new.status_from,
          new.status_to, new.reason, new.snooze_until, new.rule_wide, new.acted_at)
         is not distinct from
         (old.id, old.restaurant_id, old.rule_key, old.act, old.status_from,
          old.status_to, old.reason, old.snooze_until, old.rule_wide, old.acted_at)
  then
    return new;
  end if;
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
  'Refuses UPDATE and DELETE on the recommendation history, except: a deleted user''s actor_id set NULL and a deleted house''s rows removed (both by a foreign key, ADR 0191 round 3), and actor_id set NULL on a row older than recommendation_action_history_name_kept_for() (the two-year rule, ADR 0191 round 4).';

create or replace function public.recommendation_action_history_forget_old_names()
returns integer
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  forgotten integer;
begin
  update public.recommendation_action_history
     set actor_id = null
   where actor_id is not null
     and acted_at < now() - public.recommendation_action_history_name_kept_for();
  get diagnostics forgotten = row_count;
  return forgotten;
end
$function$;

comment on function public.recommendation_action_history_forget_old_names() is
  'Removes the name (actor_id) from every recommendation_action_history row acted on more than two years ago; the act is kept. Returns how many names it removed. Run daily by the gateway (ADR 0191 round 4). Service role only.';

revoke all on function public.recommendation_action_history_forget_old_names() from public;
revoke all on function public.recommendation_action_history_forget_old_names() from anon, authenticated;
grant execute on function public.recommendation_action_history_forget_old_names() to service_role;

-- Said, not assumed: the period, the trigger and the lock-down are in place.
do $$
begin
  if public.recommendation_action_history_name_kept_for() <> interval '2 years' then
    raise exception 'recommendation history names are not kept for two years';
  end if;
  if not exists (select 1 from pg_trigger
                 where tgrelid = 'public.recommendation_action_history'::regclass
                   and tgname = 'trg_recommendation_action_history_append_only'
                   and not tgisinternal) then
    raise exception 'recommendation_action_history has no append-only trigger';
  end if;
  if has_function_privilege('authenticated', 'public.recommendation_action_history_forget_old_names()', 'EXECUTE')
     or has_function_privilege('anon', 'public.recommendation_action_history_forget_old_names()', 'EXECUTE') then
    raise exception 'recommendation_action_history_forget_old_names is callable by anon/authenticated';
  end if;
end
$$;
