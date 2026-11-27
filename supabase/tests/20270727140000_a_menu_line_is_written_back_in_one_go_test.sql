-- menu_items_write_back (migration a_menu_line_is_written_back_in_one_go, menu
-- proposal 2e). Self-asserting, one transaction, rolled back. FAILS on a build
-- without the migration (the function does not exist) and PASSES with it.

begin;

insert into public.restaurants (id, name, slug) values
  ('b2e00000-0000-4000-8000-000000000001', 'Write-back house', 'write-back-house'),
  ('b2e00000-0000-4000-8000-000000000002', 'Other house', 'write-back-other');
insert into public.restaurant_menus (id, restaurant_id, name, status) values
  ('b2e00000-0000-4000-8000-0000000000a1', 'b2e00000-0000-4000-8000-000000000001', 'Wine List', 'active'),
  ('b2e00000-0000-4000-8000-0000000000a2', 'b2e00000-0000-4000-8000-000000000002', 'Wine List', 'active');
insert into public.menu_items (id, menu_id, restaurant_id, name, price_flag, price_flag_note) values
  ('b2e00000-0000-4000-8000-0000000000b1', 'b2e00000-0000-4000-8000-0000000000a1', 'b2e00000-0000-4000-8000-000000000001', 'Opus One', null, null),
  ('b2e00000-0000-4000-8000-0000000000b2', 'b2e00000-0000-4000-8000-0000000000a1', 'b2e00000-0000-4000-8000-000000000001', 'Barolo', 'blank_kept_last_known', 'old note'),
  ('b2e00000-0000-4000-8000-0000000000b3', 'b2e00000-0000-4000-8000-0000000000a2', 'b2e00000-0000-4000-8000-000000000002', 'Not yours', null, null);

do $$
declare n integer;
begin
  -- T1 two lines of the house: link and flag written, count 2. A JSON null clears
  -- Barolo's old flag; Opus One names no flag keys, so its flag stays as it is.
  n := public.menu_items_write_back('b2e00000-0000-4000-8000-000000000001', jsonb_build_array(
    jsonb_build_object('id', 'b2e00000-0000-4000-8000-0000000000b1', 'inventory_item_id', 'b2e00000-0000-4000-8000-0000000000c1'),
    jsonb_build_object('id', 'b2e00000-0000-4000-8000-0000000000b2', 'inventory_item_id', 'b2e00000-0000-4000-8000-0000000000c2',
                       'price_flag', null, 'price_flag_note', null)
  ));
  if n <> 2 then raise exception 'T1: wrote % rows, expected 2', n; end if;
  if (select inventory_item_id::text from public.menu_items where id = 'b2e00000-0000-4000-8000-0000000000b1')
     is distinct from 'b2e00000-0000-4000-8000-0000000000c1' then raise exception 'T1: Opus One not linked'; end if;
  if (select price_flag from public.menu_items where id = 'b2e00000-0000-4000-8000-0000000000b2') is not null
     then raise exception 'T1: a JSON null did not clear the flag'; end if;

  -- T2 a key not named leaves the column: Barolo's link stays when only its flag is written.
  n := public.menu_items_write_back('b2e00000-0000-4000-8000-000000000001', jsonb_build_array(
    jsonb_build_object('id', 'b2e00000-0000-4000-8000-0000000000b2', 'price_flag', 'blank_no_house_price', 'price_flag_note', 'no price anywhere')
  ));
  if n <> 1 then raise exception 'T2: wrote % rows, expected 1', n; end if;
  if (select inventory_item_id::text from public.menu_items where id = 'b2e00000-0000-4000-8000-0000000000b2')
     is distinct from 'b2e00000-0000-4000-8000-0000000000c2' then raise exception 'T2: an unnamed key moved the link'; end if;
  if (select price_flag_note from public.menu_items where id = 'b2e00000-0000-4000-8000-0000000000b2')
     is distinct from 'no price anywhere' then raise exception 'T2: the note was not written'; end if;

  -- T3 another house's line is not written, and a missing id is skipped; neither is an error.
  n := public.menu_items_write_back('b2e00000-0000-4000-8000-000000000001', jsonb_build_array(
    jsonb_build_object('id', 'b2e00000-0000-4000-8000-0000000000b3', 'inventory_item_id', 'b2e00000-0000-4000-8000-0000000000c9'),
    jsonb_build_object('id', 'b2e00000-0000-4000-8000-0000000000ff', 'inventory_item_id', 'b2e00000-0000-4000-8000-0000000000c9')
  ));
  if n <> 0 then raise exception 'T3: wrote % rows of another house or none, expected 0', n; end if;
  if (select inventory_item_id from public.menu_items where id = 'b2e00000-0000-4000-8000-0000000000b3') is not null
     then raise exception 'T3: another house''s line was written'; end if;
  if (select count(*) from public.menu_items where id = 'b2e00000-0000-4000-8000-0000000000ff') <> 0
     then raise exception 'T3: a missing id made a row'; end if;

  -- T4 an empty or null list writes nothing.
  if public.menu_items_write_back('b2e00000-0000-4000-8000-000000000001', '[]'::jsonb) <> 0
     or public.menu_items_write_back('b2e00000-0000-4000-8000-000000000001', null) <> 0
     then raise exception 'T4: an empty list wrote something'; end if;

  -- T5 a flag outside the known set is still refused by the table's own check.
  begin
    perform public.menu_items_write_back('b2e00000-0000-4000-8000-000000000001', jsonb_build_array(
      jsonb_build_object('id', 'b2e00000-0000-4000-8000-0000000000b1', 'price_flag', 'made_up')));
    raise exception 'T5: an unknown price flag was written';
  exception when check_violation then null;
  end;

  -- T6 only service_role may call it.
  if has_function_privilege('authenticated', 'public.menu_items_write_back(uuid, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.menu_items_write_back(uuid, jsonb)', 'execute')
     then raise exception 'T6: a client role may call the write-back'; end if;

  raise notice 'menu_items_write_back: T1-T6 passed';
end
$$;

rollback;
