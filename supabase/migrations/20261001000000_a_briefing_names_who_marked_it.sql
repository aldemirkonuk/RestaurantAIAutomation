-- A "briefed" stamp on a recommendation names who made it, so its Undo can
-- be gated like a pin's -- and the name is forgotten on the same two-year
-- clock as every other author column on recommendation_actions.
--
-- WHY
-- ---
-- Sketch 122 Q2 (the founder, 2026-09-25, round 5, "Add all three
-- (Recommended)"): snooze, pin and mark-as-briefed are one tap with Undo and
-- no seal -- an amendment to ADR 0112 F10's closed undo-after list. "Mark as
-- briefed" is the one self-contained act on /recommendations: the tap IS the
-- act, so it is recorded at once (`acted_at`), and its Undo has to take that
-- stamp back.
--
-- Taking a stamp back is a change to somebody's record. ADR 0191 round 5
-- (the founder, 2026-09-22, "Gate like acts") already rules how that is
-- gated for a pin, a rating and an assignment: staff change or clear only
-- their own; owners and managers anyone's; the platform admin none. That
-- rule needs to know whose stamp it is, and `acted_at` alone does not say --
-- `created_by` is overwritten by every later write on the row. Hence
-- `acted_by`, set with `acted_at` and cleared with it, read by the same
-- `mayTouchNote` gate (`insights/item-state.ts`).
--
-- Retention: ADR 0191 round 6 (the founder, 2026-09-22, "Clear them too
-- (Recommended)") put every author column on this table then in existence
-- (`created_by`, `pinned_by`, `rated_by`, `assigned_by`) on the two-year
-- sweep. `acted_by` is the same kind of column -- who last set one field on
-- a card -- so it joins that sweep here. That is this lane's reading of the
-- round-6 rule for a column that did not exist when he answered it, not a
-- separate founder answer; it is stated in ADR 0112's F10 bracket and the PR.
--
-- WHAT THIS DOES
-- --------------
-- 1. Adds `recommendation_actions.acted_by` (nullable, FK to
--    public.users(user_id) ON DELETE SET NULL, like pinned_by).
-- 2. CREATE OR REPLACEs `recommendation_actions_forget_old_creators()`
--    (20260925120600) to ALSO null `acted_by`, on the same rows, on the same
--    clock (`updated_at`, `recommendation_action_history_name_kept_for()`).
--    Name and signature unchanged, so the gateway's daily call
--    (`RecommendationHistoryRetention.sweep()`) needs no change.
--
-- A NULL acted_by on a row whose acted_at IS set (every stamp made before
-- this column, or one whose author the sweep has forgotten) is read by the
-- gate as not provably anyone's, and fails closed to owner/manager -- the
-- reading round 5 gave an author-less pin.
--
-- Additive and re-runnable: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE,
-- grants re-stated. No RLS change (the table's policies are row-level and
-- unchanged); no trigger.

alter table public.recommendation_actions
  add column if not exists acted_by uuid references public.users(user_id) on delete set null;

comment on column public.recommendation_actions.acted_by is
  'public.users.user_id of whoever last stamped `acted_at` (sketch 122 Q2, founder 2026-09-25: "Mark as briefed" is undo-after, ADR 0112 F10). Set and cleared together with acted_at. NULL on a set acted_at: nobody recorded (a stamp from before this column, or forgotten by the two-year sweep) -- gated as unowned, owner/manager only to clear.';

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
         assigned_by = null,
         acted_by = null
   where (created_by is not null
          or pinned_by is not null
          or rated_by is not null
          or assigned_by is not null
          or acted_by is not null)
     and updated_at < now() - public.recommendation_action_history_name_kept_for();
  get diagnostics forgotten = row_count;
  return forgotten;
end
$function$;

comment on function public.recommendation_actions_forget_old_creators() is
  'Clears created_by, pinned_by, rated_by, assigned_by and acted_by on every recommendation_actions row whose updated_at is older than recommendation_action_history_name_kept_for() (2 years). Returns how many rows it touched -- 0 is a real answer. Run daily by the gateway alongside recommendation_action_history_forget_old_names() (ADR 0191 round 6, founder 2026-09-22: "Clear them too"; acted_by added 2026-09-25 for sketch 122 Q2). system_audit_log keeps its own retention. Service role only.';

revoke all on function public.recommendation_actions_forget_old_creators() from public;
revoke all on function public.recommendation_actions_forget_old_creators() from anon, authenticated;
grant execute on function public.recommendation_actions_forget_old_creators() to service_role;

-- Said, not assumed: the column exists, is nullable and references
-- public.users; the function is service-role only and really clears all
-- five author columns -- read back rather than trusted.
do $$
declare
  fn_def text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'recommendation_actions'
       and column_name = 'acted_by' and is_nullable = 'YES'
  ) then
    raise exception 'recommendation_actions.acted_by is missing or NOT NULL -- must be additive';
  end if;
  if not exists (
    select 1
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.conrelid = 'public.recommendation_actions'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.users'::regclass
       and a.attname = 'acted_by'
  ) then
    raise exception 'recommendation_actions.acted_by does not reference public.users(user_id)';
  end if;
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
     or fn_def not ilike '%acted_by = null%'
  then
    raise exception 'recommendation_actions_forget_old_creators no longer clears all five author columns';
  end if;
end
$$;
