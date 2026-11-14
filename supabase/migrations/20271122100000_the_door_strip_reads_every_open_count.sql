-- the_door_strip_reads_every_open_count: the deliveries counted by case and
-- never closed, as one row per order, for the door strip (r41 invoices audit,
-- gap 6).
--
-- WRONG BEFORE: ReceivingService.listUnverifiedCapped read the house's newest
-- 500 procurement_receipt_events and worked out in the gateway which orders
-- were counted by case and never counted by bottle or reconciled. A house
-- writes a few events per delivery, so it passes 500 within a few months; from
-- then on an order whose case count is older than the newest 500 events
-- dropped out of the strip. Those are the OLDEST open counts, the "overdue"
-- ones the strip exists to chase, and the strip read as caught up. The read
-- computed `capped` and the route dropped it.
--
-- NOW: this view does the same work in the database over ALL of a house's
-- events, and returns only the orders still open. The gateway reads it to the
-- end (readWholeWindow, ADR 0292: keyset pages on `id`, the order's id, with
-- an exact count), so nothing is cut, and it ships the open orders instead of
-- 500 raw events.
--
-- The rules are the gateway's, unchanged:
--   * an order is open while none of its events is a bottle_count or a
--     reconciled, and its status is not COMPLETED or CANCELLED (a one-shot
--     delivery is closed without a bottle count);
--   * counted_qty_bottles and counted_at are those of its LATEST case_count;
--     with no case_count (only a signed_at_door), counted_qty_bottles is NULL
--     (the gateway prints 0, as before) and counted_at is its newest event.
-- One tightening: the order must be the event's own house's order
-- (o.restaurant_id = e.restaurant_id). The gateway never checked; an event
-- pointing at another house's order no longer prints that order's number in
-- this house's strip.
--
-- Speed: restaurant_id is a grouping column, so a read filtered by house
-- reaches idx_pre_restaurant before grouping and never touches another
-- house's events (checked in the test).

BEGIN;

CREATE VIEW public.procurement_door_counts_open
WITH (security_invoker = true) AS
SELECT e.order_id AS id,
       e.restaurant_id,
       o.order_number,
       (array_agg(e.counted_qty_bottles ORDER BY e.occurred_at DESC, e.id DESC)
          FILTER (WHERE e.stage = 'case_count'))[1] AS counted_qty_bottles,
       COALESCE(max(e.occurred_at) FILTER (WHERE e.stage = 'case_count'),
                max(e.occurred_at)) AS counted_at
  FROM public.procurement_receipt_events e
  JOIN public.procurement_orders o
    ON o.id = e.order_id
   AND o.restaurant_id = e.restaurant_id
 WHERE o.status NOT IN ('COMPLETED', 'CANCELLED')
 GROUP BY e.restaurant_id, e.order_id, o.order_number
HAVING NOT bool_or(e.stage IN ('bottle_count', 'reconciled'));

COMMENT ON VIEW public.procurement_door_counts_open IS
  'Deliveries counted at the order door and never closed: one row per order (id is the order''s id) with no bottle_count or reconciled event whose status is not COMPLETED or CANCELLED. counted_qty_bottles and counted_at are the latest case_count''s; with no case_count, counted_qty_bottles is NULL and counted_at is the newest event. Read by house (the_door_strip_reads_every_open_count); the door strip reads it to the end, so no open count is cut.';

REVOKE ALL ON public.procurement_door_counts_open FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.procurement_door_counts_open TO service_role;

DO $$
BEGIN
  IF NOT coalesce((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class
                    WHERE oid = 'public.procurement_door_counts_open'::regclass), false) THEN
    RAISE EXCEPTION 'the_door_strip_reads_every_open_count: the view must run as its caller';
  END IF;
  IF has_table_privilege('anon', 'public.procurement_door_counts_open', 'SELECT')
     OR has_table_privilege('authenticated', 'public.procurement_door_counts_open', 'SELECT') THEN
    RAISE EXCEPTION 'the_door_strip_reads_every_open_count: the view is reachable by a client role';
  END IF;
END;
$$;

COMMIT;
