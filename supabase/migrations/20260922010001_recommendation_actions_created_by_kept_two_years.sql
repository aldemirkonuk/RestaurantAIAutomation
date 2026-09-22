-- recommendation_actions.created_by is kept two years, like the history's names.
--
-- WHY
-- ---
-- The founder, 2026-09-22 (ADR 0191 round 5, answer 3, "History + created_by"):
-- the two-year name rule (round 4, answer 6; migration 20260921171100) reaches
-- `recommendation_actions.created_by` too, on the same job and the same
-- schedule. `system_audit_log` keeps its own retention -- his words: "an
-- audit trail that forgets who acted is no longer an audit trail". That table
-- IS the house's audit trail; `recommendation_actions` is current state, not
-- a trail, so it follows the history's rule instead.
--
-- WHAT THIS DOES
-- --------------
--   recommendation_actions_forget_old_creators()
--       Clears `created_by` on every `recommendation_actions` row whose
--       `updated_at` is older than
--       `recommendation_action_history_name_kept_for()` -- the SAME function
--       20260921171100 defined (2 years), read here rather than restated, so
--       the number still lives in one place. Returns how many it cleared --
--       0 is a real answer, never a failure. Service role only.
--
-- THE CLOCK. `recommendation_actions` is one row per (restaurant, rule_key),
-- upserted -- unlike the history it has no per-event timestamp, only
-- `updated_at`. `RecommendationActionsService.setAction` writes `updated_at`
-- on every write, and writes `created_by` in the SAME upsert whenever the
-- caller has a user id. Every caller does: the write routes sit behind
-- `JwtAuthGuard`, whose `JwtStrategy.validate` always returns the user row's
-- `user_id` -- so even an Act deep-link click (`acted: true` alone, which
-- `assertNamedActor` does not require a person for) names its clicker. For
-- every write the gateway makes today, `created_by` was set exactly when
-- `updated_at` was. A row whose `created_by` was set by older code that
-- bumped `updated_at` without it can be cleared LATE by this clock, never
-- early.
--
-- `pinned_by`, `rated_by` and `assigned_by` (20260922010000) are NOT cleared
-- here. The founder's answer named `created_by` specifically; those three
-- columns did not exist when he was asked. Whether the same rule should reach
-- them is put to him -- not decided by this build (founder_questions).
--
-- Additive and re-runnable: CREATE OR REPLACE, grants re-stated. No trigger
-- change: `recommendation_actions` is not append-only (unlike the history),
-- so clearing `created_by` is an ordinary UPDATE.

create or replace function public.recommendation_actions_forget_old_creators()
returns integer
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  forgotten integer;
begin
  update public.recommendation_actions
     set created_by = null
   where created_by is not null
     and updated_at < now() - public.recommendation_action_history_name_kept_for();
  get diagnostics forgotten = row_count;
  return forgotten;
end
$function$;

comment on function public.recommendation_actions_forget_old_creators() is
  'Clears created_by on every recommendation_actions row whose updated_at is older than recommendation_action_history_name_kept_for() (2 years). Returns how many it cleared -- 0 is a real answer. Run daily by the gateway alongside recommendation_action_history_forget_old_names() (ADR 0191 round 5, founder 2026-09-22: "History + created_by"). Service role only.';

revoke all on function public.recommendation_actions_forget_old_creators() from public;
revoke all on function public.recommendation_actions_forget_old_creators() from anon, authenticated;
grant execute on function public.recommendation_actions_forget_old_creators() to service_role;

-- Said, not assumed: only the service role may run it. `has_function_privilege`
-- reads the grant, not the function's return value, so this never runs the
-- sweep itself.
do $$
begin
  if has_function_privilege('authenticated', 'public.recommendation_actions_forget_old_creators()', 'EXECUTE')
     or has_function_privilege('anon', 'public.recommendation_actions_forget_old_creators()', 'EXECUTE') then
    raise exception 'recommendation_actions_forget_old_creators is callable by anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.recommendation_actions_forget_old_creators()', 'EXECUTE') then
    raise exception 'recommendation_actions_forget_old_creators is not callable by service_role';
  end if;
end
$$;
