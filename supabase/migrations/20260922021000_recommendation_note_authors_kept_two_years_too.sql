-- pinned_by, rated_by and assigned_by are kept two years too -- the same
-- sweep that clears created_by.
--
-- WHY
-- ---
-- The founder, 2026-09-22 (ADR 0191 round 6, "Clear them too (Recommended)"):
-- round 5 left this open (answer 3, "History + created_by", named
-- `created_by` only -- `pinned_by`/`rated_by`/`assigned_by` did not exist yet
-- when he was asked, because they are what round 5's OTHER answer, "Gate
-- like acts", introduced in the same round). Asked again now that they do,
-- he took the recommended option, verbatim as relayed: the SAME two-year
-- sweep that clears `created_by` ALSO clears `pinned_by`, `rated_by` and
-- `assigned_by`. `system_audit_log` keeps its own retention, unchanged --
-- his round-5 words still stand: "an audit trail that forgets who acted is
-- no longer an audit trail".
--
-- WHAT THIS DOES
-- --------------
-- CREATE OR REPLACEs `recommendation_actions_forget_old_creators()`
-- (20260922010001) to ALSO null `pinned_by`, `rated_by` and `assigned_by` on
-- the same rows, on the same clock (`updated_at`), reading the SAME
-- `recommendation_action_history_name_kept_for()` (2 years, defined by
-- 20260921171100). One function, one daily call --
-- `RecommendationHistoryRetention.sweep()` already calls it; no gateway code
-- changes. The function's NAME is unchanged, so the gateway's
-- `FORGET_OLD_CREATORS_RPC` constant still names it and every existing
-- caller keeps working unmodified.
--
-- The WHERE clause widens from "created_by is not null" to "any of the four
-- is not null", so a row whose `created_by` is already null (cleared by the
-- round-5 version of this function, or never set) but still names a note's
-- author is still counted and cleared -- the round-5 WHERE would have
-- silently skipped such a row forever, because nothing else ever sets
-- `created_by` back to non-null.
--
-- THE GATE NEEDS NO CODE CHANGE. `mayTouchNote` (`item-state.ts`, round 5)
-- already reads a SET note field with no recorded author as not provably
-- anyone's, and fails closed to owner/manager -- the exact reading round 5
-- gave a note made before the author columns existed. It does not, and
-- cannot, distinguish "never recorded" from "recorded, then cleared by this
-- sweep": both are simply `owner: null` on a set field. So once this
-- function has run past a note's two years, the existing gate already does
-- what the founder asked -- proven directly at
-- apps/api-gateway/src/analytics/recommendation-round6.spec.ts.
--
-- 20260922010001 ITSELF IS UNCHANGED by this migration -- this file only
-- CREATE OR REPLACEs the function it defined, the same move 20260922010001
-- made on 20260921171100's shared period function. Its own claim
-- (ADR-0191-R5-CREATED-BY-KEPT-TWO-YEARS, whose text said these three
-- columns are "deliberately NOT cleared by this sweep") is corrected in
-- place, bracketed, in the ADR and in CLAIMS.jsonl -- not rewritten, and its
-- `verify` is untouched, because it is still true of that one file.
--
-- Additive and re-runnable: CREATE OR REPLACE, grants re-stated. No RLS or
-- trigger change: `recommendation_actions` is not append-only (unlike the
-- history table), so clearing four columns is still an ordinary UPDATE.

create or replace function public.recommendation_actions_forget_old_creators()
returns integer
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  forgotten integer;
begin
  update public.recommendation_actions
     set created_by = null,
         pinned_by = null,
         rated_by = null,
         assigned_by = null
   where (created_by is not null
          or pinned_by is not null
          or rated_by is not null
          or assigned_by is not null)
     and updated_at < now() - public.recommendation_action_history_name_kept_for();
  get diagnostics forgotten = row_count;
  return forgotten;
end
$function$;

comment on function public.recommendation_actions_forget_old_creators() is
  'Clears created_by, pinned_by, rated_by and assigned_by on every recommendation_actions row whose updated_at is older than recommendation_action_history_name_kept_for() (2 years). Returns how many rows it touched -- 0 is a real answer. Run daily by the gateway alongside recommendation_action_history_forget_old_names() (ADR 0191 round 6, founder 2026-09-22: "Clear them too"). system_audit_log keeps its own retention. Service role only.';

revoke all on function public.recommendation_actions_forget_old_creators() from public;
revoke all on function public.recommendation_actions_forget_old_creators() from anon, authenticated;
grant execute on function public.recommendation_actions_forget_old_creators() to service_role;

-- Said, not assumed: only the service role may run it, and the widened body
-- really does null all four columns -- read the function's own definition
-- back rather than trust the CREATE OR REPLACE landed as written.
do $$
declare
  fn_def text;
begin
  if has_function_privilege('authenticated', 'public.recommendation_actions_forget_old_creators()', 'EXECUTE')
     or has_function_privilege('anon', 'public.recommendation_actions_forget_old_creators()', 'EXECUTE') then
    raise exception 'recommendation_actions_forget_old_creators is callable by anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.recommendation_actions_forget_old_creators()', 'EXECUTE') then
    raise exception 'recommendation_actions_forget_old_creators is not callable by service_role';
  end if;
  fn_def := pg_get_functiondef('public.recommendation_actions_forget_old_creators()'::regprocedure);
  if fn_def not ilike '%pinned_by = null%'
     or fn_def not ilike '%rated_by = null%'
     or fn_def not ilike '%assigned_by = null%'
     or fn_def not ilike '%created_by = null%'
  then
    raise exception 'recommendation_actions_forget_old_creators no longer clears all four author columns';
  end if;
end
$$;
