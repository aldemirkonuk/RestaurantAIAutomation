-- A PULLED DRINK STAYS OFF AFTER A DELIVERY.
-- F-1465 (sim ledger, integ19-w95-97-regress).
--
-- 20270105500000 (F-145, S195) made a live receipt end the item's open
-- stock-out, whatever its cause. A stock-out records why (stock_outs.cause:
-- ran_out, broken, pulled, other; 20261231900000), and 'pulled' is the one
-- an owner sets on purpose with bottles still on the shelf ("we pulled it"
-- on the bottle leaf): a corked lot, a wine held for a tasting, a line taken
-- off the list. A delivery says nothing about that choice, so the next case
-- booked in put the drink back on sale behind the owner's back.
--
-- Now a receipt ends every open stock-out EXCEPT a pulled one, which stays
-- until a person puts the drink back (the gateway's end, stock_outs.ended_by).
-- 'broken' still ends on a receipt: it is S195's own case (a Tito's 86'd
-- after a breakage, back on when the next case lands). 'other' still ends
-- too: S195 made a receipt the rule for every 86, and only 'pulled' carries
-- a stated reason the shelf being refilled does not answer. Everything else
-- in the function is unchanged: the audit row, ended_by_receipt, and a
-- failure never refusing the receipt.
--
-- LOCKS. CREATE OR REPLACE FUNCTION only; the trigger 20270105500000 created
-- keeps pointing at it. No table is altered and no row is written.
-- Re-runnable.

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
       AND cause <> 'pulled'
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

REVOKE ALL ON FUNCTION public.end_stock_out_on_receipt() FROM PUBLIC, anon, authenticated;
