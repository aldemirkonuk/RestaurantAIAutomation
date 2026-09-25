-- ADR 0191 round 5, answer 3 (the founder, 2026-09-22, "History + created_by"):
-- recommendation_actions.created_by is cleared on the same two-year rule as
-- the history's names. Migration 20260925120500.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` or the PGlite harness stops
-- at the first one. Run it on a database built from supabase/migrations. It
-- must FAIL on a build without 20260925120500 (the function does not exist)
-- and PASS with it. One transaction, rolled back: it leaves nothing behind.

begin;

insert into public.restaurants (id, name, slug) values
  ('c1000000-0000-4000-8000-000000000001', 'Creator house', 'creator-house-r5');
insert into public.users (user_id, email, name, restaurant_id, role) values
  ('c2000000-0000-4000-8000-000000000001', 'r5-staff@x.test', 'R5 staff',
   'c1000000-0000-4000-8000-000000000001', 'staff'),
  ('c2000000-0000-4000-8000-000000000002', 'r5-owner@x.test', 'R5 owner',
   'c1000000-0000-4000-8000-000000000001', 'owner');

-- Four rows: two whose updated_at is past two years (one named, one already
-- NULL — the sweep must not count a row with nothing to clear), one a day
-- inside the two years, one from yesterday.
insert into public.recommendation_actions
  (restaurant_id, rule_key, status, created_by, updated_at)
values
  ('c1000000-0000-4000-8000-000000000001', 'vendor_concentration#*#fire:month:2024-08',
   'dismissed', 'c2000000-0000-4000-8000-000000000001', now() - interval '2 years 1 day'),
  ('c1000000-0000-4000-8000-000000000001', 'stockout_imminent#*#fire:day:2023-06-01',
   'done', null, now() - interval '3 years'),
  ('c1000000-0000-4000-8000-000000000001', 'vendor_concentration#*#fire:month:2024-10',
   'dismissed', 'c2000000-0000-4000-8000-000000000002', now() - interval '2 years' + interval '1 day'),
  ('c1000000-0000-4000-8000-000000000001', 'insight:overall.revenue.vs_same_weekday',
   'active', 'c2000000-0000-4000-8000-000000000001', now() - interval '1 day');

create temp table r5_before on commit drop as
  select rule_key, status, reason, snooze_until, pinned, feedback, assigned_to
    from public.recommendation_actions
   where restaurant_id = 'c1000000-0000-4000-8000-000000000001';

-- T1 the function reads the SAME period the history uses — one place.
do $$ begin
  assert public.recommendation_action_history_name_kept_for() = interval '2 years',
    'T1 FAIL the shared period is not two years';
end $$;

-- T2 the sweep clears created_by past two years and says how many —
-- counting only rows that actually had one to clear.
do $$
declare
  due integer;
  forgotten integer;
begin
  select count(*) into due from public.recommendation_actions
   where restaurant_id = 'c1000000-0000-4000-8000-000000000001'
     and created_by is not null
     and updated_at < now() - interval '2 years';
  assert due = 1, format('T2 FAIL the fixture has %s rows due, expected 1', due);
  forgotten := public.recommendation_actions_forget_old_creators();
  assert forgotten >= due,
    format('T2 FAIL the sweep said %s, at least %s were due', forgotten, due);
end $$;

-- T3 the old named row is cleared; the already-NULL old row is untouched;
-- the day-inside and yesterday rows keep their names; nothing else on any
-- row moved.
do $$
declare
  n integer;
begin
  select count(*) into n from public.recommendation_actions
   where restaurant_id = 'c1000000-0000-4000-8000-000000000001'
     and rule_key = 'vendor_concentration#*#fire:month:2024-08'
     and created_by is null;
  assert n = 1, 'T3 FAIL the row past two years still names its creator';

  select count(*) into n from public.recommendation_actions
   where restaurant_id = 'c1000000-0000-4000-8000-000000000001'
     and rule_key = 'vendor_concentration#*#fire:month:2024-10'
     and created_by = 'c2000000-0000-4000-8000-000000000002';
  assert n = 1, 'T3 FAIL a name a day inside the two years was cleared';

  select count(*) into n from public.recommendation_actions
   where restaurant_id = 'c1000000-0000-4000-8000-000000000001'
     and rule_key = 'insight:overall.revenue.vs_same_weekday'
     and created_by = 'c2000000-0000-4000-8000-000000000001';
  assert n = 1, 'T3 FAIL yesterday''s name was cleared';

  select count(*) into n
    from r5_before b
    join public.recommendation_actions a
      on a.restaurant_id = 'c1000000-0000-4000-8000-000000000001'
     and a.rule_key = b.rule_key
   where (a.status, a.reason, a.snooze_until, a.pinned, a.feedback, a.assigned_to)
         is not distinct from
         (b.status, b.reason, b.snooze_until, b.pinned, b.feedback, b.assigned_to);
  assert n = 4, format('T3 FAIL %s of 4 rows are unchanged but for created_by', n);
end $$;

-- T4 a second run the same day clears nothing more, and says 0.
do $$ begin
  assert public.recommendation_actions_forget_old_creators() = 0,
    'T4 FAIL a second run cleared created_by again';
end $$;

-- T5 only the service role runs the sweep.
do $$ begin
  assert not has_function_privilege('anon',
    'public.recommendation_actions_forget_old_creators()', 'EXECUTE'),
    'T5 FAIL anon can run the sweep';
  assert not has_function_privilege('authenticated',
    'public.recommendation_actions_forget_old_creators()', 'EXECUTE'),
    'T5 FAIL authenticated can run the sweep';
  assert has_function_privilege('service_role',
    'public.recommendation_actions_forget_old_creators()', 'EXECUTE'),
    'T5 FAIL the service role cannot run the sweep';
end $$;

-- T6 recommendation_actions is not append-only — an ordinary UPDATE, no
-- special trigger needed (unlike the history table).
do $$ begin
  assert not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.recommendation_actions'::regclass
       and not tgisinternal
  ), 'T6 FAIL recommendation_actions grew a trigger it should not need';
end $$;

rollback;
