-- r36 menu audit N1: migration a_menu_price_in_other_money_is_held admits the
-- `other_currency` flag on menu_items, with its sentence, and nothing else
-- changes: a flag with no sentence and an unknown flag are still refused, and
-- menu_items_write_back writes the new flag.
--
-- Self-asserting: every block raises on a failure. It must FAIL on a build
-- without that migration (O1: check_violation) and PASS with it. One
-- transaction, rolled back.

begin;

insert into public.restaurants (id, name, slug)
values ('a3610000-0000-4000-8000-000000000001', 'N1 money house', 'n1-money-house');

insert into public.restaurant_menus (id, restaurant_id, name, status) values
  ('a3610000-0000-4000-8000-0000000000a1', 'a3610000-0000-4000-8000-000000000001', 'Read in euros', 'draft');

-- O1 a line held for its money is kept, with its sentence.
insert into public.menu_items (id, menu_id, restaurant_id, name, category, status, price_flag, price_flag_note) values
  ('a3610000-0000-4000-8000-0000000000b1', 'a3610000-0000-4000-8000-0000000000a1', 'a3610000-0000-4000-8000-000000000001',
   'Zqxn Euro Chianti', 'red', 'approved', 'other_currency',
   'The menu prints this line at 12.00 EUR a bottle, and this house''s money is TRY.');

-- O2 the new flag without its sentence is refused.
do $$
begin
  begin
    insert into public.menu_items (menu_id, restaurant_id, name, status, price_flag, price_flag_note) values
      ('a3610000-0000-4000-8000-0000000000a1', 'a3610000-0000-4000-8000-000000000001', 'Zqxn No Sentence', 'approved', 'other_currency', null);
    raise exception 'O2: other_currency with no sentence was admitted';
  exception when check_violation then null;
  end;
end
$$;

-- O3 a flag no rule names is still refused.
do $$
begin
  begin
    insert into public.menu_items (menu_id, restaurant_id, name, status, price_flag, price_flag_note) values
      ('a3610000-0000-4000-8000-0000000000a1', 'a3610000-0000-4000-8000-000000000001', 'Zqxn Odd Flag', 'approved', 'converted', 'x');
    raise exception 'O3: an unknown flag was admitted';
  exception when check_violation then null;
  end;
end
$$;

-- O4 the old flags still go in.
insert into public.menu_items (menu_id, restaurant_id, name, status, price_flag, price_flag_note) values
  ('a3610000-0000-4000-8000-0000000000a1', 'a3610000-0000-4000-8000-000000000001', 'Zqxn Kept', 'approved', 'blank_kept_last_known', 'kept'),
  ('a3610000-0000-4000-8000-0000000000a1', 'a3610000-0000-4000-8000-000000000001', 'Zqxn Never', 'approved', 'blank_no_house_price', 'never');

-- O5 the carry's write-back writes the flag and its sentence.
do $$
declare
  n integer;
  f text;
begin
  insert into public.menu_items (id, menu_id, restaurant_id, name, status) values
    ('a3610000-0000-4000-8000-0000000000b5', 'a3610000-0000-4000-8000-0000000000a1', 'a3610000-0000-4000-8000-000000000001', 'Zqxn Written Back', 'approved');
  select public.menu_items_write_back(
    'a3610000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'id', 'a3610000-0000-4000-8000-0000000000b5',
      'price_flag', 'other_currency',
      'price_flag_note', 'The menu prints this line at 4.00 EUR a glass.'))) into n;
  select price_flag into f from public.menu_items where id = 'a3610000-0000-4000-8000-0000000000b5';
  if n is distinct from 1 or f is distinct from 'other_currency' then
    raise exception 'O5: write-back wrote % row(s), flag %', n, f;
  end if;
end
$$;

rollback;
