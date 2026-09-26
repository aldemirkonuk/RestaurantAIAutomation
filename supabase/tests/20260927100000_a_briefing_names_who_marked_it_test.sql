-- Sketch 122 Q2 (the founder, 2026-09-25, round 5): "Mark as briefed" is
-- undo-after, so its stamp names who made it (`acted_by`), and the two-year
-- sweep forgets that name with the other four. Migration 20260927100000.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` or the PGlite harness stops
-- at the first one. Run it on a database built from supabase/migrations. It
-- must FAIL on a build without 20260927100000 (no acted_by column; the
-- round-6 function leaves it alone) and PASS with it. One transaction,
-- rolled back: it leaves nothing behind.

begin;

insert into public.restaurants (id, name, slug) values
  ('e1000000-0000-4000-8000-000000000001', 'Briefing house', 'briefing-house-q2');
insert into public.users (user_id, email, name, restaurant_id, role) values
  ('e2000000-0000-4000-8000-000000000001', 'q2-staff@x.test', 'Q2 staff',
   'e1000000-0000-4000-8000-000000000001', 'staff');

-- Three rows:
--   B1  past two years, ONLY acted_by set (every other author null) -- the
--       widened WHERE must reach it, or the name outlives its two years.
--   B2  a day inside two years, acted_by set -- must not move.
--   B3  past two years, nothing set -- must not be counted.
insert into public.recommendation_actions
  (restaurant_id, rule_key, status, acted_at, acted_by, updated_at)
values
  ('e1000000-0000-4000-8000-000000000001', 'sales_below_weekday_baseline#Tuesday#fire:day:2024-01-02',
   'active', now() - interval '2 years 2 days', 'e2000000-0000-4000-8000-000000000001',
   now() - interval '2 years 1 day'),
  ('e1000000-0000-4000-8000-000000000001', 'staff_spread#*#fire:week:2024-W40',
   'active', now() - interval '2 years' + interval '2 days', 'e2000000-0000-4000-8000-000000000001',
   now() - interval '2 years' + interval '1 day'),
  ('e1000000-0000-4000-8000-000000000001', 'staff_spread#*#fire:week:2023-W01',
   'active', null, null,
   now() - interval '3 years');

-- T1 the column is there, nullable, and a users FK that sets null.
do $$
declare
  rule text;
begin
  select rc.delete_rule into rule
    from information_schema.referential_constraints rc
    join information_schema.key_column_usage k
      on k.constraint_name = rc.constraint_name
     and k.constraint_schema = rc.constraint_schema
   where k.table_schema = 'public' and k.table_name = 'recommendation_actions'
     and k.column_name = 'acted_by';
  assert rule = 'SET NULL',
    format('T1 FAIL acted_by FK delete rule is %s, expected SET NULL', coalesce(rule, 'absent'));
end $$;

-- T2 the sweep counts exactly the one row due (B1) and clears its acted_by.
do $$
declare
  forgotten integer;
  n integer;
begin
  forgotten := public.recommendation_actions_forget_old_creators();
  -- Other fixtures in the corpus may also be due; count only this house's.
  select count(*) into n from public.recommendation_actions
   where restaurant_id = 'e1000000-0000-4000-8000-000000000001'
     and rule_key = 'sales_below_weekday_baseline#Tuesday#fire:day:2024-01-02'
     and acted_by is null;
  assert n = 1, 'T2 FAIL B1''s acted_by survived the two-year sweep';
  assert forgotten >= 1, format('T2 FAIL the sweep reported %s rows', forgotten);
end $$;

-- T3 the stamp itself (acted_at) is a time, not a name: the sweep leaves it.
do $$
declare
  n integer;
begin
  select count(*) into n from public.recommendation_actions
   where restaurant_id = 'e1000000-0000-4000-8000-000000000001'
     and rule_key = 'sales_below_weekday_baseline#Tuesday#fire:day:2024-01-02'
     and acted_at is not null;
  assert n = 1, 'T3 FAIL the sweep cleared acted_at, which names nobody';
end $$;

-- T4 B2, a day inside two years: acted_by untouched.
do $$
declare
  n integer;
begin
  select count(*) into n from public.recommendation_actions
   where restaurant_id = 'e1000000-0000-4000-8000-000000000001'
     and rule_key = 'staff_spread#*#fire:week:2024-W40'
     and acted_by = 'e2000000-0000-4000-8000-000000000001';
  assert n = 1, 'T4 FAIL a name a day inside the two years was cleared';
end $$;

-- T5 a second call finds nothing of this house's left to clear.
do $$
declare
  n integer;
begin
  perform public.recommendation_actions_forget_old_creators();
  select count(*) into n from public.recommendation_actions
   where restaurant_id = 'e1000000-0000-4000-8000-000000000001'
     and acted_by is not null
     and updated_at < now() - interval '2 years';
  assert n = 0, format('T5 FAIL %s due rows still name who briefed', n);
end $$;

-- T6 deleting the person sets the stamp's author to null, never the row away.
do $$
declare
  n integer;
begin
  delete from public.users where user_id = 'e2000000-0000-4000-8000-000000000001';
  select count(*) into n from public.recommendation_actions
   where restaurant_id = 'e1000000-0000-4000-8000-000000000001'
     and rule_key = 'staff_spread#*#fire:week:2024-W40'
     and acted_by is null and acted_at is not null;
  assert n = 1, 'T6 FAIL deleting the person did not null acted_by (or took the row)';
end $$;

rollback;
