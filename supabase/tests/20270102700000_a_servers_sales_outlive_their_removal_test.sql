-- F-576 (owner-quarter sim, wave 17): removing a server from the roster used
-- to delete every service they had recorded (server_sales.member_id ON DELETE
-- CASCADE). Migration a_servers_sales_outlive_their_removal drops the key.
--
-- Self-asserting: every block raises on a failure. It must FAIL on a build
-- without that migration (T1, T2) and PASS with it. One transaction, rolled
-- back: it leaves nothing behind.

begin;

insert into public.restaurants (id, name, slug)
values ('7a000000-0000-4000-8000-000000000001', 'Sales Test House', 'f576-sales-test-house');
insert into public.team_members (id, restaurant_id, display_name)
values ('7a000000-0000-4000-8000-0000000000a1', '7a000000-0000-4000-8000-000000000001', 'Leaving Server'),
       ('7a000000-0000-4000-8000-0000000000a2', '7a000000-0000-4000-8000-000000000001', 'Staying Server');
insert into public.server_sales (restaurant_id, member_id, service_date, covers, net_sales)
values ('7a000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-0000000000a1', '2026-12-01', 20, 900),
       ('7a000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-0000000000a1', '2026-12-02', 18, 810),
       ('7a000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-0000000000a2', '2026-12-01', 15, 600);

-- T1 no foreign key from server_sales to team_members is left.
do $$
begin
  assert not exists (
    select 1 from pg_constraint
     where conrelid = 'public.server_sales'::regclass and contype = 'f'
       and confrelid = 'public.team_members'::regclass),
    'T1 FAIL server_sales still references team_members';
end $$;

-- T2 removing the server from the roster keeps their services, under their id.
delete from public.team_members where id = '7a000000-0000-4000-8000-0000000000a1';
do $$
declare n int;
begin
  select count(*) into n from public.server_sales
   where member_id = '7a000000-0000-4000-8000-0000000000a1';
  assert n = 2, format('T2 FAIL the removed server has %s services left, expected 2', n);
  select count(*) into n from public.server_sales
   where restaurant_id = '7a000000-0000-4000-8000-000000000001';
  assert n = 3, format('T2 FAIL the house has %s services left, expected 3', n);
end $$;

-- T3 one row per server per day still holds for the kept rows.
do $$
begin
  begin
    insert into public.server_sales (restaurant_id, member_id, service_date)
    values ('7a000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-0000000000a1', '2026-12-01');
    raise exception 'T3 FAIL a second row for the same server and day was accepted';
  exception when unique_violation then null;
  end;
end $$;

rollback;
