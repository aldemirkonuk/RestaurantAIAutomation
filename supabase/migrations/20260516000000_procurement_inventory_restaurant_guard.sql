-- Enforce that a procurement order's inventory_id must belong to the same restaurant.
-- Prevents a crafted API request from linking Restaurant A's order to Restaurant B's inventory.
-- Uses a trigger instead of a CHECK constraint because the cross-table assertion requires
-- a lookup into restaurant_inventory.

CREATE OR REPLACE FUNCTION fn_check_order_inventory_restaurant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  inv_restaurant_id UUID;
BEGIN
  -- Only validate when inventory_id is set
  IF NEW.inventory_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT restaurant_id INTO inv_restaurant_id
  FROM restaurant_inventory
  WHERE id = NEW.inventory_id;

  IF inv_restaurant_id IS DISTINCT FROM NEW.restaurant_id THEN
    RAISE EXCEPTION
      'inventory_id % belongs to restaurant %, not %',
      NEW.inventory_id, inv_restaurant_id, NEW.restaurant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_inventory_restaurant ON procurement_orders;

CREATE TRIGGER trg_order_inventory_restaurant
  BEFORE INSERT OR UPDATE OF inventory_id, restaurant_id
  ON procurement_orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_order_inventory_restaurant();
