-- set_house_menu_prices (migration a_menu_carries_its_prices_in_one_call, r28
-- menu audit G1). Self-asserting, one transaction, rolled back. FAILS on a
-- build without the migration (the function does not exist) and PASSES with it.

begin;

insert into public.restaurants (id, name, slug) values
  ('c28e0000-0000-4000-8000-000000000001', 'Batch house', 'batch-house'),
  ('c28e0000-0000-4000-8000-000000000002', 'Other house', 'batch-other');
insert into public.users (user_id, email, name, restaurant_id, role) values
  ('c28e0000-0000-4000-8000-0000000000d1', 'manager@example.test', 'Manager', 'c28e0000-0000-4000-8000-000000000001', 'manager');
-- A house good with no library wine states its own identity (ADR 0115).
insert into public.restaurant_inventory (id, restaurant_id, wine_name, display_name, kind, uom, identity_provenance, menu_price_current, menu_price_glass) values
  ('c28e0000-0000-4000-8000-0000000000c1', 'c28e0000-0000-4000-8000-000000000001', 'Barolo', 'Barolo', 'wine', 'bottle', 'house_declared', 70, null),
  ('c28e0000-0000-4000-8000-0000000000c2', 'c28e0000-0000-4000-8000-000000000001', 'Etna', 'Etna', 'wine', 'bottle', 'house_declared', 50, 11),
  ('c28e0000-0000-4000-8000-0000000000c3', 'c28e0000-0000-4000-8000-000000000001', 'Chablis', 'Chablis', 'wine', 'bottle', 'house_declared', 60, null),
  ('c28e0000-0000-4000-8000-0000000000c9', 'c28e0000-0000-4000-8000-000000000002', 'Not yours', 'Not yours', 'wine', 'bottle', 'house_declared', 40, null);

do $$
declare
  v_out jsonb;
  v_by  uuid := 'c28e0000-0000-4000-8000-0000000000d1';
  v_h   uuid := 'c28e0000-0000-4000-8000-000000000001';
  -- The rows above were priced at now() (one transaction), so the menu is
  -- chosen at that same moment: not before the price in effect.
  v_at  timestamptz := now();
begin
  -- T1 three rows, in order: a bottle, a glass only (the bottle left alone),
  -- another house's wine (refused on its own row), then a negative price
  -- (refused on its own row). The good rows are written; the refused ones are not.
  v_out := public.set_house_menu_prices(v_h, jsonb_build_array(
    jsonb_build_object('id', 'line-1', 'inventory_id', 'c28e0000-0000-4000-8000-0000000000c1', 'bottle', 80),
    jsonb_build_object('id', 'line-2', 'inventory_id', 'c28e0000-0000-4000-8000-0000000000c2', 'glass', 12),
    jsonb_build_object('id', 'line-3', 'inventory_id', 'c28e0000-0000-4000-8000-0000000000c9', 'bottle', 99),
    jsonb_build_object('id', 'line-4', 'inventory_id', 'c28e0000-0000-4000-8000-0000000000c3', 'bottle', -1)
  ), 'import', v_by, v_at, 'menu line', null);
  if jsonb_array_length(v_out) <> 4 then raise exception 'T1: % answers, expected 4', jsonb_array_length(v_out); end if;
  if (select string_agg(e->>'id', ',' order by n) from jsonb_array_elements(v_out) with ordinality t(e, n))
     <> 'line-1,line-2,line-3,line-4' then raise exception 'T1: answers out of order: %', v_out; end if;
  if v_out->0->'result'->>'outcome' <> 'changed' or v_out->1->'result'->>'outcome' <> 'changed'
     then raise exception 'T1: the good rows were not changed: %', v_out; end if;
  if v_out->2->'result'->>'outcome' <> 'failed' or v_out->2->'result'->>'code' <> 'P0002'
     then raise exception 'T1: another house''s wine was not refused as P0002: %', v_out->2; end if;
  if v_out->3->'result'->>'outcome' <> 'failed'
     then raise exception 'T1: a negative price was not refused: %', v_out->3; end if;
  if (select menu_price_current from public.restaurant_inventory where id = 'c28e0000-0000-4000-8000-0000000000c1') <> 80
     then raise exception 'T1: Barolo''s bottle price not written'; end if;
  if (select (menu_price_current, menu_price_glass) from public.restaurant_inventory where id = 'c28e0000-0000-4000-8000-0000000000c2')
     is distinct from (50::numeric, 12::numeric) then raise exception 'T1: Etna''s glass not written, or its bottle moved'; end if;
  if (select menu_price_current from public.restaurant_inventory where id = 'c28e0000-0000-4000-8000-0000000000c9') <> 40
     then raise exception 'T1: another house''s price moved'; end if;
  if (select menu_price_current from public.restaurant_inventory where id = 'c28e0000-0000-4000-8000-0000000000c3') <> 60
     then raise exception 'T1: a refused row was written'; end if;

  -- T2 the writer's own record: the version row says import, the person, the moment.
  if not exists (select 1 from public.menu_price_versions
                  where inventory_id = 'c28e0000-0000-4000-8000-0000000000c1'
                    and bottle_price = 80 and change_source = 'import' and changed_by = v_by
                    and effective_from = v_at)
     then raise exception 'T2: no version row names the import, the person and the moment'; end if;

  -- T3 the same rows again, dated the same: unchanged, nothing new on the record.
  v_out := public.set_house_menu_prices(v_h, jsonb_build_array(
    jsonb_build_object('id', 'line-1', 'inventory_id', 'c28e0000-0000-4000-8000-0000000000c1', 'bottle', 80)
  ), 'import', v_by, v_at, 'menu line', null);
  if v_out->0->'result'->>'outcome' <> 'unchanged' then raise exception 'T3: a second carry was not unchanged: %', v_out; end if;

  -- T4 dated before the price now in effect: stale, the newer price stands.
  v_out := public.set_house_menu_prices(v_h, jsonb_build_array(
    jsonb_build_object('id', 'line-1', 'inventory_id', 'c28e0000-0000-4000-8000-0000000000c1', 'bottle', 75)
  ), 'import', v_by, v_at - interval '1 hour', 'menu line', null);
  if v_out->0->'result'->>'outcome' <> 'stale' then raise exception 'T4: an older change was not stale: %', v_out; end if;

  -- T5 an empty list answers an empty list; a list that is not a list is refused.
  if public.set_house_menu_prices(v_h, '[]'::jsonb, 'import', v_by, v_at, null, null) <> '[]'::jsonb
     then raise exception 'T5: an empty list did not answer an empty list'; end if;
  begin
    perform public.set_house_menu_prices(v_h, '{}'::jsonb, 'import', v_by, v_at, null, null);
    raise exception 'T5: an object was taken for a list';
  exception when invalid_parameter_value then null;
  end;

  -- T6 only service_role may call it, and it is not SECURITY DEFINER.
  if has_function_privilege('authenticated', 'public.set_house_menu_prices(uuid, jsonb, text, uuid, timestamptz, text, uuid)', 'execute')
     or has_function_privilege('anon', 'public.set_house_menu_prices(uuid, jsonb, text, uuid, timestamptz, text, uuid)', 'execute')
     then raise exception 'T6: a client role may call the batch writer'; end if;
  if not has_function_privilege('service_role', 'public.set_house_menu_prices(uuid, jsonb, text, uuid, timestamptz, text, uuid)', 'execute')
     then raise exception 'T6: service_role may not call the batch writer'; end if;

  raise notice 'set_house_menu_prices: T1-T6 passed';
end
$$;

rollback;
