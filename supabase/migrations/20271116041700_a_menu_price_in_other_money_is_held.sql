-- A menu line priced only in another money takes no price, and says why
-- (r36 menu audit N1, 2026-11-13).
--
-- A menu's prices were taken as the house's money whatever the menu printed:
-- a lira house whose menu prints "€12" got 12 as its own bottle price. The
-- gateway now reads the money a line is printed in (menus/menu-money.ts) and,
-- when it is not the house's (restaurants.currency), takes no price from the
-- line and flags it. Nothing converts: there is no rate anywhere in this
-- system (20260905120000_a_house_names_its_money.sql, rule 3).
--
-- The flag lives where the two blank-price flags already live, on
-- menu_items.price_flag with its sentence in price_flag_note, so the carry
-- (menu_items_write_back) and every reader of the line see it with no new
-- column. This file only widens the one CHECK that names the flags.

DO $$
BEGIN
  ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_price_flag_known;
  ALTER TABLE public.menu_items
    ADD CONSTRAINT menu_items_price_flag_known
    CHECK (
      (price_flag IS NULL AND price_flag_note IS NULL)
      OR (price_flag IN ('blank_kept_last_known', 'blank_no_house_price', 'other_currency')
          AND price_flag_note IS NOT NULL)
    );
END
$$;

COMMENT ON COLUMN public.menu_items.price_flag IS
  'blank_kept_last_known: the line showed no price for a kind the house already prices, so the house kept its last known price (founder answer 3). blank_no_house_price: the line shows no price at all and the house has no price for the wine either (round 6c answer 4, "Flag it"). other_currency: the menu prints the line''s price only in a money that is not the house''s (restaurants.currency), so no price was taken from it and nothing was converted; price_flag_note names the printed price and both monies (r36 N1). NULL = nothing unclear.';
