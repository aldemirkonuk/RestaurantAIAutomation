-- Migration a_recipe_line_says_how_much_is_usable (r28 recipes audit, gap 5).
-- Self-asserting; run with `psql -v ON_ERROR_STOP=1 -f` on a database built
-- from supabase/migrations (pgtest.sh lane). Synthetic fixtures, one
-- transaction, rolled back. House N is u('N'); its dish u('N0d'); its drink
-- u('N0c'); its salmon u('N0f').

begin;
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('ae5c0000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;
create function pg_temp.dish_refused(p_expected uuid, p_lines jsonb) returns text language plpgsql as $$
begin
  perform public.save_dish_recipe_version(pg_temp.u('1'), pg_temp.u('10d'), p_expected, 1, null, null, null, p_lines);
  return 'none';
exception when others then
  return sqlstate;
end $$;
create function pg_temp.drink_refused(p_expected uuid, p_lines jsonb, p_house text default '1', p_yield int default 1)
returns text language plpgsql as $$
begin
  perform public.save_recipe_version(pg_temp.u(p_house), pg_temp.u('10c'), p_expected, p_yield, null, null, null, null, p_lines);
  return 'none';
exception when others then
  return sqlstate;
end $$;
create function pg_temp.sql_refused(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'none';
exception when others then
  return sqlstate;
end $$;

do $$
declare h text;
begin
  insert into public.restaurants (id, name, slug) values
    (pg_temp.u('1'), 'Usable test house 1', 'usable-test-house-1'),
    (pg_temp.u('2'), 'Usable test house 2', 'usable-test-house-2');
  foreach h in array array['1', '2'] loop
    insert into public.dishes (id, restaurant_id, name, price) values (pg_temp.u(h || '0d'), pg_temp.u(h), 'Salmon ' || h, 30);
    insert into public.cocktails (id, restaurant_id, name) values (pg_temp.u(h || '0c'), pg_temp.u(h), 'Sour ' || h);
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, kind, uom, display_name, identity_provenance)
    values (pg_temp.u(h || '0f'), pg_temp.u(h), null, 'food', 'kg', 'Salmon ' || h, 'house_declared');
  end loop;
end $$;

-- U1. A dish line keeps its usable share; 100, null and absent are all of it (NULL).
do $$
declare r jsonb; v uuid;
begin
  r := public.save_dish_recipe_version(pg_temp.u('1'), pg_temp.u('10d'), null, 1, null, null, null,
    jsonb_build_array(
      jsonb_build_object('role', 'stocked', 'inventoryId', pg_temp.u('10f'), 'label', 'Salmon fillet', 'qty', 180, 'unit', 'g', 'usablePct', 45),
      jsonb_build_object('role', 'stocked', 'inventoryId', pg_temp.u('10f'), 'label', 'Salmon skin', 'qty', 10, 'unit', 'g', 'usablePct', 100),
      jsonb_build_object('role', 'stocked', 'label', 'Dill', 'qty', 2, 'unit', 'g', 'usablePct', null),
      jsonb_build_object('role', 'stocked', 'label', 'Lemon', 'qty', 1, 'unit', 'each', 'usablePct', 37.5),
      jsonb_build_object('role', 'untracked', 'label', 'Water', 'qty', 30, 'unit', 'ml')));
  v := (r ->> 'version_id')::uuid;
  assert (select usable_pct from public.recipe_lines where version_id = v and position = 1) = 45, '45 is kept';
  assert (select usable_pct from public.recipe_lines where version_id = v and position = 2) is null, '100 is kept as all of it';
  assert (select usable_pct from public.recipe_lines where version_id = v and position = 3) is null, 'null is all of it';
  assert (select usable_pct from public.recipe_lines where version_id = v and position = 4) = 37.5, '37.5 is kept';
  assert (select usable_pct from public.recipe_lines where version_id = v and position = 5) is null, 'absent is all of it';
  assert ((r -> 'lines' -> 0) ->> 'usablePct')::numeric = 45, 'the saved line says its share';
  assert (r -> 'lines' -> 1 -> 'usablePct') = 'null'::jsonb, 'a whole line says null';
end $$;

-- U2. A drink line keeps it too: the cocktail save writes through the same rules.
do $$
declare r jsonb; v uuid;
begin
  r := public.save_recipe_version(pg_temp.u('1'), pg_temp.u('10c'), null, 1, 'Shake', null, null, null,
    jsonb_build_array(
      jsonb_build_object('role', 'stocked', 'label', 'Lime juice', 'qty', 30, 'unit', 'ml', 'usablePct', 40),
      jsonb_build_object('role', 'untracked', 'label', 'Ice', 'qty', 1, 'unit', 'each')));
  v := (r ->> 'version_id')::uuid;
  assert (r ->> 'version')::int = 1, 'the first drink save is version 1';
  assert (select usable_pct from public.recipe_lines where version_id = v and position = 1) = 40, 'a drink line keeps 40';
  assert (select version_id from public.recipe_current where cocktail_id = pg_temp.u('10c')) = v, 'the drink pointer moved';
  assert (select method from public.recipe_versions where id = v) = 'Shake', 'the drink version keeps its method';
end $$;

-- U3. A share out of bounds, finer than a hundredth, or not a number is refused
--     on either save, and nothing is written.
do $$
declare v_dish uuid; v_drink uuid; n int; bad jsonb;
begin
  v_dish := (select version_id from public.recipe_current_dish where dish_id = pg_temp.u('10d'));
  v_drink := (select version_id from public.recipe_current where cocktail_id = pg_temp.u('10c'));
  n := (select count(*) from public.recipe_versions where restaurant_id = pg_temp.u('1'));
  foreach bad in array array['0.5'::jsonb, '0'::jsonb, '-10'::jsonb, '101'::jsonb, '45.555'::jsonb, '"45"'::jsonb, 'true'::jsonb] loop
    assert pg_temp.dish_refused(v_dish, jsonb_build_array(
      jsonb_build_object('role', 'stocked', 'label', 'Salmon', 'qty', 180, 'unit', 'g', 'usablePct', bad))) = 'RCP00',
      format('dish: %s is refused', bad);
    assert pg_temp.drink_refused(v_drink, jsonb_build_array(
      jsonb_build_object('role', 'stocked', 'label', 'Lime', 'qty', 30, 'unit', 'ml', 'usablePct', bad))) = 'RCP00',
      format('drink: %s is refused', bad);
  end loop;
  assert (select count(*) from public.recipe_versions where restaurant_id = pg_temp.u('1')) = n, 'a refused share wrote no version';
  -- The bounds themselves are kept: 1 and 99.99.
  assert pg_temp.dish_refused(v_dish, jsonb_build_array(
    jsonb_build_object('role', 'stocked', 'label', 'Salmon', 'qty', 180, 'unit', 'g', 'usablePct', 1),
    jsonb_build_object('role', 'stocked', 'label', 'Salmon', 'qty', 180, 'unit', 'g', 'usablePct', 99.99))) = 'none',
    '1 and 99.99 are kept';
end $$;

-- U4. A line that is not counted has no share; 100 on it is all of it.
do $$
declare v_dish uuid;
begin
  v_dish := (select version_id from public.recipe_current_dish where dish_id = pg_temp.u('10d'));
  assert pg_temp.dish_refused(v_dish, '[{"role":"untracked","label":"Parsley","qty":2,"unit":"g","usablePct":50}]') = 'RCP00',
    'an untracked line with a share is refused';
  assert pg_temp.dish_refused(v_dish, '[{"role":"untracked","label":"Parsley","qty":2,"unit":"g","usablePct":100}]') = 'none',
    'an untracked line at 100 is all of it';
end $$;

-- U5. The table holds the rule without the function.
do $$
declare v uuid;
begin
  v := (select version_id from public.recipe_current_dish where dish_id = pg_temp.u('10d'));
  assert pg_temp.sql_refused(format(
    'insert into public.recipe_lines (version_id, restaurant_id, position, role, label, qty_entered, unit_code, qty_base, base_unit, usable_pct) '
    'values (%L, %L, 90, ''stocked'', ''x'', 1, ''g'', 1000, ''mg'', 100)', v, pg_temp.u('1'))) = '23514',
    '100 is never stored: all of it is NULL';
  assert pg_temp.sql_refused(format(
    'insert into public.recipe_lines (version_id, restaurant_id, position, role, label, qty_entered, unit_code, qty_base, base_unit, usable_pct) '
    'values (%L, %L, 91, ''untracked'', ''x'', 1, ''g'', 1000, ''mg'', 50)', v, pg_temp.u('1'))) = '23514',
    'an untracked line holds no share';
end $$;

-- U6. The cocktail save keeps its own refusals and their order.
do $$
declare v_drink uuid; n int;
begin
  v_drink := (select version_id from public.recipe_current where cocktail_id = pg_temp.u('10c'));
  n := (select count(*) from public.recipe_versions where cocktail_id = pg_temp.u('10c'));
  assert pg_temp.drink_refused(null, '[{"role":"untracked","label":"Ice","qty":1,"unit":"each"}]') = 'RCP09', 'stale is RCP09';
  assert pg_temp.drink_refused(v_drink, '[{"role":"untracked","label":"Ice","qty":1,"unit":"each"}]', '2') = 'RCP00',
    'another house''s drink is refused';
  assert pg_temp.drink_refused(v_drink, '[{"role":"untracked","label":"Ice","qty":1,"unit":"each"}]', '1', 0) = 'RCP00',
    'no serve is refused';
  assert pg_temp.drink_refused(v_drink, '[]') = 'RCP00', 'no line is refused';
  assert pg_temp.drink_refused(v_drink, (select jsonb_agg(jsonb_build_object('role', 'untracked', 'label', 'x' || g, 'qty', 1, 'unit', 'g'))
                                            from generate_series(1, 41) g)) = 'RCP00', '41 lines are refused';
  assert pg_temp.drink_refused(v_drink, jsonb_build_array(
    jsonb_build_object('role', 'stocked', 'inventoryId', pg_temp.u('20f'), 'label', 'Their salmon', 'qty', 1, 'unit', 'g'))) = 'RCP00',
    'a good of another house is refused';
  assert (select count(*) from public.recipe_versions where cocktail_id = pg_temp.u('10c')) = n, 'no refused drink save wrote a version';
end $$;

rollback;
