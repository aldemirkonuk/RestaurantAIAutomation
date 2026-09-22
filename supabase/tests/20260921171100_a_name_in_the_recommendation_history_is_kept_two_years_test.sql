-- ADR 0191 round 4, answer 6 (the founder, 2026-09-21, one of the seven
-- options he took with "Take all seven"): the recommendation action history
-- keeps a person's name for two years; then the name is removed and the act
-- is kept. Migration 20260921171100.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` or the PGlite harness stops
-- at the first one. Run it on a database built from supabase/migrations. It
-- must FAIL on a build without 20260921171100 (the function does not exist)
-- and PASS with it. One transaction, rolled back: it leaves nothing behind.

begin;

insert into public.restaurants (id, name, slug) values
  ('a1000000-0000-4000-8000-000000000001', 'Retention house', 'retention-house-r4');
insert into public.users (user_id, email, name, restaurant_id, role) values
  ('a2000000-0000-4000-8000-000000000001', 'r4-staff@x.test', 'R4 staff',
   'a1000000-0000-4000-8000-000000000001', 'staff'),
  ('a2000000-0000-4000-8000-000000000002', 'r4-owner@x.test', 'R4 owner',
   'a1000000-0000-4000-8000-000000000001', 'owner');

-- Five acts: two past the two years (named), one a day inside them, one
-- yesterday, one past the two years that already names nobody.
insert into public.recommendation_action_history
  (id, restaurant_id, rule_key, act, status_from, status_to, reason,
   snooze_until, rule_wide, actor_id, acted_at)
values
  ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
   'vendor_concentration#*#fire:month:2024-08', 'dismiss', 'active', 'dismissed',
   'not_relevant', null, false, 'a2000000-0000-4000-8000-000000000001',
   now() - interval '2 years 1 day'),
  ('a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001',
   'stockout_imminent#*#fire:day:2023-06-01', 'snooze', null, 'snoozed',
   null, '2023-06-08T00:00:00Z', false, 'a2000000-0000-4000-8000-000000000002',
   now() - interval '3 years'),
  ('a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001',
   'vendor_concentration#*#fire:month:2024-10', 'done', null, 'done',
   null, null, false, 'a2000000-0000-4000-8000-000000000001',
   now() - interval '2 years' + interval '1 day'),
  ('a3000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001',
   'vendor_concentration', 'restore', 'dismissed', 'active',
   null, null, true, 'a2000000-0000-4000-8000-000000000002',
   now() - interval '1 day'),
  ('a3000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001',
   'vendor_concentration#*#fire:month:2021-01', 'done', null, 'done',
   null, null, false, null,
   now() - interval '5 years');

create temp table r4_before on commit drop as
  select * from public.recommendation_action_history
   where restaurant_id = 'a1000000-0000-4000-8000-000000000001';

-- T1 the period is two years, in one place.
do $$ begin
  assert public.recommendation_action_history_name_kept_for() = interval '2 years',
    'T1 FAIL the period is not two years';
end $$;

-- T2 a name younger than two years cannot be removed by hand (a day inside).
do $$ begin
  begin
    update public.recommendation_action_history set actor_id = null
     where id = 'a3000000-0000-4000-8000-000000000003';
    assert false, 'T2 FAIL a name a day inside the two years was removed by hand';
  exception when raise_exception then
    assert sqlerrm like 'recommendation_action_history is append-only%',
      'T2 FAIL refused, but not by the append-only trigger: ' || sqlerrm;
  end;
end $$;

-- T3 on a row past the two years, nothing else may change with the name.
do $$ begin
  begin
    update public.recommendation_action_history
       set actor_id = null, reason = 'disagree'
     where id = 'a3000000-0000-4000-8000-000000000001';
    assert false, 'T3 FAIL an old row''s label changed along with its name';
  exception when raise_exception then
    assert sqlerrm like 'recommendation_action_history is append-only%',
      'T3 FAIL refused, but not by the append-only trigger: ' || sqlerrm;
  end;
end $$;

-- T4 an old row's name cannot be replaced by another name.
do $$ begin
  begin
    update public.recommendation_action_history
       set actor_id = 'a2000000-0000-4000-8000-000000000002'
     where id = 'a3000000-0000-4000-8000-000000000001';
    assert false, 'T4 FAIL an old row''s name was replaced by another';
  exception when raise_exception then
    assert sqlerrm like 'recommendation_action_history is append-only%',
      'T4 FAIL refused, but not by the append-only trigger: ' || sqlerrm;
  end;
end $$;

-- T5 an old row cannot be deleted: the act is kept.
do $$ begin
  begin
    delete from public.recommendation_action_history
     where id = 'a3000000-0000-4000-8000-000000000002';
    assert false, 'T5 FAIL an old act was deleted';
  exception when raise_exception then
    assert sqlerrm like 'recommendation_action_history is append-only%',
      'T5 FAIL refused, but not by the append-only trigger: ' || sqlerrm;
  end;
end $$;

-- T6 the sweep removes every name past the two years and says how many.
do $$
declare
  due integer;
  forgotten integer;
begin
  select count(*) into due from public.recommendation_action_history
   where actor_id is not null
     and acted_at < now() - interval '2 years';
  assert due >= 2, 'T6 FAIL the fixture has fewer than two names due';
  forgotten := public.recommendation_action_history_forget_old_names();
  assert forgotten = due,
    format('T6 FAIL the sweep said %s, %s names were due', forgotten, due);
end $$;

-- T7 the names past the two years are gone; the rest are kept; every act is
-- still there, unchanged but for the name.
do $$
declare
  n integer;
begin
  select count(*) into n from public.recommendation_action_history
   where id in ('a3000000-0000-4000-8000-000000000001',
                'a3000000-0000-4000-8000-000000000002')
     and actor_id is null;
  assert n = 2, 'T7 FAIL a name past the two years is still there';

  select count(*) into n from public.recommendation_action_history
   where id = 'a3000000-0000-4000-8000-000000000003'
     and actor_id = 'a2000000-0000-4000-8000-000000000001';
  assert n = 1, 'T7 FAIL a name a day inside the two years was removed';

  select count(*) into n from public.recommendation_action_history
   where id = 'a3000000-0000-4000-8000-000000000004'
     and actor_id = 'a2000000-0000-4000-8000-000000000002';
  assert n = 1, 'T7 FAIL yesterday''s name was removed';

  select count(*) into n
    from r4_before b
    join public.recommendation_action_history h on h.id = b.id
   where (h.restaurant_id, h.rule_key, h.act, h.status_from, h.status_to,
          h.reason, h.snooze_until, h.rule_wide, h.acted_at)
         is not distinct from
         (b.restaurant_id, b.rule_key, b.act, b.status_from, b.status_to,
          b.reason, b.snooze_until, b.rule_wide, b.acted_at);
  assert n = 5, format('T7 FAIL %s of 5 acts are kept unchanged', n);
end $$;

-- T8 a second run the same day removes nothing, and says 0 (a real answer).
do $$ begin
  assert public.recommendation_action_history_forget_old_names() = 0,
    'T8 FAIL a second run removed names again';
end $$;

-- T9 a foreign key still removes a person's name when their user row goes
-- (round 3), however young the act.
do $$
declare
  n integer;
begin
  delete from public.users where user_id = 'a2000000-0000-4000-8000-000000000002';
  select count(*) into n from public.recommendation_action_history
   where id = 'a3000000-0000-4000-8000-000000000004' and actor_id is null;
  assert n = 1, 'T9 FAIL a deleted person''s name outlived them';
end $$;

-- T10 only the service role runs the sweep.
do $$ begin
  assert not has_function_privilege('anon',
    'public.recommendation_action_history_forget_old_names()', 'EXECUTE'),
    'T10 FAIL anon can run the sweep';
  assert not has_function_privilege('authenticated',
    'public.recommendation_action_history_forget_old_names()', 'EXECUTE'),
    'T10 FAIL authenticated can run the sweep';
  assert has_function_privilege('service_role',
    'public.recommendation_action_history_forget_old_names()', 'EXECUTE'),
    'T10 FAIL the service role cannot run the sweep';
end $$;

rollback;
