-- ADR 0215 item 27 (founder, 2026-09-28): "Replace with" — a leaving
-- person's shifts go to someone named on the same roster, all of it or none
-- of it, and double booking is refused unless the owner allows it and the
-- remover accepted it. Migration 20261202120000.
--
-- Self-asserting: every block raises on a failure, so `psql -v
-- ON_ERROR_STOP=1 -f` stops at the first one. Run it on a database built
-- from supabase/migrations. It must FAIL on a build without 20261202120000
-- (no hand_over_leaving_shifts, no allow_double_booking) and PASS with it.
-- One transaction, rolled back: it leaves nothing behind.

begin;

insert into public.restaurants (id, name, slug) values
  ('e1000000-0000-4000-8000-000000000001', 'Handover house', 'handover-house-item-27'),
  ('e1000000-0000-4000-8000-000000000002', 'Other house', 'other-house-item-27');
insert into public.schedules (id, restaurant_id, week_start) values
  ('e3000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', '2026-09-21');
-- P leaves; Q takes over; X is on another house's roster.
insert into public.team_members (id, restaurant_id, display_name, "position") values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'P', 'Server'),
  ('e2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 'Q', 'Server'),
  ('e2000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000002', 'X', 'Server');
insert into public.shifts
  (id, restaurant_id, schedule_id, member_id, shift_date, start_time, end_time, role, shift_type, state, note, labor_cost)
values
  -- A: P's, in progress (cut at 13:00)
  ('e4000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
   'e2000000-0000-4000-8000-000000000001', '2026-09-22', '09:00', '17:00', 'Server', 'am', 'scheduled', 'Patio', 150),
  -- B: P's, not started, handed to Q
  ('e4000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
   'e2000000-0000-4000-8000-000000000001', '2026-09-24', '09:00', '17:00', 'Server', 'am', 'scheduled', null, 150),
  -- C: P's, not started, left for the open pool
  ('e4000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
   'e2000000-0000-4000-8000-000000000001', '2026-09-25', '09:00', '17:00', 'Server', 'am', 'scheduled', null, 150),
  -- D: Q's own, overlapping P's overnight shift E below
  ('e4000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
   'e2000000-0000-4000-8000-000000000002', '2026-09-27', '02:00', '06:00', 'Server', 'am', 'scheduled', null, 80),
  -- E: P's overnight Saturday 22:00 -> Sunday 04:00
  ('e4000000-0000-4000-8000-000000000005', 'e1000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
   'e2000000-0000-4000-8000-000000000001', '2026-09-26', '22:00', '04:00', 'Bar', 'pm', 'scheduled', null, 120);

-- T1 without the owner's switch, an overlap refuses the whole call, even
-- with the remover's acceptance: nothing is opened, cut, moved or added.
do $$
declare before_count integer; after_count integer; n integer;
begin
  select count(*) into before_count from public.shifts;
  begin
    perform public.hand_over_leaving_shifts(
      'e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
      'e2000000-0000-4000-8000-000000000002',
      '[{"id":"e4000000-0000-4000-8000-000000000003","shift_date":"2026-09-25","start_time":"09:00"}]'::jsonb,
      '[]'::jsonb,
      '[{"id":"e4000000-0000-4000-8000-000000000005","shift_date":"2026-09-26","start_time":"22:00","labor_cost":110}]'::jsonb,
      '[]'::jsonb,
      true);
    raise exception 'T1 an overlap was handed over without the owner allowing it';
  exception when raise_exception then
    if sqlerrm like 'T1 %' then raise; end if;
    assert sqlerrm like '%overlaps%', 'T1 refused for the wrong reason: ' || sqlerrm;
  end;
  select count(*) into after_count from public.shifts;
  assert after_count = before_count, 'T1 a row was added';
  select count(*) into n from public.shifts
   where id in ('e4000000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-000000000005')
     and member_id = 'e2000000-0000-4000-8000-000000000001' and state = 'scheduled';
  assert n = 2, 'T1 half of it landed';
end $$;

-- T2 with the switch on but the overlap NOT accepted, it still refuses.
do $$
begin
  insert into public.team_settings (restaurant_id, allow_double_booking)
    values ('e1000000-0000-4000-8000-000000000001', true);
  begin
    perform public.hand_over_leaving_shifts(
      'e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
      'e2000000-0000-4000-8000-000000000002',
      '[]'::jsonb, '[]'::jsonb,
      '[{"id":"e4000000-0000-4000-8000-000000000005","shift_date":"2026-09-26","start_time":"22:00","labor_cost":110}]'::jsonb,
      '[]'::jsonb,
      false);
    raise exception 'T2 an unaccepted overlap was handed over';
  exception when raise_exception then
    if sqlerrm like 'T2 %' then raise; end if;
  end;
  -- switched on AND accepted: it lands.
  perform public.hand_over_leaving_shifts(
    'e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000002',
    '[]'::jsonb, '[]'::jsonb,
    '[{"id":"e4000000-0000-4000-8000-000000000005","shift_date":"2026-09-26","start_time":"22:00","labor_cost":110}]'::jsonb,
    '[]'::jsonb,
    true);
  assert exists (select 1 from public.shifts where id = 'e4000000-0000-4000-8000-000000000005'
                  and member_id = 'e2000000-0000-4000-8000-000000000002' and labor_cost = 110),
    'T2 an allowed, accepted overlap did not land';
  delete from public.team_settings where restaurant_id = 'e1000000-0000-4000-8000-000000000001';
end $$;

-- T3 a whole plan lands: C opens, A is cut and its rest goes to Q with A's
-- state and type, B moves to Q whole keeping its state, at the new costs.
do $$
declare r jsonb; rest record; n integer;
begin
  r := public.hand_over_leaving_shifts(
    'e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000002',
    '[{"id":"e4000000-0000-4000-8000-000000000003","shift_date":"2026-09-25","start_time":"09:00"}]'::jsonb,
    '[{"id":"e4000000-0000-4000-8000-000000000001",
       "was":{"shift_date":"2026-09-22","start_time":"09:00","end_time":"17:00"},
       "worked":{"end_time":"13:00","recorded_break_min":null,"labor_cost":75},
       "rest":{"shift_date":"2026-09-22","start_time":"13:00","end_time":"17:00","recorded_break_min":null}}]'::jsonb,
    '[{"id":"e4000000-0000-4000-8000-000000000002","shift_date":"2026-09-24","start_time":"09:00","labor_cost":140}]'::jsonb,
    '[{"id":"e4000000-0000-4000-8000-000000000001","labor_cost":70}]'::jsonb,
    false);
  assert (r->>'opened')::int = 1 and (r->>'split')::int = 1, 'T3 release counts ' || r::text;
  assert (r->>'given')::int = 1 and (r->>'given_rests')::int = 1, 'T3 hand-over counts ' || r::text;

  select count(*) into n from public.shifts
   where id = 'e4000000-0000-4000-8000-000000000003' and member_id is null and state = 'open';
  assert n = 1, 'T3 C was not opened';
  select count(*) into n from public.shifts
   where id = 'e4000000-0000-4000-8000-000000000002' and member_id = 'e2000000-0000-4000-8000-000000000002'
     and state = 'scheduled' and shift_type = 'am' and labor_cost = 140;
  assert n = 1, 'T3 B did not move to Q whole';
  select count(*) into n from public.shifts
   where id = 'e4000000-0000-4000-8000-000000000001' and member_id = 'e2000000-0000-4000-8000-000000000001'
     and end_time = '13:00' and labor_cost = 75;
  assert n = 1, 'T3 A''s worked part is not P''s';
  select * into rest from public.shifts
   where restaurant_id = 'e1000000-0000-4000-8000-000000000001'
     and shift_date = '2026-09-22' and start_time = '13:00';
  assert rest.member_id = 'e2000000-0000-4000-8000-000000000002' and rest.state = 'scheduled'
     and rest.shift_type = 'am' and rest.labor_cost = 70 and rest.end_time = '17:00'
     and rest.note = 'Patio', 'T3 A''s rest did not go to Q as A was';
end $$;

-- T4 the person taking over must be on THIS house's roster, and not the
-- person leaving.
do $$
begin
  begin
    perform public.hand_over_leaving_shifts(
      'e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
      'e2000000-0000-4000-8000-000000000003',
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false);
    raise exception 'T4 another house''s person was accepted';
  exception when raise_exception then
    if sqlerrm like 'T4 %' then raise; end if;
    assert sqlerrm like '%roster%', 'T4 wrong reason: ' || sqlerrm;
  end;
  begin
    perform public.hand_over_leaving_shifts(
      'e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
      'e2000000-0000-4000-8000-000000000001',
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false);
    raise exception 'T4 the person leaving took their own shifts';
  exception when raise_exception then
    if sqlerrm like 'T4 %' then raise; end if;
  end;
end $$;

-- T5 a given shift that is not as it was read refuses everything.
do $$
declare n integer;
begin
  insert into public.shifts (id, restaurant_id, member_id, shift_date, start_time, end_time, state)
  values ('e4000000-0000-4000-8000-000000000006', 'e1000000-0000-4000-8000-000000000001',
          'e2000000-0000-4000-8000-000000000001', '2026-10-06', '09:00', '17:00', 'scheduled'),
         ('e4000000-0000-4000-8000-000000000007', 'e1000000-0000-4000-8000-000000000001',
          'e2000000-0000-4000-8000-000000000001', '2026-10-07', '09:00', '17:00', 'scheduled');
  begin
    perform public.hand_over_leaving_shifts(
      'e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
      'e2000000-0000-4000-8000-000000000002',
      '[{"id":"e4000000-0000-4000-8000-000000000007","shift_date":"2026-10-07","start_time":"09:00"}]'::jsonb,
      '[]'::jsonb,
      '[{"id":"e4000000-0000-4000-8000-000000000006","shift_date":"2026-10-06","start_time":"08:00","labor_cost":1}]'::jsonb,
      '[]'::jsonb, false);
    raise exception 'T5 a stale given row did not refuse';
  exception when raise_exception then
    if sqlerrm like 'T5 %' then raise; end if;
  end;
  select count(*) into n from public.shifts
   where id in ('e4000000-0000-4000-8000-000000000006', 'e4000000-0000-4000-8000-000000000007')
     and member_id = 'e2000000-0000-4000-8000-000000000001' and state = 'scheduled';
  assert n = 2, 'T5 half of it landed';
end $$;

-- T6 invoker, not definer; the switch defaults to off.
do $$
begin
  assert not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'hand_over_leaving_shifts' and p.prosecdef),
    'T6 hand_over_leaving_shifts is SECURITY DEFINER';
  insert into public.team_settings (restaurant_id) values ('e1000000-0000-4000-8000-000000000002');
  assert (select allow_double_booking from public.team_settings
           where restaurant_id = 'e1000000-0000-4000-8000-000000000002') = false,
    'T6 double booking is not off by default';
end $$;

rollback;

-- T7 TWO SESSIONS (PR #502 audit, 2026-09-29): while a hand-over to Q is
-- open, Q's removal (TeamService.deleteMember's roster DELETE) must wait for
-- it, not land between the roster check and the UPDATEs and leave the shift
-- on someone who is gone. shifts.member_id has no FK to team_members, so only
-- the function's FOR KEY SHARE stops it. Needs dblink and a database this
-- session can reach again by name (or the libpq string in the setting
-- t7.conninfo, e.g. `set t7.conninfo = 'dbname=x user=postgres password=…'`
-- before this file, where a non-superuser must give a password); the two
-- sessions commit their own
-- fixture (ids e7…) and remove it at the end. On a build whose function only
-- reads the roster row, the DELETE goes through and this block raises.
create extension if not exists dblink;
do $$
declare
  conn text := coalesce(nullif(current_setting('t7.conninfo', true), ''),
                        'dbname=' || current_database());
  err text; n integer;
begin
  perform dblink_connect('t7a', conn);
  perform dblink_connect('t7b', conn);
  -- A run that died half-way leaves its fixture; clear it first.
  perform dblink_exec('t7a', $f$
    delete from public.shifts where restaurant_id = 'e7000000-0000-4000-8000-000000000001';
    delete from public.team_members where restaurant_id = 'e7000000-0000-4000-8000-000000000001';
    delete from public.schedules where restaurant_id = 'e7000000-0000-4000-8000-000000000001';
    delete from public.restaurants where id = 'e7000000-0000-4000-8000-000000000001';
    insert into public.restaurants (id, name, slug) values
      ('e7000000-0000-4000-8000-000000000001', 'Race house', 'race-house-item-27');
    insert into public.schedules (id, restaurant_id, week_start) values
      ('e7300000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000001', '2026-09-21');
    insert into public.team_members (id, restaurant_id, display_name, "position") values
      ('e7200000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000001', 'P', 'Server'),
      ('e7200000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000001', 'Q', 'Server');
    insert into public.shifts
      (id, restaurant_id, schedule_id, member_id, shift_date, start_time, end_time, role, shift_type, state, labor_cost)
    values ('e7400000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000001',
            'e7300000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001',
            '2026-09-24', '09:00', '17:00', 'Server', 'am', 'scheduled', 150)$f$);
  -- Session A: the hand-over, left open.
  perform dblink_exec('t7a', 'begin');
  perform x from dblink('t7a', $f$select public.hand_over_leaving_shifts(
      'e7000000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001',
      'e7200000-0000-4000-8000-000000000002', '[]'::jsonb, '[]'::jsonb,
      '[{"id":"e7400000-0000-4000-8000-000000000001","shift_date":"2026-09-24","start_time":"09:00","labor_cost":140}]'::jsonb,
      '[]'::jsonb, false)::text$f$) as t(x text);
  -- Session B: remove Q while A is open. It must be made to wait.
  perform dblink_exec('t7b', $f$set lock_timeout = '300ms'$f$);
  err := dblink_exec('t7b', $f$delete from public.team_members
                              where id = 'e7200000-0000-4000-8000-000000000002'$f$, false);
  perform dblink_exec('t7a', 'commit');
  select count(*) into n from dblink('t7b', $f$select 1 from public.team_members
      where id = 'e7200000-0000-4000-8000-000000000002'$f$) as t(x int);
  perform dblink_exec('t7b', 'reset lock_timeout');
  perform dblink_exec('t7b', $f$
    delete from public.shifts where restaurant_id = 'e7000000-0000-4000-8000-000000000001';
    delete from public.team_members where restaurant_id = 'e7000000-0000-4000-8000-000000000001';
    delete from public.schedules where restaurant_id = 'e7000000-0000-4000-8000-000000000001';
    delete from public.restaurants where id = 'e7000000-0000-4000-8000-000000000001'$f$);
  perform dblink_disconnect('t7a');
  perform dblink_disconnect('t7b');
  assert err <> 'DELETE 1' and n = 1,
    'T7 Q was removed while a hand-over to Q was open (' || err || ')';
end $$;
