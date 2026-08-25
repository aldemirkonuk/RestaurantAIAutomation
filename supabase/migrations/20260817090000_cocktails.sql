-- Plan §3: cocktails are recipes, not catalogue rows.
--
-- 55 cocktail rows sit in master_wine_library today with producer=name
-- always (no real producer concept for a cocktail) -- and they are exactly
-- the rows that broke wine matching before quarantine (0c) existed: five
-- wines could not match themselves because `producer` fell back to `name`
-- while `normalized_producer` stayed empty, the same shape of bug. Cocktails
-- are excluded from the catalogue STRUCTURALLY (their own tables), not by
-- category name alone, per register P6/A8.
--
-- restaurant_id is NULLABLE. Checked before writing this: none of the
-- 26-menu demo corpus these 55 rows come from maps to a live `restaurants`
-- row (11 real restaurants exist in this database; corpus provenance is a
-- PDF filename in data_enrichment, not a restaurant_id). These migrate as
-- unattributed reference data, same posture master_wine_library itself
-- takes for globally-referenced rows. A real per-restaurant cocktail menu
-- entered live will carry a real restaurant_id from day one.
--
-- cocktail_ingredients is created EMPTY and stays empty after this
-- migration -- recipes are not in the extracted data (plan §3 says so
-- explicitly: "they need a separate extraction pass over the cocktail
-- sections"). Building it now, ready but unpopulated, is the same posture
-- taken for beverages.type_attributes: the schema exists so population is
-- additive, nothing here fabricates a recipe that was never extracted.

CREATE TABLE IF NOT EXISTS public.cocktails (
  id              uuid PRIMARY KEY,
  restaurant_id   uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name            text NOT NULL,
  display_name    text,
  menu_section    text,
  method          text,
  glass           text,
  garnish         text,
  price           numeric,
  description     text,
  data_enrichment jsonb,
  source          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

COMMENT ON TABLE public.cocktails IS
  'Recipes, not catalogue rows (plan §3). restaurant_id NULL means '
  'unattributed reference data (demo corpus provenance); a live menu entry '
  'always carries a real restaurant_id.';

CREATE INDEX IF NOT EXISTS idx_cocktails_restaurant ON public.cocktails (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_cocktails_deleted_at ON public.cocktails (deleted_at);

ALTER TABLE public.cocktails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cocktails_service_role ON public.cocktails;
CREATE POLICY cocktails_service_role ON public.cocktails
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cocktails_authenticated_read ON public.cocktails;
CREATE POLICY cocktails_authenticated_read ON public.cocktails
  FOR SELECT TO authenticated USING (deleted_at IS NULL);

CREATE TABLE IF NOT EXISTS public.cocktail_ingredients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cocktail_id  uuid NOT NULL REFERENCES public.cocktails(id) ON DELETE CASCADE,
  beverage_id  uuid REFERENCES public.beverages(id),
  wine_id      uuid REFERENCES public.master_wine_library(id),
  free_text    text,
  quantity     numeric,
  unit         text,
  sort_order   integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cocktail_ingredients_has_a_referent
    CHECK (beverage_id IS NOT NULL OR wine_id IS NOT NULL OR free_text IS NOT NULL)
);

COMMENT ON TABLE public.cocktail_ingredients IS
  'Empty by design after the plan §3 migration -- recipes were never '
  'extracted. beverage_id is what eventually makes a poured cocktail '
  'deplete its base spirit; free_text covers non-catalogue ingredients '
  '("fresh lime juice", "egg white").';

CREATE INDEX IF NOT EXISTS idx_cocktail_ingredients_cocktail ON public.cocktail_ingredients (cocktail_id);
CREATE INDEX IF NOT EXISTS idx_cocktail_ingredients_beverage ON public.cocktail_ingredients (beverage_id);
CREATE INDEX IF NOT EXISTS idx_cocktail_ingredients_wine ON public.cocktail_ingredients (wine_id);

ALTER TABLE public.cocktail_ingredients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cocktail_ingredients_service_role ON public.cocktail_ingredients;
CREATE POLICY cocktail_ingredients_service_role ON public.cocktail_ingredients
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cocktail_ingredients_authenticated_read ON public.cocktail_ingredients;
CREATE POLICY cocktail_ingredients_authenticated_read ON public.cocktail_ingredients
  FOR SELECT TO authenticated USING (true);
