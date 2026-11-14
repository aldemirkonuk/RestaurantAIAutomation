-- r36 menu audit N9: migration a_kept_menu_can_be_set_aside lets a kept menu
-- be set aside and brought back, never the current one, and a menu set aside
-- cannot be made current by make_menu_current.
--
-- Self-asserting: every block raises on a failure. It must FAIL on a build
-- without that migration (the first UPDATE names columns that do not exist)
-- and PASS with it. One transaction, rolled back.

begin;

insert into public.restaurants (id, name, slug)
values ('a9400000-0000-4000-8000-000000000001', 'N9 set-aside house', 'n9-set-aside-house');

insert into public.users (user_id, email, name, restaurant_id, role)
values ('a9400000-0000-4000-8000-0000000000a1', 'n9-manager@x.test', 'N9 manager',
        'a9400000-0000-4000-8000-000000000001', 'manager');

insert into public.restaurant_menus (id, restaurant_id, name, status) values
  ('a9400000-0000-4000-8000-0000000000c1', 'a9400000-0000-4000-8000-000000000001', 'Current', 'active'),
  ('a9400000-0000-4000-8000-0000000000d1', 'a9400000-0000-4000-8000-000000000001', 'Misread', 'draft'),
  ('a9400000-0000-4000-8000-0000000000e1', 'a9400000-0000-4000-8000-000000000001', 'Old', 'archived');

-- S1: a draft and an archived menu can be set aside, saying who.
update public.restaurant_menus
   set set_aside_at = now(), set_aside_by = 'a9400000-0000-4000-8000-0000000000a1'
 where id in ('a9400000-0000-4000-8000-0000000000d1', 'a9400000-0000-4000-8000-0000000000e1');
do $$
begin
  if (select count(*) from public.restaurant_menus
       where restaurant_id = 'a9400000-0000-4000-8000-000000000001' and set_aside_at is not null) <> 2 then
    raise exception 'S1: a draft and an archived menu should be set aside';
  end if;
end
$$;

-- S2: the current menu cannot be set aside.
do $$
begin
  update public.restaurant_menus
     set set_aside_at = now(), set_aside_by = 'a9400000-0000-4000-8000-0000000000a1'
   where id = 'a9400000-0000-4000-8000-0000000000c1';
  raise exception 'S2: the current menu was set aside';
exception when check_violation then null;
end
$$;

-- S3: a menu set aside says who: a moment with no person is refused, and so is a person with no moment.
do $$
begin
  update public.restaurant_menus set set_aside_by = null where id = 'a9400000-0000-4000-8000-0000000000d1';
  raise exception 'S3: a set-aside moment with no person was kept';
exception when check_violation then null;
end
$$;
do $$
begin
  update public.restaurant_menus
     set set_aside_by = 'a9400000-0000-4000-8000-0000000000a1'
   where id = 'a9400000-0000-4000-8000-0000000000c1';
  raise exception 'S3: a set-aside person with no moment was kept';
exception when check_violation then null;
end
$$;

-- S4: make_menu_current refuses a menu set aside, and nothing changes.
do $$
begin
  perform public.make_menu_current(
    'a9400000-0000-4000-8000-000000000001',
    'a9400000-0000-4000-8000-0000000000d1',
    'a9400000-0000-4000-8000-0000000000a1');
  raise exception 'S4: a menu set aside was made current';
exception when check_violation then null;
end
$$;
do $$
begin
  if (select status from public.restaurant_menus where id = 'a9400000-0000-4000-8000-0000000000c1') <> 'active' then
    raise exception 'S4: the current menu changed when a set-aside menu was refused';
  end if;
end
$$;

-- S5: brought back, the same menu can be made current, and the one it replaces is archived.
update public.restaurant_menus set set_aside_at = null, set_aside_by = null
 where id = 'a9400000-0000-4000-8000-0000000000d1';
select public.make_menu_current(
  'a9400000-0000-4000-8000-000000000001',
  'a9400000-0000-4000-8000-0000000000d1',
  'a9400000-0000-4000-8000-0000000000a1');
do $$
begin
  if (select status from public.restaurant_menus where id = 'a9400000-0000-4000-8000-0000000000d1') <> 'active'
     or (select status from public.restaurant_menus where id = 'a9400000-0000-4000-8000-0000000000c1') <> 'archived' then
    raise exception 'S5: a menu brought back should become current';
  end if;
end
$$;

rollback;
