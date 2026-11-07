-- Migration a_recipe_is_a_versioned_list_of_house_items (ADR 0360).
-- Self-asserting; run with `psql -v ON_ERROR_STOP=1 -f` on a database built
-- from supabase/migrations (pgtest.sh lane). Synthetic fixtures, one
-- transaction, rolled back. House N is u('N'); its drink u('N0c'); gin u('N0a'); user of house N u('eeN').

begin;
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('ae360000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;
-- A refused call: returns its SQLSTATE, or 'none' when it was not refused.
create function pg_temp.refused(p_expected uuid, p_lines jsonb, p_house text default '1', p_drink text default '10c')
returns text language plpgsql as $$
begin
  perform public.save_recipe_version(pg_temp.u(p_house), pg_temp.u(p_drink), p_expected, 1,
    null, null, null, null, p_lines);
  return 'none';
exception when others then
  return sqlstate;
end $$;

do $$
declare h text;
begin
  insert into public.restaurants (id, name, slug) values
    (pg_temp.u('1'), 'Recipe test house 1', 'recipe-test-house-1'),
    (pg_temp.u('2'), 'Recipe test house 2', 'recipe-test-house-2');
  foreach h in array array['1', '2'] loop
    insert into public.cocktails (id, restaurant_id, name) values (pg_temp.u(h || '0c'), pg_temp.u(h), 'Negroni ' || h);
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, kind, uom, display_name, identity_provenance, bottle_size_ml)
    values (pg_temp.u(h || '0a'), pg_temp.u(h), null, 'spirit', 'bottle', 'Gin ' || h, 'house_declared', 700);
  end loop;
  insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, kind, uom, display_name, identity_provenance, is_active)
  values (pg_temp.u('10b'), pg_temp.u('1'), null, 'food', 'each', 'Old lime', 'house_declared', false);
  insert into public.cocktails (id, restaurant_id, name) values (pg_temp.u('90c'), null, 'Corpus drink');
end $$;

-- T1. Units become integers here, half-up to a tenth of a ml.
do $$
declare r jsonb; v1 uuid; n int;
begin
  r := public.save_recipe_version(pg_temp.u('1'), pg_temp.u('10c'), null, 1, 'Stir', 'Rocks', 'Orange', null,
    jsonb_build_array(
      jsonb_build_object('role', 'stocked', 'inventoryId', pg_temp.u('10a'), 'label', 'Gin', 'qty', 1.5, 'unit', 'oz'),
      jsonb_build_object('role', 'untracked', 'label', 'Bitters', 'qty', 2, 'unit', 'dash'),
      jsonb_build_object('role', 'stocked', 'label', 'Vermouth', 'qty', 22.5, 'unit', 'ml'),
      jsonb_build_object('role', 'untracked', 'label', 'Orange peel', 'qty', 1, 'unit', 'each')));
  v1 := (r ->> 'version_id')::uuid;
  assert (r ->> 'version')::int = 1, 'first save is version 1';
  assert (select qty_base from public.recipe_lines where version_id = v1 and position = 1) = 444, '1.5 oz stores 444 ml10';
  assert (select qty_base from public.recipe_lines where version_id = v1 and position = 2) = 20, '2 dash stores 20';
  assert (select qty_base from public.recipe_lines where version_id = v1 and position = 3) = 225, '22.5 ml stores 225';
  assert (select (qty_base, base_unit) from public.recipe_lines where version_id = v1 and position = 4) = (1000::bigint, 'each_milli'::text),
    '1 each stores 1000 each_milli';
  assert (select inventory_id is null and role = 'stocked' from public.recipe_lines where version_id = v1 and position = 3),
    'a stocked line may wait unlinked';
  assert (select version_id from public.recipe_current where cocktail_id = pg_temp.u('10c')) = v1, 'v1 is current';
  -- Two lines may name the same item.
  r := public.save_recipe_version(pg_temp.u('1'), pg_temp.u('10c'), v1, 2, null, null, null, null,
    jsonb_build_array(
      jsonb_build_object('role', 'stocked', 'inventoryId', pg_temp.u('10a'), 'label', 'Gin', 'qty', 30, 'unit', 'ml'),
      jsonb_build_object('role', 'stocked', 'inventoryId', pg_temp.u('10a'), 'label', 'Gin float', 'qty', 1, 'unit', 'cl')));
  assert (r ->> 'version')::int = 2, 'second save is version 2';
  select count(*) into n from public.recipe_lines where version_id = v1;
  assert n = 4, 'v1 keeps its four lines';
end $$;

-- T2. Refusals write nothing.
do $$
declare cur uuid; nv bigint; nl bigint;
begin
  select version_id into cur from public.recipe_current where cocktail_id = pg_temp.u('10c');
  select count(*) into nv from public.recipe_versions;
  select count(*) into nl from public.recipe_lines;
  assert pg_temp.refused(cur, jsonb_build_array(jsonb_build_object('role', 'untracked', 'inventoryId', pg_temp.u('10a'),
    'label', 'Gin', 'qty', 30, 'unit', 'ml'))) = 'RCP00', 'an untracked line with an item is refused';
  assert pg_temp.refused(cur, jsonb_build_array(jsonb_build_object('role', 'stocked', 'inventoryId', pg_temp.u('20a'),
    'label', 'Gin', 'qty', 30, 'unit', 'ml'))) = 'RCP00', 'another house''s item is refused';
  assert pg_temp.refused(cur, jsonb_build_array(jsonb_build_object('role', 'stocked', 'inventoryId', pg_temp.u('10b'),
    'label', 'Lime', 'qty', 1, 'unit', 'each'))) = 'RCP00', 'a soft-deleted item cannot be linked';
  assert pg_temp.refused(cur, jsonb_build_array(jsonb_build_object('role', 'stocked', 'label', 'Gin', 'qty', 30, 'unit', 'shot')))
    = 'RCP00', 'an unknown unit is refused';
  assert pg_temp.refused(cur, jsonb_build_array(jsonb_build_object('role', 'stocked', 'label', 'Gin', 'qty', 0, 'unit', 'ml')))
    = 'RCP00', 'qty 0 is refused';
  assert pg_temp.refused(cur, '[]'::jsonb) = 'RCP00', 'no lines is refused';
  assert pg_temp.refused(cur, (select jsonb_agg(jsonb_build_object('role', 'untracked', 'label', 'Ice', 'qty', 1, 'unit', 'each'))
    from generate_series(1, 41))) = 'RCP00', '41 lines is refused';
  assert pg_temp.refused(null, jsonb_build_array(jsonb_build_object('role', 'untracked', 'label', 'Ice', 'qty', 1, 'unit', 'each')),
    '1', '90c') = 'RCP00', 'a corpus drink (no house) is refused';
  assert pg_temp.refused(null, jsonb_build_array(jsonb_build_object('role', 'untracked', 'label', 'Ice', 'qty', 1, 'unit', 'each')),
    '1', '20c') = 'RCP00', 'another house''s drink is refused';
  assert (select count(*) from public.recipe_versions) = nv and (select count(*) from public.recipe_lines) = nl,
    'a refused save writes nothing';
end $$;

-- T3. A stale save is refused and the current version keeps its lines (G7).
do $$
declare cur uuid; v1 uuid;
begin
  select version_id into cur from public.recipe_current where cocktail_id = pg_temp.u('10c');
  select id into v1 from public.recipe_versions where cocktail_id = pg_temp.u('10c') and version = 1;
  assert pg_temp.refused(v1, jsonb_build_array(jsonb_build_object('role', 'untracked', 'label', 'Ice', 'qty', 1, 'unit', 'each')))
    = 'RCP09', 'an old expected version is stale';
  assert pg_temp.refused(null, jsonb_build_array(jsonb_build_object('role', 'untracked', 'label', 'Ice', 'qty', 1, 'unit', 'each')))
    = 'RCP09', 'expecting no version when one exists is stale';
  assert (select version_id from public.recipe_current where cocktail_id = pg_temp.u('10c')) = cur, 'current is unchanged';
  assert (select count(*) from public.recipe_lines where version_id = cur) = 2, 'current keeps its two lines';
end $$;

-- T4. Append-only.
do $$
declare ok boolean := false;
begin
  begin
    update public.recipe_lines set label = 'changed' where version_id is not null;
  exception when restrict_violation then ok := true;
  end;
  assert ok, 'an UPDATE on recipe_lines raises';
  ok := false;
  begin
    delete from public.recipe_versions;
  exception when restrict_violation then ok := true;
  end;
  assert ok, 'a DELETE on recipe_versions raises';
end $$;

-- T5. Clients hold no grant; the house-read policy, granted here for the
-- test only, shows house B none of house A's versions and house A its own.
do $$
begin
  assert not has_table_privilege('authenticated', 'public.recipe_versions', 'SELECT'), 'authenticated holds no grant';
  assert not has_table_privilege('anon', 'public.recipe_lines', 'SELECT'), 'anon holds no grant';
  assert not has_function_privilege('authenticated',
    'public.save_recipe_version(uuid, uuid, uuid, integer, text, text, text, uuid, jsonb)', 'EXECUTE'), 'no client may save';
end $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant select on public.recipe_versions, public.user_restaurant_access to authenticated;
-- The membership table's own owner policy reads these; grant them for the probe too.
grant select on public.restaurants, public.organizations to authenticated;
insert into public.user_restaurant_access (user_id, restaurant_id, role, is_active) values
  (pg_temp.u('ee1'), pg_temp.u('1'), 'manager', true),
  (pg_temp.u('ee2'), pg_temp.u('2'), 'manager', true);
set local role authenticated;
select set_config('test.uid', 'ae360000-0000-4000-8000-000000000ee2', true);
do $$ begin
  assert (select count(*) from public.recipe_versions) = 0, 'house B cannot read house A''s versions';
end $$;
select set_config('test.uid', 'ae360000-0000-4000-8000-000000000ee1', true);
do $$ begin
  assert (select count(*) from public.recipe_versions) = 2, 'house A reads its own two versions';
end $$;
reset role;

select 'a_recipe_is_a_versioned_list_of_house_items: all assertions passed' as result;
rollback;
