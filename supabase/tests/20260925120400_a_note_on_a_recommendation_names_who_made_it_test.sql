-- ADR 0191 round 5, answer 2 (the founder, 2026-09-22, "Gate like acts"):
-- pinned_by, rated_by and assigned_by name who made a note. Migration
-- 20260925120400.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` or the PGlite harness stops
-- at the first one. Run it on a database built from supabase/migrations. It
-- must FAIL on a build without 20260925120400 (the columns do not exist) and
-- PASS with it. One transaction, rolled back: it leaves nothing behind.

begin;

insert into public.restaurants (id, name, slug) values
  ('b1000000-0000-4000-8000-000000000001', 'Note house', 'note-house-r5');
insert into public.users (user_id, email, name, restaurant_id, role) values
  ('b2000000-0000-4000-8000-000000000001', 'r5-staff-a@x.test', 'R5 staff A',
   'b1000000-0000-4000-8000-000000000001', 'staff'),
  ('b2000000-0000-4000-8000-000000000002', 'r5-staff-b@x.test', 'R5 staff B',
   'b1000000-0000-4000-8000-000000000001', 'staff'),
  ('b2000000-0000-4000-8000-000000000003', 'r5-owner@x.test', 'R5 owner',
   'b1000000-0000-4000-8000-000000000001', 'owner');

-- T1 the three columns exist, are nullable, and default to NULL.
insert into public.recommendation_actions (restaurant_id, rule_key)
values ('b1000000-0000-4000-8000-000000000001', 'vendor_concentration#*#fire:month:2026-09');

do $$
declare
  r record;
begin
  select pinned_by, rated_by, assigned_by into r
    from public.recommendation_actions
   where restaurant_id = 'b1000000-0000-4000-8000-000000000001'
     and rule_key = 'vendor_concentration#*#fire:month:2026-09';
  assert r.pinned_by is null, 'T1 FAIL pinned_by is not NULL by default';
  assert r.rated_by is null, 'T1 FAIL rated_by is not NULL by default';
  assert r.assigned_by is null, 'T1 FAIL assigned_by is not NULL by default';
end $$;

-- T2 each column can hold an actor id (the gateway's write path — proved
-- server-side by recommendation-round5.spec.ts; this proves the column
-- itself accepts and returns one).
do $$ begin
  update public.recommendation_actions
     set pinned = true, pinned_by = 'b2000000-0000-4000-8000-000000000001',
         feedback = 'helpful', rated_by = 'b2000000-0000-4000-8000-000000000002',
         assigned_to = 'b2000000-0000-4000-8000-000000000003',
         assigned_by = 'b2000000-0000-4000-8000-000000000003'
   where restaurant_id = 'b1000000-0000-4000-8000-000000000001'
     and rule_key = 'vendor_concentration#*#fire:month:2026-09';
  perform 1 from public.recommendation_actions
   where restaurant_id = 'b1000000-0000-4000-8000-000000000001'
     and rule_key = 'vendor_concentration#*#fire:month:2026-09'
     and pinned_by = 'b2000000-0000-4000-8000-000000000001'
     and rated_by = 'b2000000-0000-4000-8000-000000000002'
     and assigned_by = 'b2000000-0000-4000-8000-000000000003';
  assert found, 'T2 FAIL the three author columns did not hold their values';
end $$;

-- T3 a deleted person's name leaves every note column they authored (ON
-- DELETE SET NULL), the same rule the history gives actor_id.
do $$
declare
  r record;
begin
  delete from public.users where user_id = 'b2000000-0000-4000-8000-000000000001';
  select pinned_by, rated_by, assigned_by into r
    from public.recommendation_actions
   where restaurant_id = 'b1000000-0000-4000-8000-000000000001'
     and rule_key = 'vendor_concentration#*#fire:month:2026-09';
  assert r.pinned_by is null, 'T3 FAIL a deleted pinner''s name outlived them';
  -- The other two, untouched by that deletion, are unaffected.
  assert r.rated_by = 'b2000000-0000-4000-8000-000000000002',
    'T3 FAIL an unrelated column moved on someone else''s deletion';
  assert r.assigned_by = 'b2000000-0000-4000-8000-000000000003',
    'T3 FAIL an unrelated column moved on someone else''s deletion';
end $$;

-- T4 none of the three is NOT NULL — additive, no backfill required.
do $$ begin
  assert not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'recommendation_actions'
       and column_name in ('pinned_by', 'rated_by', 'assigned_by')
       and is_nullable = 'NO'
  ), 'T4 FAIL a note-author column is NOT NULL';
end $$;

-- T5 each references public.users(user_id), not auth.users — a foreign key
-- to a nonexistent user is refused.
do $$ begin
  begin
    update public.recommendation_actions
       set pinned_by = 'ffffffff-0000-4000-8000-000000000000'
     where restaurant_id = 'b1000000-0000-4000-8000-000000000001';
    assert false, 'T5 FAIL pinned_by accepted a user id that does not exist';
  exception when foreign_key_violation then
    null; -- expected
  end;
end $$;

rollback;
