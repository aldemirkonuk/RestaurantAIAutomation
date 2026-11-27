-- F-150 (owner-quarter sim, 2026-10-02), landed on its own because the fix
-- (61bf0a10c, migration 20270101800000) is on no branch that reaches main.
-- r107 drinks walk: on a database built from migrations both "Copy" and "Add a
-- cocktail" died with HTTP 500, null value in column "id" of relation
-- "cocktails" violates not-null constraint.
--
-- public.cocktails.id was declared `uuid PRIMARY KEY` with no default
-- (20260817090000_cocktails.sql) and createCocktail (beverages.service.ts)
-- inserts no id. cocktail_ingredients already defaults its id this way.
-- Existing rows keep their ids; only an insert that names none is affected.
-- Setting a default that is already set changes nothing, so a database that
-- drifted ahead of the migrations is safe.

ALTER TABLE public.cocktails ALTER COLUMN id SET DEFAULT gen_random_uuid();
