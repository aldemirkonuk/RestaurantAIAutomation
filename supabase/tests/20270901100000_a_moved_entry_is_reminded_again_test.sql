-- QA round 4 B4: a calendar entry that moves is reminded again. Migration
-- 20270901100000.
--
-- Self-asserting: every block raises on a failure, so `psql -v
-- ON_ERROR_STOP=1 -f` or the PGlite harness stops at the first one. Run it on
-- a database built from supabase/migrations. It must FAIL on a build without
-- 20270901100000 (the moved entry keeps reminder_sent = true, and the second
-- claim for the same entry and person is a duplicate) and PASS with it. One
-- transaction, rolled back: it leaves nothing behind.

begin;

insert into public.restaurants (id, name, slug) values
  ('b4000000-0000-4000-8000-000000000001', 'Rearm house', 'rearm-house-b4');
insert into public.users (user_id, email, name, restaurant_id, role) values
  ('b4100000-0000-4000-8000-000000000001', 'b4-staff@x.test', 'B4 staff',
   'b4000000-0000-4000-8000-000000000001', 'staff');

insert into public.calendar_events
  (id, restaurant_id, title, event_type, event_date, start_date, all_day,
   source, reminder_enabled, reminder_days_before, reminder_sent, reminder_sent_at)
values
  ('b4200000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001',
   'Fish delivery', 'delivery', '2026-01-20', '2026-01-20', true,
   'manual', true, 1, true, now());

-- The reminder for the 20th went out.
insert into public.calendar_reminder_dispatches
  (restaurant_id, calendar_event_id, user_id, due_at, outcome, sent_at)
values
  ('b4000000-0000-4000-8000-000000000001', 'b4200000-0000-4000-8000-000000000001',
   'b4100000-0000-4000-8000-000000000001', '2026-01-19 09:00+00', 'sent', now());

-- 1. A change that does not move the instant leaves the stamp alone.
update public.calendar_events set title = 'Fish delivery (Kaptan)', status = 'confirmed',
       end_date = '2026-01-20'
 where id = 'b4200000-0000-4000-8000-000000000001';
do $$ begin
  assert (select reminder_sent from public.calendar_events
           where id = 'b4200000-0000-4000-8000-000000000001'),
    'a title, status or end-day change must not re-arm the reminder';
end $$;

-- 2. Moving the start day re-arms it. Written through event_date, the older
--    column, as an agent would: the start_date copy follows and the stamp drops.
update public.calendar_events set event_date = '2026-01-28'
 where id = 'b4200000-0000-4000-8000-000000000001';
do $$ begin
  assert (select not reminder_sent and reminder_sent_at is null
            from public.calendar_events
           where id = 'b4200000-0000-4000-8000-000000000001'),
    'moving the day must put reminder_sent back to false';
end $$;

-- 2b. And through start_date, the column the API writes.
update public.calendar_events set reminder_sent = true
 where id = 'b4200000-0000-4000-8000-000000000001';
update public.calendar_events set start_date = '2026-01-27'
 where id = 'b4200000-0000-4000-8000-000000000001';
do $$ begin
  assert (select not reminder_sent and event_date = '2026-01-27'
            from public.calendar_events
           where id = 'b4200000-0000-4000-8000-000000000001'),
    'moving the day through start_date must re-arm';
end $$;

-- 3. The stamp written by the job after the new reminder does not re-arm itself.
update public.calendar_events set reminder_sent = true, reminder_sent_at = now()
 where id = 'b4200000-0000-4000-8000-000000000001';
do $$ begin
  assert (select reminder_sent from public.calendar_events
           where id = 'b4200000-0000-4000-8000-000000000001'),
    'stamping must stay stamped';
end $$;

-- 4. A new start time, all-day flag or lead re-arms it too, each on its own.
update public.calendar_events set start_time = '07:30'
 where id = 'b4200000-0000-4000-8000-000000000001';
do $$ begin
  assert (select not reminder_sent from public.calendar_events
           where id = 'b4200000-0000-4000-8000-000000000001'),
    'a new start time must re-arm';
end $$;
-- The older time column alone, on a row with no start_time (an agent's write;
-- the sync trigger then copies it into start_time).
update public.calendar_events set start_time = null, event_time = null
 where id = 'b4200000-0000-4000-8000-000000000001';
update public.calendar_events set reminder_sent = true
 where id = 'b4200000-0000-4000-8000-000000000001';
update public.calendar_events set event_time = '08:00'
 where id = 'b4200000-0000-4000-8000-000000000001';
do $$ begin
  assert (select not reminder_sent and start_time = '08:00'
            from public.calendar_events
           where id = 'b4200000-0000-4000-8000-000000000001'),
    'a new time written through event_time must re-arm';
end $$;
update public.calendar_events set reminder_sent = true
 where id = 'b4200000-0000-4000-8000-000000000001';
update public.calendar_events set all_day = false
 where id = 'b4200000-0000-4000-8000-000000000001';
do $$ begin
  assert (select not reminder_sent from public.calendar_events
           where id = 'b4200000-0000-4000-8000-000000000001'),
    'a change to all-day must re-arm';
end $$;
update public.calendar_events set reminder_sent = true
 where id = 'b4200000-0000-4000-8000-000000000001';
update public.calendar_events set reminder_days_before = 2
 where id = 'b4200000-0000-4000-8000-000000000001';
do $$ begin
  assert (select not reminder_sent from public.calendar_events
           where id = 'b4200000-0000-4000-8000-000000000001'),
    'a new lead must re-arm';
end $$;

-- 5. The new instant claims a row of its own; the old instant still cannot be
--    claimed twice.
insert into public.calendar_reminder_dispatches
  (restaurant_id, calendar_event_id, user_id, due_at)
values
  ('b4000000-0000-4000-8000-000000000001', 'b4200000-0000-4000-8000-000000000001',
   'b4100000-0000-4000-8000-000000000001', '2026-01-26 07:30+00')
on conflict (calendar_event_id, user_id, due_at) do nothing;
insert into public.calendar_reminder_dispatches
  (restaurant_id, calendar_event_id, user_id, due_at)
values
  ('b4000000-0000-4000-8000-000000000001', 'b4200000-0000-4000-8000-000000000001',
   'b4100000-0000-4000-8000-000000000001', '2026-01-19 09:00+00')
on conflict (calendar_event_id, user_id, due_at) do nothing;
do $$ begin
  assert (select count(*) from public.calendar_reminder_dispatches
           where calendar_event_id = 'b4200000-0000-4000-8000-000000000001') = 2,
    'one row per instant: the new one claimed, the old one not claimed again';
end $$;

rollback;
