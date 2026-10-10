-- F-1030: "Copy last week" replaces only the week it read, in one
-- transaction that holds the week. Migration 20270104800000.
--
-- Self-asserting: every block raises on a failure, so `psql -v
-- ON_ERROR_STOP=1 -f` stops at the first one. Run it on a database built
-- from supabase/migrations. It must FAIL on a build without 20270104800000
-- (no replace_week_shifts) and PASS with it. T1-T4 run in one transaction,
-- rolled back; T5 needs dblink and commits its own rows, then removes them.

begin;

insert into public.restaurants (id, name, slug) values
  ('f1030000-0000-4000-8000-000000000001', 'Copy house', 'copy-house-f1030');
insert into public.schedules (id, restaurant_id, week_start) values
  ('f1030000-0000-4000-8000-0000000000a1', 'f1030000-0000-4000-8000-000000000001', '2026-09-07');
insert into public.shifts
  (id, restaurant_id, schedule_id, member_id, shift_date, start_time, end_time, role, shift_type, state)
values
  ('f1030000-0000-4000-8000-0000000000b1', 'f1030000-0000-4000-8000-000000000001',
   'f1030000-0000-4000-8000-0000000000a1', null, '2026-09-08', '09:00', '17:00', 'line', 'am', 'open');

-- T1 the week is not the week read (a shift arrived after the read): 40001,
-- and nothing changed.
do $$
begin
  begin
    perform public.replace_week_shifts(
      'f1030000-0000-4000-8000-000000000001', 'f1030000-0000-4000-8000-0000000000a1', '2026-09-07',
      '[]'::jsonb, '[]'::jsonb,
      '[{"shift_date":"2026-09-09","start_time":"10:00","end_time":"18:00","state":"scheduled","shift_type":"am"}]'::jsonb);
    raise exception 'T1 a copy over a week that changed since it was read went through';
  exception when serialization_failure then null;
  end;
  if (select count(*) from public.shifts where restaurant_id = 'f1030000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'T1 a refused copy changed the week';
  end if;
end $$;

-- T2 the week as read: the one in the way goes, the copy arrives with this
-- house and schedule forced on it.
do $$
declare r jsonb;
begin
  r := public.replace_week_shifts(
    'f1030000-0000-4000-8000-000000000001', 'f1030000-0000-4000-8000-0000000000a1', '2026-09-07',
    '["f1030000-0000-4000-8000-0000000000b1"]'::jsonb,
    '["f1030000-0000-4000-8000-0000000000b1"]'::jsonb,
    '[{"restaurant_id":"00000000-0000-4000-8000-000000000000","shift_date":"2026-09-09","start_time":"10:00","end_time":"18:00","state":"scheduled","shift_type":"am","recorded_break_min":30,"labor_cost":120.5},
      {"shift_date":"2026-09-10","start_time":"10:00","end_time":"14:00"}]'::jsonb);
  if r <> '{"copied": 2, "deleted": 1}'::jsonb then
    raise exception 'T2 replace said %', r;
  end if;
  if exists (select 1 from public.shifts where id = 'f1030000-0000-4000-8000-0000000000b1') then
    raise exception 'T2 the shift in the way is still there';
  end if;
  if (select count(*) from public.shifts
       where restaurant_id = 'f1030000-0000-4000-8000-000000000001'
         and schedule_id = 'f1030000-0000-4000-8000-0000000000a1') <> 2 then
    raise exception 'T2 the copy did not land on this house and schedule';
  end if;
  if not exists (select 1 from public.shifts where shift_date = '2026-09-09'
                   and recorded_break_min = 30 and labor_cost = 120.5
                   and restaurant_id = 'f1030000-0000-4000-8000-000000000001') then
    raise exception 'T2 the copy lost its break or its cost';
  end if;
end $$;

-- T3 a second copy made from the same read: refused, nothing doubled.
do $$
begin
  begin
    perform public.replace_week_shifts(
      'f1030000-0000-4000-8000-000000000001', 'f1030000-0000-4000-8000-0000000000a1', '2026-09-07',
      '["f1030000-0000-4000-8000-0000000000b1"]'::jsonb,
      '["f1030000-0000-4000-8000-0000000000b1"]'::jsonb,
      '[{"shift_date":"2026-09-09","start_time":"10:00","end_time":"18:00"}]'::jsonb);
    raise exception 'T3 a second copy from the same read went through';
  exception when serialization_failure then null;
  end;
  if (select count(*) from public.shifts where restaurant_id = 'f1030000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'T3 the week was doubled or emptied';
  end if;
end $$;

-- T4 another house's week, or a week that is not this Monday: refused.
do $$
begin
  begin
    perform public.replace_week_shifts(
      'f1030000-0000-4000-8000-000000000001', 'f1030000-0000-4000-8000-0000000000a1', '2026-09-14',
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
    raise exception 'T4 a schedule was taken for a week it is not';
  exception when raise_exception then
    if sqlerrm not like 'replace_week_shifts: no such week%' then raise; end if;
  end;
end $$;

rollback;

-- T5 TWO SESSIONS: two copies of the same empty week, read at the same time.
-- The first holds the week; the second waits, then sees the first one's rows
-- and is refused (40001). Without the lock both would land.
create extension if not exists dblink;
do $$
declare
  conn text := 'dbname=' || current_database() || ' user=' || current_user;
  err  text;
  n    integer;
begin
  perform dblink_connect('f1030a', conn);
  perform dblink_connect('f1030b', conn);
  perform dblink_exec('f1030a', $f$
    insert into public.restaurants (id, name, slug) values
      ('f1030000-0000-4000-8000-000000000002', 'Copy house two', 'copy-house-two-f1030');
    insert into public.schedules (id, restaurant_id, week_start) values
      ('f1030000-0000-4000-8000-0000000000a2', 'f1030000-0000-4000-8000-000000000002', '2026-09-07');
  $f$);
  perform dblink_exec('f1030a', 'begin');
  perform x from dblink('f1030a', $f$select public.replace_week_shifts(
    'f1030000-0000-4000-8000-000000000002', 'f1030000-0000-4000-8000-0000000000a2', '2026-09-07',
    '[]', '[]', '[{"shift_date":"2026-09-08","start_time":"09:00","end_time":"17:00"}]')::text$f$) as t(x text);
  -- The second copy, sent while the first is open, waits on the week.
  perform dblink_send_query('f1030b', $f$select public.replace_week_shifts(
    'f1030000-0000-4000-8000-000000000002', 'f1030000-0000-4000-8000-0000000000a2', '2026-09-07',
    '[]', '[]', '[{"shift_date":"2026-09-08","start_time":"09:00","end_time":"17:00"}]')::text$f$);
  perform pg_sleep(0.3);
  if dblink_is_busy('f1030b') = 0 then
    raise exception 'T5 the second copy did not wait for the first';
  end if;
  perform dblink_exec('f1030a', 'commit');
  begin
    perform x from dblink_get_result('f1030b') as t(x text);
    err := 'none';
  exception when others then
    err := sqlstate;
  end;
  perform x from dblink_get_result('f1030b', false) as t(x text);
  select count(*) into n from public.shifts where restaurant_id = 'f1030000-0000-4000-8000-000000000002';
  perform dblink_exec('f1030a', $f$
    delete from public.shifts where restaurant_id = 'f1030000-0000-4000-8000-000000000002';
    delete from public.schedules where restaurant_id = 'f1030000-0000-4000-8000-000000000002';
    delete from public.restaurants where id = 'f1030000-0000-4000-8000-000000000002';
  $f$);
  perform dblink_disconnect('f1030a');
  perform dblink_disconnect('f1030b');
  if n <> 1 then
    raise exception 'T5 two copies at once left % shifts, not 1 (second copy: %)', n, err;
  end if;
  if err <> '40001' then
    raise exception 'T5 the second copy was not refused as a changed week (%)', err;
  end if;
end $$;
