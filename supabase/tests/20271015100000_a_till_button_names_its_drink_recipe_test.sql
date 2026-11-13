-- A till button names its drink recipe (inventory r28 gap 1, slice 2;
-- migration 20271015100000_a_till_button_names_its_drink_recipe.sql).
--
-- Run against a database built from supabase/migrations. Everything it writes
-- is inside one transaction that is ROLLED BACK at the end. It prints one row
-- per test: id, ok, detail. Every "ok" must be true. Without the migration the
-- first insert naming cocktail_id errors (no such column), which is the control.

begin;

create temp table _t (id text primary key, ok boolean, detail text) on commit drop;
create temp table _fx (k text primary key, v uuid) on commit drop;

do $$
declare a uuid; u uuid := gen_random_uuid(); c uuid := gen_random_uuid(); m uuid;
begin
  insert into public.restaurants (name, slug) values ('Bar A', 'bar-a-' || u) returning id into a;
  insert into public.cocktails (id, restaurant_id, name) values (c, a, 'Negroni');
  insert into public.pos_item_mappings (restaurant_id, source, external_item_id, item_name, cocktail_id)
    values (a, '*', 'negroni-1', 'Negroni', c) returning id into m;
  insert into _fx values ('a', a), ('c', c), ('m', m);
end $$;

create or replace function pg_temp.fx(k text) returns uuid language sql as $$ select v from _fx where _fx.k = fx.k $$;

-- B1: a button that names a recipe is stored with it, and no shelf item.
insert into _t
select 'B1', cocktail_id = pg_temp.fx('c') and inventory_id is null, 'recipe link stored'
  from public.pos_item_mappings where id = pg_temp.fx('m');

-- B2: a button cannot name a shelf item AND a recipe (it would draw twice).
-- The inventory id is a random uuid: a row check fires before the foreign key
-- is looked at, so the refusal must be the CHECK's; the foreign key refusing
-- it instead means the check is missing.
do $$ begin
  begin
    update public.pos_item_mappings set inventory_id = gen_random_uuid() where id = pg_temp.fx('m');
    insert into _t values ('B2', false, 'a mapping naming both was accepted');
  exception
    when check_violation then
      insert into _t values ('B2', true, 'pos_item_mappings_draws_one_thing refused it');
    when foreign_key_violation then
      insert into _t values ('B2', false, 'only the foreign key refused it: the one-thing check is missing');
  end;
end $$;

-- B3: naming neither is allowed, as before (moves no stock).
do $$ begin
  insert into public.pos_item_mappings (restaurant_id, source, external_item_id, item_name)
    values (pg_temp.fx('a'), '*', 'chips-1', 'Chips');
  insert into _t values ('B3', true, 'a mapping naming nothing is still written');
exception when others then
  insert into _t values ('B3', false, sqlerrm);
end $$;

-- B4: a recipe removed from the database leaves its button unmapped, never
-- pointed at a recipe that is gone.
delete from public.cocktails where id = pg_temp.fx('c');
insert into _t
select 'B4', cocktail_id is null, 'on delete set null'
  from public.pos_item_mappings where id = pg_temp.fx('m');

-- B5: a button pointed at no real recipe is refused by the foreign key.
do $$ begin
  begin
    update public.pos_item_mappings set cocktail_id = gen_random_uuid() where id = pg_temp.fx('m');
    insert into _t values ('B5', false, 'a made-up recipe id was accepted');
  exception when foreign_key_violation then
    insert into _t values ('B5', true, 'cocktails fk refused it');
  end;
end $$;

select id, ok, detail from _t order by id;

rollback;
