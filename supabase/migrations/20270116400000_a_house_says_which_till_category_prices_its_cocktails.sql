-- a_house_says_which_till_category_prices_its_cocktails — the owner or a
-- manager says which of the house's till-category tax rates a cocktail's
-- price holds (F-1615, wave 53 sim; ADR 0341 §6; coordinator's call S230).
--
-- WHY
-- ---
-- For a house whose till prices include tax, a cocktail's margin is worked
-- out on its price without tax (F-1587). A cocktail is not a stock row, so it
-- has no item rate, and margin advice's rule (ADR 0341 §6) then takes the
-- whole-house rate only while no till-category rate is in force. Every
-- Turkish house that takes the suggested rates (10% food, 20% alcohol) keys
-- them by till category, so every cocktail read "No margin". ADR 0341 §6 says
-- category or item rate mapping is the owner's work: nothing here guesses a
-- category from a name. The owner picks one of the house's own till
-- categories in Settings; with none picked, the cocktail keeps its named
-- refusal.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
--   - restaurants.cocktail_tax_category TEXT, NULL on every house (nobody has
--     chosen). It holds the house_tax_rates.key of a pos_category rate, as the
--     till names it; the gateway refuses any name the house has no rate for.
--   - A CHECK keeps it trimmed and 1..120 characters (POS_CATEGORY_MAX_LENGTH).
-- Additive. No row is written, and a house that never chooses reads exactly
-- as before. restaurants keeps its RLS and grants as they are.
BEGIN;

SET LOCAL statement_timeout = '120s';

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS cocktail_tax_category TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurants_cocktail_tax_category_shape'
       AND conrelid = to_regclass('public.restaurants')
  ) THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_cocktail_tax_category_shape
      CHECK (cocktail_tax_category IS NULL
             OR (cocktail_tax_category = btrim(cocktail_tax_category)
                 AND char_length(cocktail_tax_category) BETWEEN 1 AND 120));
  END IF;
END
$$;

COMMENT ON COLUMN public.restaurants.cocktail_tax_category IS
  'The till category (a pos_category key of house_tax_rates) whose rate a cocktail''s price holds, chosen by an owner or manager in Settings. NULL: nobody has chosen, and a cocktail on a house with till-category rates has no margin. F-1615, ADR 0341 §6.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'restaurants'
       AND column_name = 'cocktail_tax_category'
       AND column_default IS NULL
  ) THEN
    RAISE EXCEPTION 'restaurants.cocktail_tax_category was not added, or carries a default';
  END IF;
END $$;

COMMIT;
