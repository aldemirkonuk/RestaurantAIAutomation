-- ADR 0215 item 26 (founder, 2026-09-28): a removal mid-shift splits the
-- shift, all of it or none of it. Migration 20261201130000.
--
-- Self-asserting: every block raises on a failure, so `psql -v
-- ON_ERROR_STOP=1 -f` stops at the first one. Run it on a database built
-- from supabase/migrations. It must FAIL on a build without 20261201130000
-- (no release_leaving_shifts) and PASS with it. One transaction, rolled
-- back: it leaves nothing behind.

begin;

insert into public.restaurants (id, name, slug) values
  ('f1000000-0000-4000-8000-000000000001', 'Split house', 'split-house-item-26');
insert into public.schedules (id, restaurant_id, week_start) values
  ('f3000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', '2026-09-21'),
  ('f3000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', '2026-09-28');
-- Person P (the leaving one) and person Q (someone else).
insert into public.shifts
  (id, restaurant_id, schedule_id, member_id, shift_date, start_time, end_time, role, state, note, labor_cost, recorded_break_min)
values
  -- S1 in progress, same week
  ('f4000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001',
   'f2000000-0000-4000-8000-000000000001', '2026-09-22', '09:00', '17:00', 'Server', 'scheduled', 'Patio', 150, null),
  -- S2 not started
  ('f4000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001',
   'f2000000-0000-4000-8000-000000000001', '2026-09-24', '09:00', '17:00', 'Server', 'scheduled', null, 150, null),
  -- S3 overnight Sunday -> Monday, cut after midnight (next week)
  ('f4000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001',
   'f2000000-0000-4000-8000-000000000001', '2026-09-27', '22:00', '04:00', 'Bar', 'scheduled', 'Close', 120, 30),
  -- S4 someone else's
  ('f4000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001',
   'f2000000-0000-4000-8000-000000000002', '2026-09-24', '09:00', '17:00', 'Server', 'scheduled', null, 100, null);

-- T1 a whole plan lands: one opened, two cut, two rests inserted.
do $$
declare r jsonb; n integer; rest record;
begin
  r := public.release_leaving_shifts(
    'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
    '[{"id":"f4000000-0000-4000-8000-000000000002","shift_date":"2026-09-24","start_time":"09:00"}]'::jsonb,
    '[{"id":"f4000000-0000-4000-8000-000000000001",
       "was":{"shift_date":"2026-09-22","start_time":"09:00","end_time":"17:00"},
       "worked":{"end_time":"13:00","recorded_break_min":null,"labor_cost":75},
       "rest":{"shift_date":"2026-09-22","start_time":"13:00","end_time":"17:00","recorded_break_min":null}},
      {"id":"f4000000-0000-4000-8000-000000000003",
       "was":{"shift_date":"2026-09-27","start_time":"22:00","end_time":"04:00"},
       "worked":{"end_time":"01:00","recorded_break_min":null,"labor_cost":55},
       "rest":{"shift_date":"2026-09-28","start_time":"01:00","end_time":"04:00","recorded_break_min":null}}]'::jsonb);
  assert (r->>'opened')::int = 1, 'T1 opened ' || r::text;
  assert (r->>'split')::int = 2, 'T1 split ' || r::text;
  assert jsonb_array_length(r->'rests') = 2, 'T1 rests ' || r::text;

  select count(*) into n from public.shifts
   where id = 'f4000000-0000-4000-8000-000000000002' and member_id is null and state = 'open'
     and shift_type = 'open' and labor_cost is null;
  assert n = 1, 'T1 S2 not opened';

  select count(*) into n from public.shifts
   where id = 'f4000000-0000-4000-8000-000000000001' and member_id = 'f2000000-0000-4000-8000-000000000001'
     and end_time = '13:00' and labor_cost = 75 and state = 'scheduled';
  assert n = 1, 'T1 S1 worked part not cut';

  select * into rest from public.shifts
   where restaurant_id = 'f1000000-0000-4000-8000-000000000001' and member_id is null
     and shift_date = '2026-09-22' and start_time = '13:00';
  assert rest.end_time = '17:00' and rest.role = 'Server' and rest.note = 'Patio'
     and rest.state = 'open' and rest.shift_type = 'open' and rest.labor_cost is null
     and rest.schedule_id = 'f3000000-0000-4000-8000-000000000001', 'T1 S1 rest wrong';

  -- The overnight rest lands on Monday, in Monday's week row.
  select * into rest from public.shifts
   where restaurant_id = 'f1000000-0000-4000-8000-000000000001' and member_id is null
     and shift_date = '2026-09-28' and start_time = '01:00';
  assert rest.end_time = '04:00' and rest.role = 'Bar' and rest.note = 'Close'
     and rest.schedule_id = 'f3000000-0000-4000-8000-000000000002', 'T1 S3 rest wrong';

  select count(*) into n from public.shifts
   where id = 'f4000000-0000-4000-8000-000000000004' and member_id = 'f2000000-0000-4000-8000-000000000002';
  assert n = 1, 'T1 someone else''s shift moved';
end $$;

-- T2 a stale row refuses the whole plan: nothing is opened, cut or added.
do $$
declare before_count integer; after_count integer; n integer;
begin
  insert into public.shifts
    (id, restaurant_id, member_id, shift_date, start_time, end_time, state)
  values
    ('f4000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001',
     'f2000000-0000-4000-8000-000000000001', '2026-10-05', '09:00', '17:00', 'scheduled'),
    ('f4000000-0000-4000-8000-000000000006', 'f1000000-0000-4000-8000-000000000001',
     'f2000000-0000-4000-8000-000000000001', '2026-10-06', '09:00', '17:00', 'scheduled');
  select count(*) into before_count from public.shifts;
  begin
    perform public.release_leaving_shifts(
      'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
      '[{"id":"f4000000-0000-4000-8000-000000000006","shift_date":"2026-10-06","start_time":"09:00"}]'::jsonb,
      -- read as starting 08:00; the row starts 09:00
      '[{"id":"f4000000-0000-4000-8000-000000000005",
         "was":{"shift_date":"2026-10-05","start_time":"08:00","end_time":"17:00"},
         "worked":{"end_time":"12:00","recorded_break_min":null,"labor_cost":40},
         "rest":{"shift_date":"2026-10-05","start_time":"12:00","end_time":"17:00","recorded_break_min":null}}]'::jsonb);
    raise exception 'T2 a stale row did not refuse';
  exception when raise_exception then
    if sqlerrm like 'T2 %' then raise; end if;
  end;
  select count(*) into after_count from public.shifts;
  assert after_count = before_count, 'T2 a rest was inserted';
  select count(*) into n from public.shifts
   where id = 'f4000000-0000-4000-8000-000000000006' and member_id = 'f2000000-0000-4000-8000-000000000001'
     and state = 'scheduled';
  assert n = 1, 'T2 the open half-applied';
end $$;

-- T2b an opened row that became a call-out since it was read refuses too.
do $$
declare n integer;
begin
  update public.shifts set state = 'callout' where id = 'f4000000-0000-4000-8000-000000000006';
  begin
    perform public.release_leaving_shifts(
      'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
      '[{"id":"f4000000-0000-4000-8000-000000000006","shift_date":"2026-10-06","start_time":"09:00"}]'::jsonb,
      '[]'::jsonb);
    raise exception 'T2b a call-out was opened';
  exception when raise_exception then
    if sqlerrm like 'T2b %' then raise; end if;
  end;
  select count(*) into n from public.shifts
   where id = 'f4000000-0000-4000-8000-000000000006' and state = 'callout'
     and member_id = 'f2000000-0000-4000-8000-000000000001';
  assert n = 1, 'T2b the call-out moved';
end $$;

-- T2c a cut row whose END changed since it was read refuses.
do $$
declare n integer;
begin
  begin
    perform public.release_leaving_shifts(
      'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
      '[]'::jsonb,
      '[{"id":"f4000000-0000-4000-8000-000000000005",
         "was":{"shift_date":"2026-10-05","start_time":"09:00","end_time":"16:00"},
         "worked":{"end_time":"12:00","recorded_break_min":null,"labor_cost":40},
         "rest":{"shift_date":"2026-10-05","start_time":"12:00","end_time":"16:00","recorded_break_min":null}}]'::jsonb);
    raise exception 'T2c a stale end did not refuse';
  exception when raise_exception then
    if sqlerrm like 'T2c %' then raise; end if;
  end;
  select count(*) into n from public.shifts
   where id = 'f4000000-0000-4000-8000-000000000005' and end_time = '17:00';
  assert n = 1, 'T2c the row was cut';
end $$;

-- T3 a cut that does not add up refuses.
do $$
begin
  begin
    perform public.release_leaving_shifts(
      'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
      '[]'::jsonb,
      '[{"id":"f4000000-0000-4000-8000-000000000005",
         "was":{"shift_date":"2026-10-05","start_time":"09:00","end_time":"17:00"},
         "worked":{"end_time":"12:00","recorded_break_min":null,"labor_cost":40},
         "rest":{"shift_date":"2026-10-05","start_time":"12:30","end_time":"17:00","recorded_break_min":null}}]'::jsonb);
    raise exception 'T3 an inconsistent cut did not refuse';
  exception when raise_exception then
    if sqlerrm like 'T3 %' then raise; end if;
  end;
end $$;

-- T4 invoker, not definer.
do $$
begin
  assert not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'release_leaving_shifts' and p.prosecdef),
    'T4 release_leaving_shifts is SECURITY DEFINER';
end $$;

rollback;
