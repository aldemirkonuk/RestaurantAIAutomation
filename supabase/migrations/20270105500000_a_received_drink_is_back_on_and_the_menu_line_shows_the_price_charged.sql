-- A RECEIVED DRINK IS BACK ON, AND THE MENU LINE SHOWS THE PRICE CHARGED.
-- F-145 and F-618 (sim ledger; coordinator calls S195, 2026-10-11, on the
-- founder's delegation: "If your decision is high industry standard, just do
-- it").
--
-- F-145. A drink is 86'd while it has an open stock_outs row
-- (20261231900000). Nothing ended one but a person, so a Tito's 86'd after a
-- breakage stayed sold out after the next case was booked in. Every till
-- clears an 86 when stock comes back; S195 makes that the rule here and
-- replaces D1's "nothing auto-closes it". A live receipt (an
-- inventory_transactions row of type 'purchase' that adds bottles to live
-- stock, which every receiving path writes through apply_stock_movement)
-- ends the item's open stock-out, names the ledger row that ended it
-- (stock_outs.ended_by_receipt) and files one system_audit_log row,
-- drink_back_on. A count, a transfer or a return does not end it: only a
-- delivery says the shelf was refilled. A failure here never refuses the
-- receipt: the drink stays sold out, which is the safe side, and a warning
-- is raised.
--
-- F-618. /menu printed the menu line's price while /inventory, the reports
-- and the till read the house price (restaurant_inventory.menu_price_current
-- / menu_price_glass), and three acts moved the house price without the line:
-- "Your price" on /inventory, accepted advice, and a lock's change. A chosen
-- menu already sets the house price (ADR 0193 item 4, round 2 answer 7). Now
-- any OTHER change of the house price is written onto the house's CURRENT
-- menu's lines for that wine, so the line on the current menu is the price
-- charged. A change the menu itself made (change_source 'import', set by
-- set_house_menu_price) is skipped: the line already holds it, and a wine
-- listed twice is not rewritten by its own other line. Draft and archived
-- menus keep what they read. A discarded line is left alone. A blank kind is
-- filled, and a blank-price flag is cleared once no blank remains beside a
-- house price. What this does NOT change (ADR 0193, locked): a lock still
-- keeps its price against a chosen menu ("The menu sets it, locks keep"),
-- and a menu price older than the price in effect is still refused as stale
-- with the line keeping its own (item 3); in those two cases the line and
-- the house still differ and /menu still says so.
--
-- LOCKS. ALTER TABLE stock_outs (a small new table) takes ACCESS EXCLUSIVE
-- for a catalogue-only change (nullable column, no default, no rewrite).
-- CREATE TRIGGER takes SHARE ROW EXCLUSIVE on inventory_transactions and
-- restaurant_inventory for an instant. Re-runnable: IF NOT EXISTS, CREATE OR
-- REPLACE, DROP TRIGGER IF EXISTS. This migration writes no row.

ALTER TABLE public.stock_outs
  ADD COLUMN IF NOT EXISTS ended_by_receipt uuid;

COMMENT ON COLUMN public.stock_outs.ended_by_receipt IS
  'F-145 (S195): the inventory_transactions row (a live purchase) whose delivery brought the item back. NULL when a person ended it (ended_by) or it is still open. No FK: the ledger row is read for the record, never cascaded.';

CREATE OR REPLACE FUNCTION public.end_stock_out_on_receipt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ended record;
BEGIN
  BEGIN
    UPDATE public.stock_outs
       SET ended_at = greatest(now(), started_at),
           ended_by = NULL,
           ended_by_receipt = NEW.id
     WHERE inventory_id = NEW.inventory_id
       AND restaurant_id = NEW.restaurant_id
       AND ended_at IS NULL
    RETURNING id, cause INTO v_ended;
    IF FOUND THEN
      INSERT INTO public.system_audit_log
        (actor_type, actor_id, action, entity_type, entity_id, restaurant_id, reason, changes)
      VALUES
        (CASE WHEN NEW.performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
         NEW.performed_by, 'drink_back_on', 'inventory_item', NEW.inventory_id,
         NEW.restaurant_id, 'stock received',
         jsonb_build_object(
           'subject', (SELECT coalesce(nullif(ri.wine_name, ''), mwl.name)
                         FROM public.restaurant_inventory ri
                         LEFT JOIN public.master_wine_library mwl ON mwl.id = ri.master_wine_id
                        WHERE ri.id = NEW.inventory_id),
           'fields', jsonb_build_object('sold_out', jsonb_build_object('from', true, 'to', false)),
           'stock_out_id', v_ended.id,
           'cause', v_ended.cause,
           'ended_by_receipt', NEW.id));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'end_stock_out_on_receipt: item % stays sold out; the receipt stands (%)',
      NEW.inventory_id, SQLERRM;
  END;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS end_stock_out_on_receipt ON public.inventory_transactions;
CREATE TRIGGER end_stock_out_on_receipt
  AFTER INSERT ON public.inventory_transactions
  FOR EACH ROW
  WHEN (NEW.transaction_type = 'purchase'
        AND NEW.quantity_change > 0
        AND NEW.stock_type = 'live')
  EXECUTE FUNCTION public.end_stock_out_on_receipt();

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
BEGIN
  IF coalesce(nullif(current_setting('mudavym.menu_price_source', true), ''), '') = 'import'
     OR NOT (v_bottle OR v_glass) THEN
    RETURN NEW;
  END IF;

  UPDATE public.menu_items mi
     SET bottle_price   = CASE WHEN v_bottle THEN NEW.menu_price_current ELSE mi.bottle_price END,
         by_glass_price = CASE WHEN v_glass THEN NEW.menu_price_glass ELSE mi.by_glass_price END
    FROM public.restaurant_menus m
   WHERE m.id = mi.menu_id
     AND m.restaurant_id = NEW.restaurant_id
     AND m.status = 'active'
     AND mi.restaurant_id = NEW.restaurant_id
     AND mi.inventory_item_id = NEW.id
     AND mi.status IS DISTINCT FROM 'discarded'
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
     AND mi.restaurant_id = NEW.restaurant_id
     AND mi.inventory_item_id = NEW.id
     AND mi.price_flag IS NOT NULL
     AND (mi.bottle_price IS NOT NULL OR NEW.menu_price_current IS NULL)
     AND (mi.by_glass_price IS NOT NULL OR NEW.menu_price_glass IS NULL)
     AND (mi.bottle_price IS NOT NULL OR mi.by_glass_price IS NOT NULL);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS current_menu_line_follows_house_price ON public.restaurant_inventory;
CREATE TRIGGER current_menu_line_follows_house_price
  AFTER UPDATE OF menu_price_current, menu_price_glass ON public.restaurant_inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.current_menu_line_follows_house_price();

REVOKE ALL ON FUNCTION public.end_stock_out_on_receipt() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_menu_line_follows_house_price() FROM PUBLIC, anon, authenticated;
