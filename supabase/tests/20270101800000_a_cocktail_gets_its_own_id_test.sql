-- F-150: a cocktail inserted without an id gets one. Migration
-- a_cocktail_gets_its_own_id sets public.cocktails.id DEFAULT gen_random_uuid().
--
-- Self-asserting: it must FAIL on a build without that migration (T1: the
-- insert violates NOT NULL on id) and PASS with it. One transaction, rolled
-- back: it leaves nothing behind.

begin;

-- T1 an insert that names no id, as createCocktail sends it, succeeds and
-- the row carries a fresh id.
do $$
declare
  a uuid;
  b uuid;
begin
  insert into public.cocktails (restaurant_id, name, source)
       values (null, 'Ayva Highball', 'manual') returning id into a;
  insert into public.cocktails (restaurant_id, name, source)
       values (null, 'Negroni', 'manual') returning id into b;
  assert a is not null and b is not null, 'T1 FAIL a cocktail inserted without an id has none';
  assert a <> b, 'T1 FAIL two cocktails were given the same id';
end $$;

-- T2 a recipe line can now hang off a cocktail created that way.
do $$
declare
  c uuid;
begin
  insert into public.cocktails (name, source) values ('Ayva Highball', 'manual') returning id into c;
  insert into public.cocktail_ingredients (cocktail_id, free_text, quantity, unit)
       values (c, 'quince syrup', 20, 'ml');
  assert (select count(*) from public.cocktail_ingredients where cocktail_id = c) = 1,
    'T2 FAIL the recipe line was not written';
end $$;

rollback;
