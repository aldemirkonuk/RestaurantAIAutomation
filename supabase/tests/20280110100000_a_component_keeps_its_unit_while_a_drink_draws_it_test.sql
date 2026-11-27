-- Migration a_component_keeps_its_unit_while_a_drink_draws_it (r109 drinks fixer).
-- Self-asserting; run with `psql -v ON_ERROR_STOP=1 -f` on a database built from
-- supabase/migrations. Synthetic fixtures, one transaction, rolled back. House 1
-- is u('1'); its drink u('10c'), its plated dish u('10d'), its component u('11a').
-- Serial only: the two-session race is argued from the locks, not reproduced here.

begin;
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('b1090000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;
create function pg_temp.sql_refused(p_sql text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute p_sql;
  return 'none';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || ':' || coalesce(v_hint, '');
end $$;
create function pg_temp.made(p_qty numeric default 30) returns jsonb language sql as $$
  select jsonb_build_object('role', 'made', 'componentId', pg_temp.u('11a'), 'label', 'House syrup', 'qty', p_qty, 'unit', 'ml')
$$;

do $$
begin
  insert into public.restaurants (id, name, slug) values (pg_temp.u('1'), 'Unit test house 1', 'unit-test-house-1');
  insert into public.cocktails (id, restaurant_id, name) values (pg_temp.u('10c'), pg_temp.u('1'), 'Sour Test');
  insert into public.dishes (id, restaurant_id, name) values (pg_temp.u('10d'), pg_temp.u('1'), 'Tart Test');
  insert into public.dishes (id, restaurant_id, name, yield_qty_base, yield_base_unit)
  values (pg_temp.u('11a'), pg_temp.u('1'), 'Simple syrup', 7000, 'ml10');
end $$;

-- C1. Nothing draws the component yet: grams is allowed, and back to ml.
do $$
begin
  update public.dishes set yield_qty_base = 500000, yield_base_unit = 'mg' where id = pg_temp.u('11a');
  update public.dishes set yield_qty_base = 7000, yield_base_unit = 'ml10' where id = pg_temp.u('11a');
  assert (select yield_base_unit from public.dishes where id = pg_temp.u('11a')) = 'ml10', 'back to ml';
end $$;

-- C2. A live drink draws it in ml: a change of kind is refused, a rescale is not.
do $$
declare r jsonb;
begin
  r := public.save_recipe_version(pg_temp.u('1'), pg_temp.u('10c'), null, 1, null, null, null, null, jsonb_build_array(pg_temp.made(30)));
  assert pg_temp.sql_refused(format('update public.dishes set yield_qty_base = 500000, yield_base_unit = %L where id = %L', 'mg', pg_temp.u('11a')))
    = 'RCP00:component_unit_in_use', 'grams is refused while a live drink draws it';
  assert (select yield_base_unit from public.dishes where id = pg_temp.u('11a')) = 'ml10', 'the unit did not move';
  update public.dishes set yield_qty_base = 14000 where id = pg_temp.u('11a');
  update public.dishes set yield_qty_base = 3500, yield_base_unit = 'ml10' where id = pg_temp.u('11a');
  assert (select yield_qty_base from public.dishes where id = pg_temp.u('11a')) = 3500, 'a rescale in the same unit is allowed';
end $$;

-- C3. A line is written in the unit the component is made in, or refused as it is stored.
do $$
declare v uuid := (select version_id from public.recipe_current where cocktail_id = pg_temp.u('10c'));
begin
  assert pg_temp.sql_refused(format(
    'insert into public.recipe_lines (version_id, restaurant_id, position, role, component_dish_id, label, qty_entered, unit_code, qty_base, base_unit) values (%L, %L, 9, %L, %L, %L, 30, %L, 30000, %L)',
    v, pg_temp.u('1'), 'made', pg_temp.u('11a'), 'House syrup', 'g', 'mg')) = 'RCP00:component_unit', 'a gram line against a ml component is refused';
  assert (select count(*) from public.recipe_lines where version_id = v) = 1, 'nothing was written';
end $$;

-- C4. The drink is retired (a soft delete, its pointer stays): it no longer holds the unit.
do $$
begin
  update public.cocktails set deleted_at = now() where id = pg_temp.u('10c');
  update public.dishes set yield_qty_base = 500000, yield_base_unit = 'mg' where id = pg_temp.u('11a');
  assert (select yield_base_unit from public.dishes where id = pg_temp.u('11a')) = 'mg', 'a retired drink does not hold the unit';
end $$;

-- C5. A plated dish whose current version draws it holds the unit; an old version alone does not.
do $$
declare r jsonb;
begin
  update public.dishes set yield_qty_base = 7000, yield_base_unit = 'ml10' where id = pg_temp.u('11a');
  r := public.save_dish_recipe_version(pg_temp.u('1'), pg_temp.u('10d'), null, 1, null, null, null, jsonb_build_array(pg_temp.made(30)));
  assert pg_temp.sql_refused(format('update public.dishes set yield_qty_base = 500000, yield_base_unit = %L where id = %L', 'mg', pg_temp.u('11a')))
    = 'RCP00:component_unit_in_use', 'a live dish holds the unit';
  perform public.save_dish_recipe_version(pg_temp.u('1'), pg_temp.u('10d'), (r ->> 'version_id')::uuid, 1, null, null, null,
    jsonb_build_array(jsonb_build_object('role', 'untracked', 'label', 'Water', 'qty', 10, 'unit', 'ml')));
  update public.dishes set yield_qty_base = 500000, yield_base_unit = 'mg' where id = pg_temp.u('11a');
  assert (select yield_base_unit from public.dishes where id = pg_temp.u('11a')) = 'mg', 'an old version alone does not hold it';
end $$;

rollback;
