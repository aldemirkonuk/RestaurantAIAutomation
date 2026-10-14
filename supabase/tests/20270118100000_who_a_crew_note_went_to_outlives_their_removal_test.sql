-- F-1701 (owner-quarter sim, wave 56): removing a person from the roster used
-- to erase their recipient and delivery rows on past crew notes
-- (team_note_recipients / team_note_deliveries .member_id ON DELETE CASCADE),
-- rewriting "Sent to N / X of N opened". Migration
-- who_a_crew_note_went_to_outlives_their_removal drops both keys.
--
-- Self-asserting: every block raises on a failure. It must FAIL on a build
-- without that migration (T1, T2) and PASS with it. One transaction, rolled
-- back: it leaves nothing behind.

begin;

insert into public.restaurants (id, name, slug)
values ('7d000000-0000-4000-8000-000000000001', 'Note Test House', 'f1701-note-test-house');
insert into public.users (user_id, email, name, restaurant_id, role)
values ('7d000000-0000-4000-8000-0000000000a1', 'f1701-owner@x.test', 'F1701 owner',
        '7d000000-0000-4000-8000-000000000001', 'owner');
insert into public.team_members (id, restaurant_id, display_name)
values ('7d000000-0000-4000-8000-0000000000c1', '7d000000-0000-4000-8000-000000000001', 'Leaving Cook'),
       ('7d000000-0000-4000-8000-0000000000c2', '7d000000-0000-4000-8000-000000000001', 'Staying Cook');
insert into public.team_notes (id, restaurant_id, week_start, body, author_user_id)
values ('7d000000-0000-4000-8000-0000000000e1', '7d000000-0000-4000-8000-000000000001',
        '2027-01-11', 'Inventory on Monday', '7d000000-0000-4000-8000-0000000000a1');
insert into public.team_note_recipients (note_id, member_id, opened_at)
values ('7d000000-0000-4000-8000-0000000000e1', '7d000000-0000-4000-8000-0000000000c1', now()),
       ('7d000000-0000-4000-8000-0000000000e1', '7d000000-0000-4000-8000-0000000000c2', null);
insert into public.team_note_deliveries (note_id, member_id, channel, state, detail)
values ('7d000000-0000-4000-8000-0000000000e1', '7d000000-0000-4000-8000-0000000000c1', 'inbox', 'delivered', 'In their inbox'),
       ('7d000000-0000-4000-8000-0000000000e1', '7d000000-0000-4000-8000-0000000000c2', 'inbox', 'delivered', 'In their inbox');

-- T1 no foreign key from either table to team_members is left.
do $$
begin
  assert not exists (
    select 1 from pg_constraint
     where conrelid in ('public.team_note_recipients'::regclass,
                        'public.team_note_deliveries'::regclass)
       and contype = 'f'
       and confrelid = 'public.team_members'::regclass),
    'T1 FAIL a crew note table still references team_members';
end $$;

-- T2 removing the person keeps who the note was sent to, who opened it, and
-- how it reached them: still "Sent to 2 / 1 of 2 opened".
delete from public.team_members where id = '7d000000-0000-4000-8000-0000000000c1';
do $$
declare addressed int; opened int; delivered int;
begin
  select count(*), count(opened_at) into addressed, opened
    from public.team_note_recipients
   where note_id = '7d000000-0000-4000-8000-0000000000e1';
  select count(*) into delivered from public.team_note_deliveries
   where note_id = '7d000000-0000-4000-8000-0000000000e1';
  assert addressed = 2, format('T2 FAIL the note now reads sent to %s, expected 2', addressed);
  assert opened = 1, format('T2 FAIL the note now reads %s opened, expected 1', opened);
  assert delivered = 2, format('T2 FAIL %s delivery rows left, expected 2', delivered);
end $$;

-- T3 one recipient row per person per note still holds for the kept row.
do $$
begin
  begin
    insert into public.team_note_recipients (note_id, member_id)
    values ('7d000000-0000-4000-8000-0000000000e1', '7d000000-0000-4000-8000-0000000000c1');
    raise exception 'T3 FAIL a second recipient row for the same person and note was accepted';
  exception when unique_violation then null;
  end;
end $$;

-- T4 deleting the note still takes its rows (note_id keys unchanged).
delete from public.team_notes where id = '7d000000-0000-4000-8000-0000000000e1';
do $$
declare n int;
begin
  select (select count(*) from public.team_note_recipients
           where note_id = '7d000000-0000-4000-8000-0000000000e1')
       + (select count(*) from public.team_note_deliveries
           where note_id = '7d000000-0000-4000-8000-0000000000e1') into n;
  assert n = 0, format('T4 FAIL %s rows outlived their note', n);
end $$;

rollback;
