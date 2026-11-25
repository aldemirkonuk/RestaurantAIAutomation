-- A good says what is in it: nutrition per 100 g or 100 ml, and the 14
-- allergens, each stated by a named person of the house.
--
-- WHY (founder /goal, 2026-11-07): "when clicked on item then clicked on kpi
-- cards a nutrition card of the item, same thing for drinks (recipes)". The
-- /inventory item drawer's eighth card ("What's in it") had nowhere to read
-- from. Inventory proposal §3 I18 and sota.md "Nutrition and allergens".
--
-- THE RULES THIS SCHEMA HOLDS
--   1. UNKNOWN IS NULL, NEVER 0. Every figure is nullable with no default. A
--      salt of 0 is a claim ("no salt"); a salt nobody stated is NULL, and the
--      card says "not known".
--   2. A FIGURE NAMES ITS BASIS. `basis` is '100g' or '100ml' and is NOT NULL:
--      "12 g of sugar" means nothing without it.
--   3. A FIGURE NAMES ITS SOURCE. `source` is the house's own figures, figures
--      a person copied from the pack's printed label, or a lookup the house
--      confirmed (Open Food Facts by barcode, USDA FoodData Central by id). A
--      lookup carries its reference, so the figure can be traced back.
--   4. ENERGY FROM ALCOHOL ALONE IS SAID AS SUCH. A drink whose only stated
--      figure is its ABV may carry energy worked out from it (ethanol 0.789
--      g/ml x 7 kcal/g, EU 1169/2011 Annex XIV). `energy_from_abv` marks it,
--      and a CHECK pins the arithmetic, so the flag can never sit on a typed
--      figure.
--   5. AN ALLERGEN NOBODY STATED HAS NO ROW. `item_allergens` holds contains /
--      may_contain / free per allergen; absence means "not stated". A "free"
--      is a statement a person made, never a default and never an inference.
--   6. A STATEMENT NAMES ITS AUTHOR. stated_by (public.users, never
--      auth.users) + stated_by_name + stated_at, NOT NULL together.
--   7. ONE HOUSE. restaurant_id on every row, and a trigger refuses a row
--      whose house is not its item's house (ADR 0141's shape: never trust an
--      id alone). Writes go through save_item_nutrition(), which checks the
--      item belongs to the house and replaces figures and allergens in one
--      transaction, so a failed save never leaves allergens half-written.
--   8. RLS ON, service_role only, anon/authenticated revoked (OD-72): the
--      gateway reads with the service key and its restaurant_id filter IS
--      the tenant scope, exactly as for restaurant_inventory.
--
-- Additive: two tables, one trigger function, one write function. No existing
-- table is altered and nothing is backfilled.

CREATE TABLE IF NOT EXISTS public.item_nutrition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  -- One statement per item. A merge of two items keeps the keeper's row
  -- (20260902180000: a unique index decides what collides).
  inventory_id UUID NOT NULL UNIQUE
    REFERENCES public.restaurant_inventory(id) ON DELETE CASCADE,
  basis TEXT NOT NULL CHECK (basis IN ('100g', '100ml')),
  energy_kcal NUMERIC(5,1) CHECK (energy_kcal IS NULL OR energy_kcal BETWEEN 0 AND 900),
  fat_g NUMERIC(5,2) CHECK (fat_g IS NULL OR fat_g >= 0),
  saturates_g NUMERIC(5,2) CHECK (saturates_g IS NULL OR saturates_g >= 0),
  carbohydrate_g NUMERIC(5,2) CHECK (carbohydrate_g IS NULL OR carbohydrate_g >= 0),
  sugars_g NUMERIC(5,2) CHECK (sugars_g IS NULL OR sugars_g >= 0),
  protein_g NUMERIC(5,2) CHECK (protein_g IS NULL OR protein_g >= 0),
  salt_g NUMERIC(5,2) CHECK (salt_g IS NULL OR salt_g >= 0),
  abv_pct NUMERIC(4,1) CHECK (abv_pct IS NULL OR abv_pct BETWEEN 0 AND 100),
  energy_from_abv BOOLEAN NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('house', 'pack_label', 'open_food_facts', 'usda_fdc')),
  source_ref TEXT CHECK (source_ref IS NULL OR btrim(source_ref) <> ''),
  stated_by UUID NOT NULL REFERENCES public.users(user_id) ON DELETE RESTRICT,
  stated_by_name TEXT NOT NULL CHECK (btrim(stated_by_name) <> ''),
  stated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 100 g of anything holds at most 100 g of one part of it. 100 ml of a
  -- syrup can weigh ~140 g, so a liquid's bound is wider.
  CONSTRAINT item_nutrition_grams_fit_the_basis CHECK (
    greatest(fat_g, saturates_g, carbohydrate_g, sugars_g, protein_g, salt_g)
      IS NULL
    OR greatest(fat_g, saturates_g, carbohydrate_g, sugars_g, protein_g, salt_g)
      <= CASE basis WHEN '100g' THEN 100 ELSE 150 END),
  -- A part cannot exceed its whole.
  CONSTRAINT item_nutrition_saturates_within_fat CHECK (
    saturates_g IS NULL OR fat_g IS NULL OR saturates_g <= fat_g),
  CONSTRAINT item_nutrition_sugars_within_carbohydrate CHECK (
    sugars_g IS NULL OR carbohydrate_g IS NULL OR sugars_g <= carbohydrate_g),
  -- ABV is a share of a volume.
  CONSTRAINT item_nutrition_abv_is_per_volume CHECK (abv_pct IS NULL OR basis = '100ml'),
  -- The flag sits only on the arithmetic it names: 0.789 g/ml x 7 kcal/g.
  CONSTRAINT item_nutrition_energy_from_abv_is_the_arithmetic CHECK (
    NOT energy_from_abv
    OR (abv_pct IS NOT NULL AND energy_kcal = round(abv_pct * 5.523, 1))),
  -- A lookup names what it looked up; the house's own figures name nothing.
  CONSTRAINT item_nutrition_lookup_names_its_reference CHECK (
    (source IN ('open_food_facts', 'usda_fdc')) = (source_ref IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_item_nutrition_restaurant
  ON public.item_nutrition (restaurant_id);

CREATE TABLE IF NOT EXISTS public.item_allergens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_id UUID NOT NULL REFERENCES public.restaurant_inventory(id) ON DELETE CASCADE,
  -- EU 1169/2011 Annex II = Turkey's Ek-1 list, the same 14.
  allergen TEXT NOT NULL CHECK (allergen IN (
    'gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk',
    'tree_nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs')),
  status TEXT NOT NULL CHECK (status IN ('contains', 'may_contain', 'free')),
  stated_by UUID NOT NULL REFERENCES public.users(user_id) ON DELETE RESTRICT,
  stated_by_name TEXT NOT NULL CHECK (btrim(stated_by_name) <> ''),
  stated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_item_allergens_item_allergen UNIQUE (inventory_id, allergen)
);

CREATE INDEX IF NOT EXISTS idx_item_allergens_restaurant
  ON public.item_allergens (restaurant_id);

-- A row's house is its item's house. Never trust the id alone (ADR 0141).
CREATE OR REPLACE FUNCTION public.item_statement_stays_in_its_house()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_house UUID;
BEGIN
  SELECT restaurant_id INTO v_house
    FROM public.restaurant_inventory WHERE id = NEW.inventory_id;
  IF v_house IS DISTINCT FROM NEW.restaurant_id THEN
    RAISE EXCEPTION 'item % is not an item of house %', NEW.inventory_id, NEW.restaurant_id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_item_nutrition_one_house ON public.item_nutrition;
CREATE TRIGGER trg_item_nutrition_one_house
  BEFORE INSERT OR UPDATE OF restaurant_id, inventory_id ON public.item_nutrition
  FOR EACH ROW EXECUTE FUNCTION public.item_statement_stays_in_its_house();

DROP TRIGGER IF EXISTS trg_item_allergens_one_house ON public.item_allergens;
CREATE TRIGGER trg_item_allergens_one_house
  BEFORE INSERT OR UPDATE OF restaurant_id, inventory_id ON public.item_allergens
  FOR EACH ROW EXECUTE FUNCTION public.item_statement_stays_in_its_house();

-- The one write. p_nutrition NULL removes the figures; p_allergens is the
-- whole stated set (an allergen left out becomes "not stated"). Both replace
-- in one transaction. Unknown keys inside p_nutrition are ignored; missing
-- figures are NULL, never 0.
CREATE OR REPLACE FUNCTION public.save_item_nutrition(
  p_restaurant_id UUID,
  p_inventory_id UUID,
  p_stated_by UUID,
  p_stated_by_name TEXT,
  p_nutrition JSONB,
  p_allergens JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_found UUID;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT id INTO v_found
    FROM public.restaurant_inventory
   WHERE id = p_inventory_id AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF v_found IS NULL THEN
    RAISE EXCEPTION 'item % is not an item of house %', p_inventory_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  IF p_allergens IS NULL OR jsonb_typeof(p_allergens) <> 'array' THEN
    RAISE EXCEPTION 'p_allergens must be an array (empty when none is stated)'
      USING ERRCODE = '22023';
  END IF;

  IF p_nutrition IS NULL THEN
    DELETE FROM public.item_nutrition
     WHERE inventory_id = p_inventory_id AND restaurant_id = p_restaurant_id;
  ELSE
    INSERT INTO public.item_nutrition AS n (
      restaurant_id, inventory_id, basis, energy_kcal, fat_g, saturates_g,
      carbohydrate_g, sugars_g, protein_g, salt_g, abv_pct, energy_from_abv,
      source, source_ref, stated_by, stated_by_name, stated_at)
    VALUES (
      p_restaurant_id, p_inventory_id,
      p_nutrition->>'basis',
      (p_nutrition->>'energy_kcal')::numeric,
      (p_nutrition->>'fat_g')::numeric,
      (p_nutrition->>'saturates_g')::numeric,
      (p_nutrition->>'carbohydrate_g')::numeric,
      (p_nutrition->>'sugars_g')::numeric,
      (p_nutrition->>'protein_g')::numeric,
      (p_nutrition->>'salt_g')::numeric,
      (p_nutrition->>'abv_pct')::numeric,
      (p_nutrition->>'energy_from_abv')::boolean,
      p_nutrition->>'source',
      p_nutrition->>'source_ref',
      p_stated_by, p_stated_by_name, v_now)
    ON CONFLICT (inventory_id) DO UPDATE SET
      basis = EXCLUDED.basis,
      energy_kcal = EXCLUDED.energy_kcal,
      fat_g = EXCLUDED.fat_g,
      saturates_g = EXCLUDED.saturates_g,
      carbohydrate_g = EXCLUDED.carbohydrate_g,
      sugars_g = EXCLUDED.sugars_g,
      protein_g = EXCLUDED.protein_g,
      salt_g = EXCLUDED.salt_g,
      abv_pct = EXCLUDED.abv_pct,
      energy_from_abv = EXCLUDED.energy_from_abv,
      source = EXCLUDED.source,
      source_ref = EXCLUDED.source_ref,
      stated_by = EXCLUDED.stated_by,
      stated_by_name = EXCLUDED.stated_by_name,
      stated_at = EXCLUDED.stated_at,
      updated_at = v_now
    WHERE n.restaurant_id = p_restaurant_id;
  END IF;

  DELETE FROM public.item_allergens
   WHERE inventory_id = p_inventory_id AND restaurant_id = p_restaurant_id;
  INSERT INTO public.item_allergens (
    restaurant_id, inventory_id, allergen, status, stated_by, stated_by_name, stated_at)
  SELECT p_restaurant_id, p_inventory_id, a->>'allergen', a->>'status',
         p_stated_by, p_stated_by_name, v_now
    FROM jsonb_array_elements(p_allergens) AS a;
END
$$;

ALTER TABLE public.item_nutrition ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_nutrition_service_role ON public.item_nutrition;
CREATE POLICY item_nutrition_service_role ON public.item_nutrition
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.item_nutrition FROM anon, authenticated;

ALTER TABLE public.item_allergens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_allergens_service_role ON public.item_allergens;
CREATE POLICY item_allergens_service_role ON public.item_allergens
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.item_allergens FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.save_item_nutrition(UUID, UUID, UUID, TEXT, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_item_nutrition(UUID, UUID, UUID, TEXT, JSONB, JSONB)
  TO service_role;
REVOKE ALL ON FUNCTION public.item_statement_stays_in_its_house() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.item_nutrition IS
  'What one house item is made of, per 100 g or 100 ml (basis). Every figure nullable with no default: NULL is "not known", never 0. source names where the figures came from (house, pack_label, open_food_facts, usda_fdc) and a lookup carries its source_ref. energy_from_abv marks energy worked out from ABV alone. Written only by save_item_nutrition(). Founder /goal 2026-11-07.';
COMMENT ON TABLE public.item_allergens IS
  'The 14 EU/TR allergens a house stated for one item: contains, may_contain or free. No row means not stated; a free is a person''s statement, never a default. Written only by save_item_nutrition().';

-- Assert the outcome rather than reporting success.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_attribute a
        JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = 'public.item_nutrition'::regclass
         AND a.attname IN ('energy_kcal', 'fat_g', 'saturates_g', 'carbohydrate_g',
                           'sugars_g', 'protein_g', 'salt_g', 'abv_pct', 'energy_from_abv')) > 0 THEN
    RAISE EXCEPTION 'item_nutrition: a figure carries a DEFAULT; an unknown would read as a value';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.item_nutrition'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.item_allergens'::regclass) THEN
    RAISE EXCEPTION 'item_nutrition / item_allergens: RLS is off';
  END IF;
  IF has_table_privilege('anon', 'public.item_nutrition', 'SELECT')
     OR has_table_privilege('authenticated', 'public.item_allergens', 'SELECT') THEN
    RAISE EXCEPTION 'item_nutrition / item_allergens: a client role can still read';
  END IF;
END
$$;
