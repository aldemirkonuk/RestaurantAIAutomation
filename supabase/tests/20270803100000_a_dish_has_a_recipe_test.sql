-- Migration a_dish_has_a_recipe (ADR 0366, on ADR 0360).
-- Self-asserting; run with `psql -v ON_ERROR_STOP=1 -f` on a database built
-- from supabase/migrations (pgtest.sh lane). Synthetic fixtures, one
-- transaction, rolled back. House N is u('N'); its dish u('N0d'); its drink
-- u('N0c'); its flour u('N0f').

begin;
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('ae366000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;
-- A refused call: returns its SQLSTATE, or 'none' when it was not refused.
create function pg_temp.refused(p_expected uuid, p_lines jsonb, p_house text default '1', p_dish text default '10d')
returns text language plpgsql as $$
begin
  perform public.save_dish_recipe_version(pg_temp.u(p_house), pg_temp.u(p_dish), p_expected, 1,
    null, null, null, p_lines);
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
    (pg_temp.u('1'), 'Dish test house 1', 'dish-test-house-1'),
    (pg_temp.u('2'), 'Dish test house 2', 'dish-test-house-2');
  foreach h in array array['1', '2'] loop
    insert into public.dishes (id, restaurant_id, name, price) values (pg_temp.u(h || '0d'), pg_temp.u(h), 'Lemon tart ' || h, 9.5);
    insert into public.cocktails (id, restaurant_id, name) values (pg_temp.u(h || '0c'), pg_temp.u(h), 'Sour ' || h);
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, kind, uom, display_name, identity_provenance)
    values (pg_temp.u(h || '0f'), pg_temp.u(h), null, 'food', 'kg', 'Flour ' || h, 'house_declared');
  end loop;
end $$;

-- T1. A dish saves a version through its own RPC; its lines are ADR 0360's lines.
do $$
declare r jsonb; v1 uuid;
begin
  r := public.save_dish_recipe_version(pg_temp.u('1'), pg_temp.u('10d'), null, 8, 'Bake 25 min', 'Mint', null,
    jsonb_build_array(
      jsonb_build_object('role', 'stocked', 'inventoryId', pg_temp.u('10f'), 'label', 'Flour', 'qty', 250, 'unit', 'g'),
      jsonb_build_object('role', 'stocked', 'label', 'Lemons', 'qty', 3, 'unit', 'each'),
      jsonb_build_object('role', 'untracked', 'label', 'Water', 'qty', 30, 'unit', 'ml')));
  v1 := (r ->> 'version_id')::uuid;
  assert (r ->> 'version')::int = 1, 'first dish save is version 1';
  assert (select (owner_kind, dish_id, cocktail_id, yield_serves, glass, garnish)
            from public.recipe_versions where id = v1)
       = ('dish'::text, pg_temp.u('10d'), null::uuid, 8, null::text, 'Mint'::text), 'a dish version names its dish only';
  assert (select qty_base from public.recipe_lines where version_id = v1 and position = 1) = 250000, '250 g stores 250000 mg';
  assert (select version_id from public.recipe_current_dish where dish_id = pg_temp.u('10d')) = v1, 'v1 is current';
  assert (select count(*) from public.recipe_current where version_id = v1) = 0, 'no cocktail pointer names a dish version';
end $$;

-- T2. A stale save is RCP09 and writes nothing; a fresh one is version 2.
do $$
declare v1 uuid; n_before int; r jsonb;
begin
  v1 := (select version_id from public.recipe_current_dish where dish_id = pg_temp.u('10d'));
  n_before := (select count(*) from public.recipe_versions where dish_id = pg_temp.u('10d'));
  assert pg_temp.refused(null, '[{"role":"untracked","label":"Salt","qty":1,"unit":"g"}]') = 'RCP09', 'stale save refused';
  assert (select count(*) from public.recipe_versions where dish_id = pg_temp.u('10d')) = n_before, 'stale save wrote nothing';
  r := public.save_dish_recipe_version(pg_temp.u('1'), pg_temp.u('10d'), v1, 8, null, null, null,
    '[{"role":"untracked","label":"Salt","qty":1,"unit":"g"}]');
  assert (r ->> 'version')::int = 2, 'second save is version 2';
  assert (select version_id from public.recipe_current_dish where dish_id = pg_temp.u('10d')) = (r ->> 'version_id')::uuid,
    'the pointer moved';
end $$;

-- T3. Tenancy: another house's dish, another house's item, a deleted dish.
do $$
declare v uuid;
begin
  v := (select version_id from public.recipe_current_dish where dish_id = pg_temp.u('10d'));
  assert pg_temp.refused(null, '[{"role":"untracked","label":"Salt","qty":1,"unit":"g"}]', '1', '20d') = 'RCP00',
    'house 1 cannot save house 2''s dish';
  assert pg_temp.refused(v, jsonb_build_array(jsonb_build_object('role', 'stocked', 'inventoryId', pg_temp.u('20f'),
    'label', 'Flour', 'qty', 1, 'unit', 'kg'))) = 'RCP00', 'a line cannot link house 2''s flour';
  update public.dishes set deleted_at = now() where id = pg_temp.u('20d');
  assert pg_temp.refused(null, '[{"role":"untracked","label":"Salt","qty":1,"unit":"g"}]', '2', '20d') = 'RCP00',
    'a deleted dish takes no recipe';
  update public.dishes set deleted_at = null where id = pg_temp.u('20d');
  -- A writer that skips the RPC still cannot put house 2's dish under house 1.
  assert pg_temp.sql_refused(format(
    'insert into public.recipe_versions (restaurant_id, owner_kind, dish_id, version) values (%L, ''dish'', %L, 99)',
    pg_temp.u('1'), pg_temp.u('20d'))) = '23503', 'the same-house FK refuses a cross-house dish version';
end $$;

-- T4. One owner per version, and owner_kind says which.
do $$
begin
  assert pg_temp.sql_refused(format(
    'insert into public.recipe_versions (restaurant_id, owner_kind, cocktail_id, dish_id, version) values (%L, ''dish'', %L, %L, 50)',
    pg_temp.u('1'), pg_temp.u('10c'), pg_temp.u('10d'))) = '23514', 'a version cannot have two owners';
  assert pg_temp.sql_refused(format(
    'insert into public.recipe_versions (restaurant_id, owner_kind, version) values (%L, ''dish'', 51)',
    pg_temp.u('1'))) = '23514', 'a dish version needs its dish';
  assert pg_temp.sql_refused(format(
    'insert into public.recipe_versions (restaurant_id, owner_kind, dish_id, version) values (%L, ''cocktail'', %L, 52)',
    pg_temp.u('1'), pg_temp.u('10d'))) = '23514', 'a cocktail version cannot name a dish';
  assert pg_temp.sql_refused(format(
    'insert into public.recipe_versions (restaurant_id, owner_kind, dish_id, version) values (%L, ''prep'', %L, 53)',
    pg_temp.u('1'), pg_temp.u('10d'))) = '23514', 'prep is not an owner kind yet';
end $$;

-- T5. The cocktail path is unchanged: its RPC still saves and points recipe_current.
do $$
declare r jsonb;
begin
  r := public.save_recipe_version(pg_temp.u('1'), pg_temp.u('10c'), null, 1, null, 'Coupe', null, null,
    '[{"role":"untracked","label":"Lemon juice","qty":25,"unit":"ml"}]');
  assert (select (owner_kind, cocktail_id, dish_id) from public.recipe_versions where id = (r ->> 'version_id')::uuid)
       = ('cocktail'::text, pg_temp.u('10c'), null::uuid), 'a cocktail version names its cocktail only';
  assert (select version_id from public.recipe_current where cocktail_id = pg_temp.u('10c')) = (r ->> 'version_id')::uuid,
    'the cocktail pointer is set';
end $$;

-- T6. Line rules hold for a dish exactly as for a drink.
do $$
declare v uuid;
begin
  v := (select version_id from public.recipe_current_dish where dish_id = pg_temp.u('10d'));
  assert pg_temp.refused(v, '[]') = 'RCP00', 'no lines refused';
  assert pg_temp.refused(v, '[{"role":"stocked","label":"Flour","qty":0,"unit":"g"}]') = 'RCP00', 'zero refused';
  assert pg_temp.refused(v, '[{"role":"stocked","label":"Flour","qty":1,"unit":"cup"}]') = 'RCP00', 'unknown unit refused';
  assert pg_temp.refused(v, '[{"role":"stocked","label":"  ","qty":1,"unit":"g"}]') = 'RCP00', 'blank name refused';
  assert pg_temp.refused(v, '["flour"]') = 'RCP00', 'a line that is not an object refused';
  assert pg_temp.refused(v, (select jsonb_agg(jsonb_build_object('role', 'untracked', 'label', 'x' || i, 'qty', 1, 'unit', 'g'))
    from generate_series(1, 41) i)) = 'RCP00', '41 lines refused';
  assert (select version_id from public.recipe_current_dish where dish_id = pg_temp.u('10d')) = v, 'no refusal moved the pointer';
end $$;

-- T7. Append-only: a saved dish version is kept as it was.
do $$
declare v uuid;
begin
  v := (select version_id from public.recipe_current_dish where dish_id = pg_temp.u('10d'));
  assert pg_temp.sql_refused(format('update public.recipe_versions set method = ''x'' where id = %L', v)) = '23001',
    'a dish version cannot be edited';
  assert pg_temp.sql_refused(format('delete from public.recipe_lines where version_id = %L', v)) = '23001',
    'a dish line cannot be deleted';
  assert pg_temp.sql_refused(format('delete from public.dishes where id = %L', pg_temp.u('10d'))) = '23503',
    'a dish with a recipe cannot be hard-deleted';
end $$;

-- T8. One live dish per name in a house, folded; another house may share it.
do $$
begin
  assert pg_temp.sql_refused(format('insert into public.dishes (restaurant_id, name) values (%L, ''  lemon   TART 1 '')',
    pg_temp.u('1'))) = '23505', 'the same name twice in one house is refused';
  assert pg_temp.sql_refused(format('insert into public.dishes (restaurant_id, name) values (%L, ''Lemon tart 1'')',
    pg_temp.u('2'))) = 'none', 'another house may use the name';
  assert pg_temp.sql_refused(format('insert into public.dishes (restaurant_id, name, price) values (%L, ''Neg'', -1)',
    pg_temp.u('1'))) = '23514', 'a negative price is refused';
end $$;

-- T9. Clients hold no grant; the house-read policy exists for both new tables.
do $$
begin
  assert not has_table_privilege('authenticated', 'public.dishes', 'SELECT'), 'authenticated has no grant on dishes';
  assert not has_table_privilege('anon', 'public.recipe_current_dish', 'SELECT'), 'anon has no grant on the pointer';
  assert not has_function_privilege('authenticated',
    'public.save_dish_recipe_version(uuid, uuid, uuid, integer, text, text, uuid, jsonb)', 'EXECUTE'),
    'authenticated cannot call the dish RPC';
  assert (select count(*) from pg_policies where tablename in ('dishes', 'recipe_current_dish')
            and policyname like '%_house_read') = 2, 'both tables state who may read';
end $$;

rollback;
