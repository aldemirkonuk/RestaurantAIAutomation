-- F-196 / F-606 / F-605 (wave 19 calendar sim): migration
-- a_calendar_entry_keeps_what_it_was_told makes the twin-column sync honour a
-- cleared start time or end date, re-arms a moved entry's reminder, and keys a
-- reminder dispatch on its due time.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` stops at the first one. Run
-- it on a database built from supabase/migrations. It must FAIL on a build
-- without that migration (T1: the cleared 18:00 comes back) and PASS with it.
-- One transaction, rolled back: it leaves nothing behind.

begin;

insert into public.restaurants (id, name, slug)
values ('c7000000-0000-4000-8000-000000000001'::uuid, 'SYNTHETIC C7 Meyhane', 'synthetic-c7')
on conflict do nothing;

insert into public.users (user_id, email, name, restaurant_id, role) values
  ('c7000000-0000-4000-8000-0000000000a1', 'c7-owner@x.test', 'C7 owner',
   'c7000000-0000-4000-8000-000000000001', 'owner');

insert into public.calendar_events
  (id, restaurant_id, title, event_type, source, start_date, end_date, all_day, start_time, end_time)
values
  ('c7000000-0000-4000-8000-0000000000e1', 'c7000000-0000-4000-8000-000000000001',
   'Party', 'meeting', 'manual', '2026-10-12', '2026-10-13', false, '18:00', '22:00');

-- T1 the insert still fills both twins (unchanged behaviour).
do $$
declare r record;
begin
  select * into r from public.calendar_events where id = 'c7000000-0000-4000-8000-0000000000e1';
  assert r.event_date = '2026-10-12' and r.event_date_end = '2026-10-13' and r.event_time = '18:00',
    format('T1 FAIL insert twins: event_date %s, event_date_end %s, event_time %s', r.event_date, r.event_date_end, r.event_time);
end $$;

-- T2 what the gateway sends on "All day" and a cleared end date: the clears stick.
update public.calendar_events
   set all_day = true, start_time = null, end_time = null, end_date = null
 where id = 'c7000000-0000-4000-8000-0000000000e1';
do $$
declare r record;
begin
  select * into r from public.calendar_events where id = 'c7000000-0000-4000-8000-0000000000e1';
  assert r.start_time is null and r.event_time is null,
    format('T2 FAIL cleared start time came back: start_time %s, event_time %s', r.start_time, r.event_time);
  assert r.end_date is null and r.event_date_end is null,
    format('T2 FAIL cleared end date came back: end_date %s, event_date_end %s', r.end_date, r.event_date_end);
end $$;

-- T3 an update that does not touch the times keeps them, and writing only the
-- modern column still carries the twin (unchanged behaviour).
update public.calendar_events set start_time = '09:30', all_day = false
 where id = 'c7000000-0000-4000-8000-0000000000e1';
update public.calendar_events set title = 'Party, long table'
 where id = 'c7000000-0000-4000-8000-0000000000e1';
do $$
declare r record;
begin
  select * into r from public.calendar_events where id = 'c7000000-0000-4000-8000-0000000000e1';
  assert r.start_time = '09:30' and r.event_time = '09:30',
    format('T3 FAIL start_time %s, event_time %s', r.start_time, r.event_time);
end $$;

-- T4 a moved entry is reminded again; a title edit or the sweep's own stamp is not a move.
update public.calendar_events set reminder_sent = true, reminder_sent_at = now()
 where id = 'c7000000-0000-4000-8000-0000000000e1';
update public.calendar_events set title = 'Party'
 where id = 'c7000000-0000-4000-8000-0000000000e1';
do $$
begin
  assert (select reminder_sent from public.calendar_events where id = 'c7000000-0000-4000-8000-0000000000e1'),
    'T4 FAIL a title edit re-armed the reminder';
end $$;
update public.calendar_events set start_date = '2026-10-16'
 where id = 'c7000000-0000-4000-8000-0000000000e1';
do $$
declare r record;
begin
  select * into r from public.calendar_events where id = 'c7000000-0000-4000-8000-0000000000e1';
  assert r.reminder_sent = false and r.reminder_sent_at is null,
    format('T4 FAIL moving the date left reminder_sent %s', r.reminder_sent);
end $$;
update public.calendar_events set reminder_sent = true where id = 'c7000000-0000-4000-8000-0000000000e1';
update public.calendar_events set start_time = '11:00' where id = 'c7000000-0000-4000-8000-0000000000e1';
do $$
begin
  assert not (select reminder_sent from public.calendar_events where id = 'c7000000-0000-4000-8000-0000000000e1'),
    'T4 FAIL moving the time did not re-arm the reminder';
end $$;

-- T5 one dispatch per person per due time: a second due time is allowed, the
-- same one is still refused.
insert into public.calendar_reminder_dispatches (restaurant_id, calendar_event_id, user_id, due_at)
values ('c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-0000000000e1',
        'c7000000-0000-4000-8000-0000000000a1', '2026-10-11 09:00+00'),
       ('c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-0000000000e1',
        'c7000000-0000-4000-8000-0000000000a1', '2026-10-15 09:00+00');
do $$
begin
  begin
    insert into public.calendar_reminder_dispatches (restaurant_id, calendar_event_id, user_id, due_at)
    values ('c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-0000000000e1',
            'c7000000-0000-4000-8000-0000000000a1', '2026-10-15 09:00+00');
    raise exception 'T5 FAIL the same due time was claimed twice';
  exception when unique_violation then null;
  end;
end $$;

rollback;
