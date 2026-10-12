-- F-1329 / OD-113: a recipe line names the house's own stock row, and a till
-- mapping may name the cocktail it sells. Migration
-- a_cocktail_takes_its_ingredients_off_the_shelf adds
-- cocktail_ingredients.inventory_id and pos_item_mappings.cocktail_id, and
-- refuses either one pointing at another house.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration (T1) and PASS with it. One transaction,
-- rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('other', gen_random_uuid()),
  ('wine', gen_random_uuid()), ('wine2', gen_random_uuid()),
  ('gin', gen_random_uuid()), ('theirs', gen_random_uuid()),
  ('negroni', gen_random_uuid()), ('their_cocktail', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC recipe house ' || k, 'syn-rcp-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k in ('house', 'other');

insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-RC-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC ' || k, 'red'
  from t_fx where k in ('wine', 'wine2');

insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml)
select (select v from t_fx where k = 'gin'), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = 'wine'), 700;
insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml)
select (select v from t_fx where k = 'theirs'), (select v from t_fx where k = 'other'),
       (select v from t_fx where k = 'wine2'), 700;

insert into public.cocktails (id, restaurant_id, name)
select (select v from t_fx where k = 'negroni'), (select v from t_fx where k = 'house'), 'SYNTHETIC Negroni';
insert into public.cocktails (id, restaurant_id, name)
select (select v from t_fx where k = 'their_cocktail'), (select v from t_fx where k = 'other'), 'SYNTHETIC Theirs';

-- T1: a recipe line links to the house's own stock row, with no other referent.
do $$
declare n int;
begin
  insert into public.cocktail_ingredients (cocktail_id, inventory_id, quantity, unit)
  select (select v from t_fx where k = 'negroni'), (select v from t_fx where k = 'gin'), 30, 'ml';
  select count(*) into n from public.cocktail_ingredients
   where cocktail_id = (select v from t_fx where k = 'negroni')
     and inventory_id = (select v from t_fx where k = 'gin');
  if n <> 1 then raise exception 'T1 FAIL: the linked recipe line was not kept (% rows)', n; end if;
end $$;

-- T2: another house's stock row is refused.
do $$
begin
  begin
    insert into public.cocktail_ingredients (cocktail_id, inventory_id, free_text, quantity, unit)
    select (select v from t_fx where k = 'negroni'), (select v from t_fx where k = 'theirs'), 'gin', 30, 'ml';
    raise exception 'T2 FAIL: a recipe line took from another house''s stock';
  exception when check_violation then null;
  end;
end $$;

-- T3: a till mapping names the house's own cocktail; another house's is refused.
do $$
begin
  insert into public.pos_item_mappings (restaurant_id, source, external_item_id, item_name, cocktail_id)
  select (select v from t_fx where k = 'house'), '*', 'SYN-NEG', 'SYNTHETIC Negroni',
         (select v from t_fx where k = 'negroni');
  begin
    insert into public.pos_item_mappings (restaurant_id, source, external_item_id, item_name, cocktail_id)
    select (select v from t_fx where k = 'house'), '*', 'SYN-THEIRS', 'SYNTHETIC Theirs',
           (select v from t_fx where k = 'their_cocktail');
    raise exception 'T3 FAIL: a till button sold another house''s cocktail';
  exception when check_violation then null;
  end;
end $$;

-- T4: removing the stock row unlinks the recipe line, never deletes it.
do $$
declare n int; linked int;
begin
  insert into public.cocktail_ingredients (cocktail_id, inventory_id, free_text, quantity, unit)
  select (select v from t_fx where k = 'negroni'), (select v from t_fx where k = 'gin'), 'gin again', 20, 'ml';
  delete from public.cocktail_ingredients
   where cocktail_id = (select v from t_fx where k = 'negroni') and free_text is null;
  delete from public.restaurant_inventory where id = (select v from t_fx where k = 'gin');
  select count(*), count(inventory_id) into n, linked from public.cocktail_ingredients
   where cocktail_id = (select v from t_fx where k = 'negroni');
  if n <> 1 or linked <> 0 then
    raise exception 'T4 FAIL: expected the line kept and unlinked, found % rows, % linked', n, linked;
  end if;
end $$;

rollback;
