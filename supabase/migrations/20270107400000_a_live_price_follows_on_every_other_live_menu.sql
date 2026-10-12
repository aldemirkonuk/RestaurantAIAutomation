-- A LIVE PRICE FOLLOWS ON EVERY OTHER LIVE MENU (ADR 0340 rule 21; founder
-- answer S202: the house holds one list price).
--
-- current_menu_line_follows_house_price (20270106000000) skipped every
-- change whose source was 'import' or 'menu_current'. With one live menu per
-- house that was right: the menu that made the change already showed it. With
-- one live menu per KIND, the same house item can sit on Drinks and Desserts;
-- a correction on the Drinks line (written with source 'import',
-- menus.service.ts) left the Desserts line at the old price.
--
-- WHAT THIS FILE DOES
-- 1. The trigger skips only the menu named in mudavym.menu_price_menu_id
--    (set by set_house_menu_price, 20270106000000:210): the menu whose line
--    made the change. Every other active menu of the house follows.
-- 2. One case keeps the old skip: a change whose source is 'import' or
--    'menu_current' and that names NO menu still follows nowhere. Basis:
--    such a call cannot say which menu already shows the price, and the
--    existing test 20270105500000 (T4) writes exactly that and expects no
--    line to move. Every gateway caller of those two sources names its menu.
--    [Deviation recorded in ADR 0340's Lane 1 review note; rejected: follow
--    everywhere when no menu is named, which would rewrite the line the
--    import itself just wrote.]
-- 3. A dish line never takes a house drink price: both UPDATEs add
--    line_kind IS DISTINCT FROM 'dish' (a dish's price is menu_items.price,
--    and the CHECK menu_items_a_dish_has_no_drink_price would refuse it).
--
-- Body otherwise that of 20270106000000 section 3. Writes no row.

CREATE OR REPLACE FUNCTION public.current_menu_line_follows_house_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bottle boolean := NEW.menu_price_current IS DISTINCT FROM OLD.menu_price_current
                      AND NEW.menu_price_current IS NOT NULL;
  v_glass  boolean := NEW.menu_price_glass IS DISTINCT FROM OLD.menu_price_glass
                      AND NEW.menu_price_glass IS NOT NULL;
  v_source text := coalesce(nullif(current_setting('mudavym.menu_price_source', true), ''), '');
  v_origin uuid := nullif(current_setting('mudavym.menu_price_menu_id', true), '')::uuid;
BEGIN
  IF NOT (v_bottle OR v_glass) THEN
    RETURN NEW;
  END IF;
  -- A menu-made change that does not say which menu made it follows nowhere.
  IF v_source IN ('import', 'menu_current') AND v_origin IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.menu_items mi
     SET bottle_price   = CASE WHEN v_bottle THEN NEW.menu_price_current ELSE mi.bottle_price END,
         by_glass_price = CASE WHEN v_glass THEN NEW.menu_price_glass ELSE mi.by_glass_price END
    FROM public.restaurant_menus m
   WHERE m.id = mi.menu_id
     AND m.restaurant_id = NEW.restaurant_id
     AND m.status = 'active'
     AND m.id IS DISTINCT FROM v_origin
     AND mi.restaurant_id = NEW.restaurant_id
     AND mi.inventory_item_id = NEW.id
     AND mi.status IS DISTINCT FROM 'discarded'
     AND mi.line_kind IS DISTINCT FROM 'dish'
     AND ((v_bottle AND mi.bottle_price IS DISTINCT FROM NEW.menu_price_current)
          OR (v_glass AND mi.by_glass_price IS DISTINCT FROM NEW.menu_price_glass));

  -- A blank-price flag says the line showed no price; once it shows every
  -- kind the house prices, the flag is no longer true.
  UPDATE public.menu_items mi
     SET price_flag = NULL,
         price_flag_note = NULL
    FROM public.restaurant_menus m
   WHERE m.id = mi.menu_id
     AND m.restaurant_id = NEW.restaurant_id
     AND m.status = 'active'
     AND m.id IS DISTINCT FROM v_origin
     AND mi.restaurant_id = NEW.restaurant_id
     AND mi.inventory_item_id = NEW.id
     AND mi.line_kind IS DISTINCT FROM 'dish'
     AND mi.price_flag IS NOT NULL
     AND (mi.bottle_price IS NOT NULL OR NEW.menu_price_current IS NULL)
     AND (mi.by_glass_price IS NOT NULL OR NEW.menu_price_glass IS NULL)
     AND (mi.bottle_price IS NOT NULL OR mi.by_glass_price IS NOT NULL);
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.current_menu_line_follows_house_price() FROM PUBLIC, anon, authenticated;
