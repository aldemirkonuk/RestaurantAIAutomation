-- F-150 (owner-quarter sim, 2026-10-02): no cocktail could be created.
-- public.cocktails.id was declared `uuid PRIMARY KEY` with no default
-- (20260817090000_cocktails.sql), and createCocktail (beverages.service.ts)
-- inserts no id, so every "Add a cocktail" died on
--   null value in column "id" of relation "cocktails" violates not-null constraint
-- and the recipe editor, which needs a cocktail id, was unreachable too.
-- cocktail_ingredients already defaults its id the same way. Existing rows
-- keep their ids; only an insert that names none is affected.

ALTER TABLE public.cocktails ALTER COLUMN id SET DEFAULT gen_random_uuid();
