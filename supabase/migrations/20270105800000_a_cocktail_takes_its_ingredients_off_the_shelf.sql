-- F-1329 / OD-113 (founder ruling S195, 2026-10-11: the industry approach).
-- A cocktail sold on the till took nothing off stock, or at most the one
-- bottle its till mapping named, and its recipe gave no cost per serve.
--
-- The recipe line could already name a catalogue row (beverage_id, wine_id),
-- but neither is stock: stock, par, counts and orders all key on
-- restaurant_inventory.id (20260903171000, ADR 0115). So a recipe line now
-- names the house's own stock row, and a till mapping may name the cocktail
-- whose recipe a sale of that button takes.
--
--   cocktail_ingredients.inventory_id  the stock row the line pours from
--   pos_item_mappings.cocktail_id      the recipe a till button sells
--
-- Both are SET NULL on delete: removing a stock row or a cocktail unlinks the
-- line or the button, it never deletes a recipe or a mapping.
--
-- SAME HOUSE, IN THE DATABASE. Neither child row can be trusted to name its
-- own house's rows: cocktail_ingredients has no restaurant_id, and a plain FK
-- admits another house's id (the ADR 0141 lesson from pos_item_mappings). The
-- gateway checks first; the triggers below refuse what it missed.

ALTER TABLE public.cocktail_ingredients
  ADD COLUMN IF NOT EXISTS inventory_id uuid
    REFERENCES public.restaurant_inventory(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.cocktail_ingredients.inventory_id IS
  'The house stock row this recipe line takes from (F-1329). A till sale of '
  'the cocktail depletes it by quantity x unit per serve; null means not '
  'linked, which depletes nothing and costs nothing.';

CREATE INDEX IF NOT EXISTS idx_cocktail_ingredients_inventory
  ON public.cocktail_ingredients (inventory_id) WHERE inventory_id IS NOT NULL;

ALTER TABLE public.cocktail_ingredients
  DROP CONSTRAINT IF EXISTS cocktail_ingredients_has_a_referent;
ALTER TABLE public.cocktail_ingredients
  ADD CONSTRAINT cocktail_ingredients_has_a_referent
  CHECK (beverage_id IS NOT NULL OR wine_id IS NOT NULL
         OR free_text IS NOT NULL OR inventory_id IS NOT NULL);

ALTER TABLE public.pos_item_mappings
  ADD COLUMN IF NOT EXISTS cocktail_id uuid
    REFERENCES public.cocktails(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.pos_item_mappings.cocktail_id IS
  'The cocktail a sale of this till button is (F-1329). When set, the sale '
  'takes the recipe''s linked lines off stock instead of inventory_id.';

CREATE OR REPLACE FUNCTION public.recipe_line_stock_is_the_house_s()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.inventory_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.cocktails c
      JOIN public.restaurant_inventory ri ON ri.restaurant_id = c.restaurant_id
     WHERE c.id = NEW.cocktail_id
       AND ri.id = NEW.inventory_id
  ) THEN
    RAISE EXCEPTION
      'A recipe line may take only from its own house''s stock: stock row % is not the house''s of cocktail %.',
      NEW.inventory_id, NEW.cocktail_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS recipe_line_stock_is_the_house_s ON public.cocktail_ingredients;
CREATE TRIGGER recipe_line_stock_is_the_house_s
  BEFORE INSERT OR UPDATE OF inventory_id, cocktail_id ON public.cocktail_ingredients
  FOR EACH ROW EXECUTE FUNCTION public.recipe_line_stock_is_the_house_s();

CREATE OR REPLACE FUNCTION public.till_cocktail_is_the_house_s()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.cocktail_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cocktails c
     WHERE c.id = NEW.cocktail_id
       AND c.restaurant_id = NEW.restaurant_id
  ) THEN
    RAISE EXCEPTION
      'A till button may sell only its own house''s cocktail: cocktail % is not house %''s.',
      NEW.cocktail_id, NEW.restaurant_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS till_cocktail_is_the_house_s ON public.pos_item_mappings;
CREATE TRIGGER till_cocktail_is_the_house_s
  BEFORE INSERT OR UPDATE OF cocktail_id, restaurant_id ON public.pos_item_mappings
  FOR EACH ROW EXECUTE FUNCTION public.till_cocktail_is_the_house_s();

REVOKE ALL ON FUNCTION public.recipe_line_stock_is_the_house_s() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.till_cocktail_is_the_house_s() FROM PUBLIC, anon, authenticated;
