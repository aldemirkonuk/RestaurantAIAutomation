-- ADR 0340 rules 1, 2, 5, 22: a house holds one live menu per KIND; Drinks
-- and Food can both be live; a second live menu of one kind is refused by the
-- database; a menu written without a status is a draft; the kind order is a
-- permutation of the three kinds. Migration a_house_has_one_live_menu_per_kind.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration (T2: the second live Drinks menu is accepted)
-- and PASS with it. One transaction, rolled back. SYNTHETIC fixtures only.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('drinks', gen_random_uuid()), ('food', gen_random_uuid()),
  ('drinks2', gen_random_uuid()), ('sweet', gen_random_uuid()), ('quiet', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC kinds house', 'syn-kinds-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

-- T1 a live Drinks menu and a live Food menu stand side by side.
do $$
begin
  insert into public.restaurant_menus (id, restaurant_id, name, menu_type, status)
  select (select v from t_fx where k = 'drinks'), (select v from t_fx where k = 'house'), 'SYNTHETIC drinks', 'beverage', 'active';
  insert into public.restaurant_menus (id, restaurant_id, name, menu_type, status)
  select (select v from t_fx where k = 'food'), (select v from t_fx where k = 'house'), 'SYNTHETIC food', 'food', 'active';
  if (select count(*) from public.restaurant_menus
       where restaurant_id = (select v from t_fx where k = 'house') and status = 'active') <> 2 then
    raise exception 'T1 FAIL: two kinds could not both be live';
  end if;
end $$;

-- T2 a second live Drinks menu is refused by the database itself.
do $$
begin
  begin
    insert into public.restaurant_menus (id, restaurant_id, name, menu_type, status)
    select (select v from t_fx where k = 'drinks2'), (select v from t_fx where k = 'house'), 'SYNTHETIC drinks 2', 'beverage', 'active';
    raise exception 'T2 FAIL: a second live Drinks menu was accepted' using errcode = 'P0004';
  exception when unique_violation then null;
  end;
end $$;

-- T3 'desserts' is a kind, and its live menu stands beside the other two.
do $$
begin
  insert into public.restaurant_menus (id, restaurant_id, name, menu_type, status)
  select (select v from t_fx where k = 'sweet'), (select v from t_fx where k = 'house'), 'SYNTHETIC desserts', 'desserts', 'active';
  begin
    insert into public.restaurant_menus (restaurant_id, name, menu_type, status)
    select (select v from t_fx where k = 'house'), 'SYNTHETIC dessert wine kind', 'dessert', 'draft';
    raise exception 'T3 FAIL: ''dessert'' (a wine category) was accepted as a menu kind' using errcode = 'P0004';
  exception when check_violation then null;
  end;
end $$;

-- T4 a menu written without a status is a draft, never live by accident.
do $$
begin
  insert into public.restaurant_menus (id, restaurant_id, name, menu_type)
  select (select v from t_fx where k = 'quiet'), (select v from t_fx where k = 'house'), 'SYNTHETIC no status', 'beverage';
  if (select status from public.restaurant_menus where id = (select v from t_fx where k = 'quiet')) <> 'draft' then
    raise exception 'T4 FAIL: a menu without a status was not a draft';
  end if;
end $$;

-- T5 the kind order is exactly a permutation of the three kinds.
do $$
begin
  update public.restaurants set menu_kind_order = array['food', 'desserts', 'beverage']
   where id = (select v from t_fx where k = 'house');
  begin
    update public.restaurants set menu_kind_order = array['food', 'food', 'beverage']
     where id = (select v from t_fx where k = 'house');
    raise exception 'T5 FAIL: a kind order naming food twice was accepted' using errcode = 'P0004';
  exception when check_violation then null;
  end;
  begin
    update public.restaurants set menu_kind_order = array['food', 'beverage']
     where id = (select v from t_fx where k = 'house');
    raise exception 'T5 FAIL: a kind order missing desserts was accepted' using errcode = 'P0004';
  exception when check_violation then null;
  end;
end $$;

-- T6 a finished carry is dated only on a menu that was made current, and a
-- partial read says why.
do $$
begin
  begin
    update public.restaurant_menus set carried_at = now()
     where id = (select v from t_fx where k = 'quiet');
    raise exception 'T6 FAIL: a carry was dated on a menu never made current' using errcode = 'P0004';
  exception when check_violation then null;
  end;
  begin
    update public.restaurant_menus set part_read = '  '
     where id = (select v from t_fx where k = 'quiet');
    raise exception 'T6 FAIL: a blank part_read was accepted' using errcode = 'P0004';
  exception when check_violation then null;
  end;
end $$;

rollback;
