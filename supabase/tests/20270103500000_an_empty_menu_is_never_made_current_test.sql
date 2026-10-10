-- F-681 (sim wave 23): make_menu_current archived the house's active menu for
-- a menu with no lines, so one press on an empty read emptied the house menu.
-- Migration an_empty_menu_is_never_made_current refuses it (22023).
--
-- Self-asserting: every block raises on a failure, so `psql -v ON_ERROR_STOP=1
-- -f` stops at the first one. It must FAIL on a build without that migration
-- (T1: the empty menu is made current) and PASS with it. One transaction,
-- rolled back: it leaves nothing behind.

begin;

insert into public.restaurants (id, name, slug)
values ('f6810000-0000-4000-8000-000000000001', 'F681 house', 'f681-house');
insert into public.users (user_id, email, name, restaurant_id, role) values
  ('f6810000-0000-4000-8000-0000000000b1', 'f681-owner@x.test', 'F681 owner',
   'f6810000-0000-4000-8000-000000000001', 'owner');

insert into public.restaurant_menus (id, restaurant_id, name, status) values
  ('f6810000-0000-4000-8000-0000000000a1', 'f6810000-0000-4000-8000-000000000001', 'Current', 'active'),
  ('f6810000-0000-4000-8000-0000000000a2', 'f6810000-0000-4000-8000-000000000001', 'Empty read', 'draft'),
  ('f6810000-0000-4000-8000-0000000000a3', 'f6810000-0000-4000-8000-000000000001', 'Only discarded', 'draft'),
  ('f6810000-0000-4000-8000-0000000000a4', 'f6810000-0000-4000-8000-000000000001', 'Real read', 'draft');

insert into public.menu_items (menu_id, restaurant_id, name, category, bottle_price, status) values
  ('f6810000-0000-4000-8000-0000000000a1', 'f6810000-0000-4000-8000-000000000001', 'Zqf Current Red', 'red', 40, 'approved'),
  ('f6810000-0000-4000-8000-0000000000a3', 'f6810000-0000-4000-8000-000000000001', 'Zqf Gone Red', 'red', 40, 'discarded'),
  ('f6810000-0000-4000-8000-0000000000a4', 'f6810000-0000-4000-8000-000000000001', 'Zqf New Red', 'red', 45, 'approved');

-- T1 a menu with no lines is refused, and the house's menu stays current.
do $$
begin
  begin
    perform public.make_menu_current('f6810000-0000-4000-8000-000000000001',
                                     'f6810000-0000-4000-8000-0000000000a2',
                                     'f6810000-0000-4000-8000-0000000000b1');
    raise exception 'T1 FAIL: an empty menu was made current' using errcode = 'P0004';
  exception when sqlstate '22023' then
    if sqlerrm not like '%no lines%' then
      raise exception 'T1 FAIL: refused for another reason: %', sqlerrm using errcode = 'P0004';
    end if;
  end;
  assert (select status from public.restaurant_menus where id = 'f6810000-0000-4000-8000-0000000000a1') = 'active',
    'T1 FAIL: the current menu was archived';
  assert (select status from public.restaurant_menus where id = 'f6810000-0000-4000-8000-0000000000a2') = 'draft',
    'T1 FAIL: the empty menu changed status';
end $$;

-- T2 a menu whose only lines were discarded is refused too.
do $$
begin
  begin
    perform public.make_menu_current('f6810000-0000-4000-8000-000000000001',
                                     'f6810000-0000-4000-8000-0000000000a3',
                                     'f6810000-0000-4000-8000-0000000000b1');
    raise exception 'T2 FAIL: a menu of discarded lines was made current' using errcode = 'P0004';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- T3 a menu with a line is still made current, archiving the old one.
do $$
declare
  r jsonb;
begin
  r := public.make_menu_current('f6810000-0000-4000-8000-000000000001',
                                'f6810000-0000-4000-8000-0000000000a4',
                                'f6810000-0000-4000-8000-0000000000b1');
  assert r->>'outcome' = 'made_current', 'T3 FAIL: ' || r::text;
  assert (select status from public.restaurant_menus where id = 'f6810000-0000-4000-8000-0000000000a1') = 'archived',
    'T3 FAIL: the old menu was not archived';
end $$;

rollback;
