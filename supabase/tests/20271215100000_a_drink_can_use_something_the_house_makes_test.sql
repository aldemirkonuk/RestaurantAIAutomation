-- Migration a_drink_can_use_something_the_house_makes (r104 drinks need 1, ADR 0371).
-- Self-asserting; run with `psql -v ON_ERROR_STOP=1 -f` on a database built from
-- supabase/migrations. Synthetic fixtures, one transaction, rolled back. House N
-- is u('N'); its drink u('N0c'); its components u('N1a'), u('N1b'), u('N1c'), u('N1d').

begin;
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('b1040000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;
create function pg_temp.drink_refused(p_lines jsonb, p_house text default '1') returns text language plpgsql as $$
begin
  perform public.save_recipe_version(pg_temp.u(p_house), pg_temp.u(p_house || '0c'),
    (select version_id from public.recipe_current where cocktail_id = pg_temp.u(p_house || '0c')), 1, null, null, null, null, p_lines);
  return 'none';
exception when others then
  return sqlstate;
end $$;
create function pg_temp.component_refused(p_dish text, p_expected uuid, p_lines jsonb) returns text language plpgsql as $$
begin
  perform public.save_dish_recipe_version(pg_temp.u('1'), pg_temp.u(p_dish), p_expected, 1, null, null, null, p_lines);
  return 'none';
exception when others then
  return sqlstate;
end $$;
create function pg_temp.made(p_component text, p_qty numeric default 10, p_unit text default 'ml') returns jsonb language sql as $$
  select jsonb_build_object('role', 'made', 'componentId', pg_temp.u(p_component), 'label', 'House syrup', 'qty', p_qty, 'unit', p_unit)
$$;

do $$
declare h text; c text;
begin
  insert into public.restaurants (id, name, slug) values
    (pg_temp.u('1'), 'Made test house 1', 'made-test-house-1'),
    (pg_temp.u('2'), 'Made test house 2', 'made-test-house-2');
  foreach h in array array['1', '2'] loop
    insert into public.cocktails (id, restaurant_id, name) values (pg_temp.u(h || '0c'), pg_temp.u(h), 'Daiquiri ' || h);
    foreach c in array array['a', 'b', 'c', 'd'] loop
      insert into public.dishes (id, restaurant_id, name, yield_qty_base, yield_base_unit)
      values (pg_temp.u(h || '1' || c), pg_temp.u(h), 'Component ' || c || h, 7000, 'ml10');
    end loop;
    insert into public.dishes (id, restaurant_id, name) values (pg_temp.u(h || '2e'), pg_temp.u(h), 'Plated dish ' || h);
  end loop;
end $$;

-- M1. A drink keeps a made line: its role, the component it draws, and the amount in the base unit.
do $$
declare r jsonb; v uuid;
begin
  r := public.save_recipe_version(pg_temp.u('1'), pg_temp.u('10c'), null, 1, null, null, null, null,
    jsonb_build_array(pg_temp.made('11a', 40, 'ml'),
      jsonb_build_object('role', 'untracked', 'label', 'Ice', 'qty', 1, 'unit', 'each')));
  v := (r ->> 'version_id')::uuid;
  assert (select role from public.recipe_lines where version_id = v and position = 1) = 'made', 'the line is made';
  assert (select component_dish_id from public.recipe_lines where version_id = v and position = 1) = pg_temp.u('11a'), 'it names its component';
  assert (select qty_base from public.recipe_lines where version_id = v and position = 1) = 400, '40 ml is 400 ml10';
  assert (select inventory_id from public.recipe_lines where version_id = v and position = 1) is null, 'a made line has no shelf item';
  assert ((r -> 'lines' -> 0) ->> 'componentId')::uuid = pg_temp.u('11a'), 'the saved line says its component';
end $$;

-- M2. What a made line may not be: each is refused, and nothing is written.
do $$
declare n_before bigint := (select count(*) from public.recipe_versions);
begin
  assert pg_temp.drink_refused(jsonb_build_array(pg_temp.made('11a', 40, 'g'))) = 'RCP00', 'grams against a component made in ml';
  assert pg_temp.drink_refused(jsonb_build_array(pg_temp.made('22e', 40))) = 'RCP00', 'a plated dish is not a component';
  assert pg_temp.drink_refused(jsonb_build_array(pg_temp.made('21a', 40))) = 'RCP00', 'another house''s component';
  assert pg_temp.drink_refused(jsonb_build_array(jsonb_build_object('role', 'made', 'label', 'Syrup', 'qty', 10, 'unit', 'ml'))) = 'RCP00', 'a made line names its component';
  assert pg_temp.drink_refused(jsonb_build_array(jsonb_set(pg_temp.made('11a'), '{inventoryId}', to_jsonb(pg_temp.u('1f')::text)))) = 'RCP00', 'a made line is not a shelf link';
  assert pg_temp.drink_refused(jsonb_build_array(jsonb_set(pg_temp.made('11a'), '{usablePct}', '50'))) = 'RCP00', 'a made line has no usable share';
  assert (select count(*) from public.recipe_versions) = n_before, 'nothing was written';
end $$;

-- M3. The table's own CHECKs, whatever the function does.
do $$
declare v uuid := (select version_id from public.recipe_current where cocktail_id = pg_temp.u('10c'));
begin
  begin
    insert into public.recipe_lines (version_id, restaurant_id, position, role, label, qty_entered, unit_code, qty_base, base_unit)
    values (v, pg_temp.u('1'), 9, 'made', 'No component', 1, 'ml', 10, 'ml10');
    assert false, 'a made line with no component got in';
  exception when check_violation then null; end;
  begin
    insert into public.recipe_lines (version_id, restaurant_id, position, role, component_dish_id, label, qty_entered, unit_code, qty_base, base_unit)
    values (v, pg_temp.u('1'), 9, 'untracked', pg_temp.u('11a'), 'Ice', 1, 'ml', 10, 'ml10');
    assert false, 'a component on a non-made line got in';
  exception when check_violation then null; end;
  begin
    update public.dishes set yield_qty_base = null where id = pg_temp.u('11a');
    assert false, 'a yield without its unit got in';
  exception when check_violation then null; end;
end $$;

-- M4. A component cannot contain itself or lead back to itself.
do $$
declare r jsonb;
begin
  assert pg_temp.component_refused('11a', null, jsonb_build_array(pg_temp.made('11a'))) = 'RCP00', 'a component in itself';
  r := public.save_dish_recipe_version(pg_temp.u('1'), pg_temp.u('11b'), null, 1, null, null, null, jsonb_build_array(pg_temp.made('11a')));
  assert (r ->> 'version')::int = 1, 'b may use a';
  assert pg_temp.component_refused('11a', null, jsonb_build_array(pg_temp.made('11b'))) = 'RCP00', 'a in b in a is a loop';
end $$;

-- M5. Three levels under a drink is allowed, four is not (checked where the drink uses it).
do $$
declare r jsonb;
begin
  -- c uses d, b uses c (b already uses a), so a drink using b has b, c, d: three.
  perform public.save_dish_recipe_version(pg_temp.u('1'), pg_temp.u('11c'), null, 1, null, null, null, jsonb_build_array(pg_temp.made('11d')));
  perform public.save_dish_recipe_version(pg_temp.u('1'), pg_temp.u('11b'),
    (select version_id from public.recipe_current_dish where dish_id = pg_temp.u('11b')), 1, null, null, null, jsonb_build_array(pg_temp.made('11c')));
  r := public.save_recipe_version(pg_temp.u('1'), pg_temp.u('10c'),
    (select version_id from public.recipe_current where cocktail_id = pg_temp.u('10c')), 1, null, null, null, null, jsonb_build_array(pg_temp.made('11b')));
  assert (r ->> 'version')::int = 2, 'b, c, d under a drink is three levels';
  -- d may use a (nothing looks upward), but then b, c, d, a is four under a drink using b.
  perform public.save_dish_recipe_version(pg_temp.u('1'), pg_temp.u('11d'), null, 1, null, null, null, jsonb_build_array(pg_temp.made('11a')));
  assert pg_temp.drink_refused(jsonb_build_array(pg_temp.made('11b'))) = 'RCP00', 'four levels under a drink is refused';
  assert (public.save_recipe_version(pg_temp.u('1'), pg_temp.u('10c'),
    (select version_id from public.recipe_current where cocktail_id = pg_temp.u('10c')), 1, null, null, null, null, jsonb_build_array(pg_temp.made('11c'))) ->> 'version')::int = 3,
    'c, d, a is three and is allowed';
end $$;

rollback;
