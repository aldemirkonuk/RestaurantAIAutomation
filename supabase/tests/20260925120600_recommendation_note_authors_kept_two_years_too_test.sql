-- ADR 0191 round 6 (the founder, 2026-09-22, "Clear them too (Recommended)"):
-- the two-year sweep that clears recommendation_actions.created_by now also
-- clears pinned_by, rated_by and assigned_by. Migration 20260925120600.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` or the PGlite harness stops
-- at the first one. Run it on a database built from supabase/migrations. It
-- must FAIL on a build without 20260925120600 (the round-5 function still
-- leaves pinned_by/rated_by/assigned_by untouched) and PASS with it. One
-- transaction, rolled back: it leaves nothing behind.

begin;

insert into public.restaurants (id, name, slug) values
  ('d1000000-0000-4000-8000-000000000001', 'Note-author house', 'note-author-house-r6');
insert into public.users (user_id, email, name, restaurant_id, role) values
  ('d2000000-0000-4000-8000-000000000001', 'r6-staff@x.test', 'R6 staff',
   'd1000000-0000-4000-8000-000000000001', 'staff'),
  ('d2000000-0000-4000-8000-000000000002', 'r6-owner@x.test', 'R6 owner',
   'd1000000-0000-4000-8000-000000000001', 'owner');

-- Five rows:
--   R1  past two years, created_by AND all three note-authors set -- every
--       one of the four must clear together, in one call.
--   R2  past two years, created_by ALREADY null but pinned_by set -- proves
--       the widened WHERE (round 5's clause alone would have skipped this
--       row forever, because nothing else ever re-sets created_by).
--   R3  a day inside two years, all four set -- none may move.
--   R4  past two years, all four already null -- nothing to clear, and it
--       must not be counted as cleared.
--   R5  past two years, only rated_by set (created_by, pinned_by,
--       assigned_by null) -- proves each column is reached independently,
--       not only when created_by also happens to be set.
insert into public.recommendation_actions
  (restaurant_id, rule_key, status, pinned, feedback, assigned_to,
   created_by, pinned_by, rated_by, assigned_by, updated_at)
values
  ('d1000000-0000-4000-8000-000000000001', 'vendor_concentration#*#fire:month:2024-08',
   'active', true, 'helpful', 'd2000000-0000-4000-8000-000000000001',
   'd2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001',
   'd2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001',
   now() - interval '2 years 1 day'),
  ('d1000000-0000-4000-8000-000000000001', 'stockout_imminent#*#fire:day:2023-06-01',
   'active', true, null, null,
   null, 'd2000000-0000-4000-8000-000000000002', null, null,
   now() - interval '3 years'),
  ('d1000000-0000-4000-8000-000000000001', 'vendor_concentration#*#fire:month:2024-10',
   'dismissed', true, 'helpful', 'd2000000-0000-4000-8000-000000000001',
   'd2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000002',
   'd2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000002',
   now() - interval '2 years' + interval '1 day'),
  ('d1000000-0000-4000-8000-000000000001', 'insight:overall.revenue.vs_same_weekday',
   'active', false, null, null,
   null, null, null, null,
   now() - interval '3 years'),
  ('d1000000-0000-4000-8000-000000000001', 'sales_below_weekday_baseline#*#fire:day:2024-01-01',
   'active', false, 'not helpful', null,
   null, null, 'd2000000-0000-4000-8000-000000000001', null,
   now() - interval '2 years 1 day');

-- The house's audit trail for R1's pin, three years old and naming the staff
-- member who made it. system_audit_log keeps its own retention (the founder,
-- round 5 and again round 6): the sweep must leave this row exactly as it is.
insert into public.system_audit_log
  (actor_type, actor_id, action, entity_type, entity_id, restaurant_id,
   changes, created_at)
values
  ('user', 'd2000000-0000-4000-8000-000000000001', 'recommendation_note_changed',
   'recommendation_note', 'd1000000-0000-4000-8000-000000000001',
   'd1000000-0000-4000-8000-000000000001',
   jsonb_build_object('rule_key', 'vendor_concentration#*#fire:month:2024-08',
     'pinned', jsonb_build_object('from', false, 'to', true, 'from_by', null)),
   now() - interval '3 years');

create temp table r6_audit_before on commit drop as
  select id, actor_type, actor_id, action, entity_type, entity_id,
         restaurant_id, changes, created_at
    from public.system_audit_log;

create temp table r6_before on commit drop as
  select rule_key, status, reason, snooze_until, pinned, feedback, assigned_to
    from public.recommendation_actions
   where restaurant_id = 'd1000000-0000-4000-8000-000000000001';

-- T1 the function reads the SAME period the history uses -- one place, not
-- restated by this round.
do $$ begin
  assert public.recommendation_action_history_name_kept_for() = interval '2 years',
    'T1 FAIL the shared period is not two years';
end $$;

-- T2 the sweep clears all four author columns on every row due, and counts
-- exactly the rows that had something to clear (R1, R2, R5 -- not R4).
do $$
declare
  due integer;
  forgotten integer;
begin
  select count(*) into due from public.recommendation_actions
   where restaurant_id = 'd1000000-0000-4000-8000-000000000001'
     and (created_by is not null or pinned_by is not null
          or rated_by is not null or assigned_by is not null)
     and updated_at < now() - interval '2 years';
  assert due = 3, format('T2 FAIL the fixture has %s rows due, expected 3', due);
  forgotten := public.recommendation_actions_forget_old_creators();
  assert forgotten = due,
    format('T2 FAIL the sweep said %s, expected exactly %s', forgotten, due);
end $$;

-- T3 R1: every one of the four author columns is null after one call.
do $$
declare
  n integer;
begin
  select count(*) into n from public.recommendation_actions
   where restaurant_id = 'd1000000-0000-4000-8000-000000000001'
     and rule_key = 'vendor_concentration#*#fire:month:2024-08'
     and created_by is null and pinned_by is null
     and rated_by is null and assigned_by is null;
  assert n = 1, 'T3 FAIL R1 still names an author on at least one field';
end $$;

-- T4 R2: created_by was already null; pinned_by is cleared anyway -- the
-- widened WHERE, not the old "created_by is not null" clause, caught it.
do $$
declare
  n integer;
begin
  select count(*) into n from public.recommendation_actions
   where restaurant_id = 'd1000000-0000-4000-8000-000000000001'
     and rule_key = 'stockout_imminent#*#fire:day:2023-06-01'
     and pinned_by is null;
  assert n = 1, 'T4 FAIL R2''s pinned_by survived — the widened WHERE did not catch a row whose created_by was already null';
end $$;

-- T5 R3, a day inside two years: nothing moved on any of the four columns.
do $$
declare
  n integer;
begin
  select count(*) into n from public.recommendation_actions
   where restaurant_id = 'd1000000-0000-4000-8000-000000000001'
     and rule_key = 'vendor_concentration#*#fire:month:2024-10'
     and created_by = 'd2000000-0000-4000-8000-000000000002'
     and pinned_by = 'd2000000-0000-4000-8000-000000000002'
     and rated_by = 'd2000000-0000-4000-8000-000000000002'
     and assigned_by = 'd2000000-0000-4000-8000-000000000002';
  assert n = 1, 'T5 FAIL a name a day inside the two years was cleared';
end $$;

-- T6 R5: rated_by alone (no created_by, no pinned_by, no assigned_by) is
-- still reached — each column is checked on its own, not only riding along
-- with created_by.
do $$
declare
  n integer;
begin
  select count(*) into n from public.recommendation_actions
   where restaurant_id = 'd1000000-0000-4000-8000-000000000001'
     and rule_key = 'sales_below_weekday_baseline#*#fire:day:2024-01-01'
     and rated_by is null;
  assert n = 1, 'T6 FAIL R5''s lone rated_by, past two years, was not cleared';
end $$;

-- T7 nothing else on any of the five rows moved -- only the four author
-- columns, never the values or state they name.
do $$
declare
  n integer;
begin
  select count(*) into n
    from r6_before b
    join public.recommendation_actions a
      on a.restaurant_id = 'd1000000-0000-4000-8000-000000000001'
     and a.rule_key = b.rule_key
   where (a.status, a.reason, a.snooze_until, a.pinned, a.feedback, a.assigned_to)
         is not distinct from
         (b.status, b.reason, b.snooze_until, b.pinned, b.feedback, b.assigned_to);
  assert n = 5, format('T7 FAIL %s of 5 rows are unchanged but for the author columns', n);
end $$;

-- T8 a second run the same day clears nothing more, and says 0 — R4's
-- all-null row is never (mis)counted as cleared either.
do $$ begin
  assert public.recommendation_actions_forget_old_creators() = 0,
    'T8 FAIL a second run cleared an author column again';
end $$;

-- T9 only the service role runs the sweep.
do $$ begin
  assert not has_function_privilege('anon',
    'public.recommendation_actions_forget_old_creators()', 'EXECUTE'),
    'T9 FAIL anon can run the sweep';
  assert not has_function_privilege('authenticated',
    'public.recommendation_actions_forget_old_creators()', 'EXECUTE'),
    'T9 FAIL authenticated can run the sweep';
  assert has_function_privilege('service_role',
    'public.recommendation_actions_forget_old_creators()', 'EXECUTE'),
    'T9 FAIL the service role cannot run the sweep';
end $$;

-- T10 the note gate's own reading: once an author column is null, the gate
-- (item-state.ts's mayTouchNote, not SQL) treats that field as unowned and
-- falls closed to owner/manager only. This SQL test can only prove the DATA
-- half — that R1's pinned_by really is null after the sweep, the exact input
-- mayTouchNote(actor, true, owner) reads as "not provably anyone's". The
-- TypeScript half (staff refused, owner allowed, on exactly this input) is
-- proven at apps/api-gateway/src/analytics/recommendation-round6.spec.ts —
-- named here so the two proofs are findable from each other.
do $$
declare
  n integer;
begin
  select count(*) into n from public.recommendation_actions
   where restaurant_id = 'd1000000-0000-4000-8000-000000000001'
     and rule_key = 'vendor_concentration#*#fire:month:2024-08'
     and pinned = true and pinned_by is null;
  assert n = 1, 'T10 FAIL R1 is not left as (pinned: true, pinned_by: null) for the gate to fail closed on';
end $$;

-- T11 recommendation_actions is still not append-only — an ordinary UPDATE,
-- no special trigger needed (unlike the history table).
do $$ begin
  assert not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.recommendation_actions'::regclass
       and not tgisinternal
  ), 'T11 FAIL recommendation_actions grew a trigger it should not need';
end $$;

-- T12 system_audit_log keeps its own retention: after two sweeps, every
-- audit row is still there, byte for byte -- including the three-year-old
-- row that names R1's pinner, whose pinned_by the sweep just cleared.
do $$
declare
  kept integer;
  before_n integer;
  after_n integer;
begin
  select count(*) into before_n from r6_audit_before;
  select count(*) into after_n from public.system_audit_log;
  select count(*) into kept
    from r6_audit_before b
    join public.system_audit_log a on a.id = b.id
   where (a.actor_type, a.actor_id, a.action, a.entity_type, a.entity_id,
          a.restaurant_id, a.changes, a.created_at)
         is not distinct from
         (b.actor_type, b.actor_id, b.action, b.entity_type, b.entity_id,
          b.restaurant_id, b.changes, b.created_at);
  assert before_n >= 1 and after_n = before_n and kept = before_n,
    format('T12 FAIL the sweep touched system_audit_log (%s rows before, %s after, %s unchanged)',
           before_n, after_n, kept);
  assert exists (
    select 1 from public.system_audit_log
     where actor_id = 'd2000000-0000-4000-8000-000000000001'
       and action = 'recommendation_note_changed'
       and created_at < now() - interval '2 years'
  ), 'T12 FAIL the three-year-old audit row no longer names who pinned R1';
end $$;

rollback;
