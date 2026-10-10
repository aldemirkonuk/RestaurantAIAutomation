-- An order remembers how many bottles it put "on order" (F-491, F-494; ADR 0325).
--
-- Approving an order adds its bottles to the item's shadow stock and
-- in-transit counter; cancelling or delivering it takes them off again. The
-- release was decided from the STATUS the order left, never from what the
-- order had actually reserved, so:
--   - a vendor's decline (APPROVED -> NEGOTIATING) followed by a reject
--     released nothing, and the bottles stayed "on order" for good;
--   - approving again after the decline reserved a second time;
--   - an order in cases reserved its case count and delivery released bottles,
--     draining other orders' reservations.
--
-- reserved_bottles is that record:
--   NULL  this order never put anything on order;
--   N > 0 N bottles are on order for it and not yet released;
--   0     it was released, or nothing could be reserved (pack size unknown).
-- The gateway claims it with a compare-and-set from NULL (reserve once) and
-- takes it back with a compare-and-set to 0 (release once).

alter table public.procurement_orders
  add column if not exists reserved_bottles integer;

alter table public.procurement_orders
  drop constraint if exists procurement_orders_reserved_bottles_check,
  add  constraint procurement_orders_reserved_bottles_check
       check (reserved_bottles is null or reserved_bottles >= 0);

comment on column public.procurement_orders.reserved_bottles is
  'Bottles this order put on order (shadow stock + in transit) and has not yet released. '
  'NULL = never reserved; 0 = released or nothing could be reserved. Written only by the '
  'gateway''s reserve/release paths (F-491, ADR 0325).';

-- Orders already holding a reservation under the old rule. The old reserve
-- added `quantity` (in the order's own unit) when an item was named, and the
-- old release took it back on cancel from APPROVED, CONFIRMED or IN_TRANSIT.
-- Those orders, plus an approved order a vendor's decline sent back to
-- NEGOTIATING (approved_at is written only by the approve paths), are given
-- the amount they actually reserved, so they release exactly that.
update public.procurement_orders
   set reserved_bottles = quantity
 where reserved_bottles is null
   and inventory_id is not null
   and quantity > 0
   and (
         status in ('APPROVED', 'CONFIRMED', 'IN_TRANSIT')
      or (status = 'NEGOTIATING' and approved_at is not null)
   );
