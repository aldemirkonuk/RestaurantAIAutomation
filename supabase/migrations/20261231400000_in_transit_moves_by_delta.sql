-- F-351 (2026-10-08 concurrency sim, wave 6): `in_transit_quantity` is the
-- "on order" counter /ask reads as "Recorded in transit"
-- (ask-readings/reading-runner.ts). Every writer read it, did the sum in the
-- gateway, then wrote the absolute result back: approval's reserve and the
-- cancel/close release (procurement.service.ts), the delivery booking
-- (markDelivered) and the door's late naming (delivery-item-to-name.ts). Two
-- of those on the same item at the same moment both read the old figure, and
-- the second write erased the first change.
--
-- This moves the counter by a delta in ONE statement, so the row lock does
-- the ordering and no change is lost. Floored at 0, which is what every
-- caller already did with Math.max(0, ...). Returns the new figure, or NULL
-- when the item is not this house's (nothing is changed then).
CREATE OR REPLACE FUNCTION public.move_in_transit_by_delta(
  p_restaurant_id uuid,
  p_inventory_id  uuid,
  p_delta         integer
)
RETURNS integer
LANGUAGE sql
VOLATILE
SET search_path = public, pg_temp
AS $function$
  UPDATE public.restaurant_inventory
     SET in_transit_quantity = GREATEST(0, COALESCE(in_transit_quantity, 0) + p_delta)
   WHERE restaurant_id = p_restaurant_id
     AND id = p_inventory_id
  RETURNING in_transit_quantity;
$function$;

COMMENT ON FUNCTION public.move_in_transit_by_delta(uuid, uuid, integer) IS
  'F-351: moves restaurant_inventory.in_transit_quantity by p_delta in one '
  'statement, floored at 0, so two moves on one item cannot lose either. '
  'service_role only: p_restaurant_id is a parameter, so EXECUTE is a tenancy '
  'boundary.';

REVOKE ALL ON FUNCTION public.move_in_transit_by_delta(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_in_transit_by_delta(uuid, uuid, integer)
  TO service_role;
