-- A note on a recommendation names who made it.
--
-- WHY
-- ---
-- The founder, 2026-09-22 (ADR 0191 round 5, answer 2, "Gate like acts"): a
-- note (pin, rating, assignment) is gated the way an act is -- the platform
-- admin never makes one; staff change or clear only their own; an owner or
-- manager changes or clears anyone's; every note change is audited.
--
-- `recommendation_actions.created_by` cannot answer "whose note is this": one
-- row holds three notes plus the status act, and every write to ANY of them
-- overwrites the same column (round 4's own "Options considered", #1,
-- rejected exactly this for acts, for exactly this reason). A pin from staff
-- A, then a rating from an owner, would leave `created_by` naming the owner
-- -- and staff A would lose the right to unpin their own pin, having made no
-- change of their own.
--
-- So each note gets its own author column, set on every write to that field
-- and read by nothing else:
--
--   pinned_by     who last set `pinned` (true or false)
--   rated_by      who last set `feedback`
--   assigned_by   who last set `assigned_to` (or `assigned_name` alone) --
--                 distinct from `assigned_to` itself, which is who the card
--                 is assigned TO, not who assigned it
--
-- Additive: three nullable columns, no default, no backfill. Every row
-- written before this migration has all three NULL -- a note nobody can
-- name, the same shape round 4 gave an act with no history row. The gate in
-- the gateway (`insights/item-state.ts` `mayTouchNote`,
-- `recommendation-actions.service.ts` `assertMayTouchNotes`) reads a NULL
-- author on a SET field as not provably anyone's, so only an owner or
-- manager may change or clear it -- fails closed, the same reading round 4
-- gave a pre-history act (consequences: "a small one-time set").
--
-- `public.users(user_id)`, not `auth.users` -- the JWT's actor id, the same
-- table `recommendation_action_history.actor_id` references (20260921170400,
-- see that migration for why the two tables are disjoint in production). ON
-- DELETE SET NULL: a deleted person's name leaves a note the same way it
-- leaves the history.
--
-- Additive and re-runnable. No RLS change: `recommendation_actions` already
-- has RLS, service-role only (20260805000000 baseline), and these are
-- ordinary columns on it -- no new grant is needed or made.

alter table public.recommendation_actions
  add column if not exists pinned_by uuid references public.users(user_id) on delete set null,
  add column if not exists rated_by uuid references public.users(user_id) on delete set null,
  add column if not exists assigned_by uuid references public.users(user_id) on delete set null;

comment on column public.recommendation_actions.pinned_by is
  'public.users.user_id of whoever last set `pinned` (ADR 0191 round 5, founder 2026-09-22). NULL: nobody recorded, or a row from before this column -- gated as unowned (owner/manager only to change or clear).';
comment on column public.recommendation_actions.rated_by is
  'public.users.user_id of whoever last set `feedback` (ADR 0191 round 5). Same NULL reading as pinned_by.';
comment on column public.recommendation_actions.assigned_by is
  'public.users.user_id of whoever last set `assigned_to` (ADR 0191 round 5). Distinct from `assigned_to` itself, which is who the card is assigned TO. Same NULL reading as pinned_by.';

-- Said, not assumed: the columns exist, are nullable, and reference the
-- right table.
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'recommendation_actions'
         and column_name in ('pinned_by', 'rated_by', 'assigned_by')) <> 3
  then
    raise exception 'recommendation_actions is missing a note-author column';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'recommendation_actions'
       and column_name in ('pinned_by', 'rated_by', 'assigned_by')
       and is_nullable = 'NO'
  ) then
    raise exception 'a note-author column on recommendation_actions is NOT NULL -- must stay additive';
  end if;
  if (select count(*) from information_schema.constraint_column_usage ccu
       join information_schema.table_constraints tc
         on tc.constraint_name = ccu.constraint_name
        and tc.constraint_schema = ccu.constraint_schema
       where tc.table_schema = 'public' and tc.table_name = 'recommendation_actions'
         and tc.constraint_type = 'FOREIGN KEY'
         and ccu.column_name = 'user_id' and ccu.table_name = 'users') < 3
  then
    raise exception 'a note-author column on recommendation_actions does not reference public.users(user_id)';
  end if;
end
$$;
