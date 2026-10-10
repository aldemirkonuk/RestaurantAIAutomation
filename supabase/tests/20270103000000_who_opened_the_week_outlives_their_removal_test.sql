-- F-585 (owner-quarter sim, wave 17): removing a person from the roster used
-- to erase that they had opened the published week (schedule_receipts.member_id
-- ON DELETE CASCADE). Migration who_opened_the_week_outlives_their_removal
-- drops the key.
--
-- Self-asserting: every block raises on a failure. It must FAIL on a build
-- without that migration (T1, T2) and PASS with it. One transaction, rolled
-- back: it leaves nothing behind.

begin;

insert into public.restaurants (id, name, slug)
values ('7c000000-0000-4000-8000-000000000001', 'Receipt Test House', 'f585-receipt-test-house');
insert into public.team_members (id, restaurant_id, display_name)
values ('7c000000-0000-4000-8000-0000000000c1', '7c000000-0000-4000-8000-000000000001', 'Leaving Cook'),
       ('7c000000-0000-4000-8000-0000000000c2', '7c000000-0000-4000-8000-000000000001', 'Staying Cook');
insert into public.schedules (id, restaurant_id, week_start, status)
values ('7c000000-0000-4000-8000-0000000000d1', '7c000000-0000-4000-8000-000000000001', '2026-12-07', 'published');
insert into public.schedule_receipts (schedule_id, member_id)
values ('7c000000-0000-4000-8000-0000000000d1', '7c000000-0000-4000-8000-0000000000c1'),
       ('7c000000-0000-4000-8000-0000000000d1', '7c000000-0000-4000-8000-0000000000c2');

-- T1 no foreign key from schedule_receipts to team_members is left.
do $$
begin
  assert not exists (
    select 1 from pg_constraint
     where conrelid = 'public.schedule_receipts'::regclass and contype = 'f'
       and confrelid = 'public.team_members'::regclass),
    'T1 FAIL schedule_receipts still references team_members';
end $$;

-- T2 removing the person keeps their receipt, under their id.
delete from public.team_members where id = '7c000000-0000-4000-8000-0000000000c1';
do $$
declare n int;
begin
  select count(*) into n from public.schedule_receipts
   where schedule_id = '7c000000-0000-4000-8000-0000000000d1';
  assert n = 2, format('T2 FAIL the week has %s receipts left, expected 2', n);
end $$;

-- T3 one receipt per person per week still holds for the kept row.
do $$
begin
  begin
    insert into public.schedule_receipts (schedule_id, member_id)
    values ('7c000000-0000-4000-8000-0000000000d1', '7c000000-0000-4000-8000-0000000000c1');
    raise exception 'T3 FAIL a second receipt for the same person and week was accepted';
  exception when unique_violation then null;
  end;
end $$;

-- T4 deleting the week still takes its receipts (schedule_id key unchanged).
delete from public.schedules where id = '7c000000-0000-4000-8000-0000000000d1';
do $$
declare n int;
begin
  select count(*) into n from public.schedule_receipts
   where schedule_id = '7c000000-0000-4000-8000-0000000000d1';
  assert n = 0, format('T4 FAIL %s receipts outlived their week', n);
end $$;

rollback;
