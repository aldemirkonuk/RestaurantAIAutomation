-- A delivery event follows its order, and the table keeps it so (ADR 0284).
--
-- WHAT WAS WRONG (F-152 / A-034, owner-quarter sim, read-only walk 2026-10-03)
-- ---------------------------------------------------------------------------
-- Tuzlu Rüzgar's October calendar held 534 delivery events, every one
-- `pending`, every one dated 9 October at 10:00, and all 87 whose orders were
-- read belonged to COMPLETED orders. Two faults made that:
--
--   * Only two gateway paths closed an event: `cancelOrder` and
--     `markDelivered`. The door receipt (receiving.service.ts writes
--     PARTIALLY_RECEIVED and `delivered_at`), `verifyReceipt` (COMPLETED or
--     PARTIALLY_RECEIVED), `PATCH /procurement/orders/:id`, the Python agent's
--     out-of-stock cancel (procurement_agent.py writes CANCELLED straight to the
--     table) and REJECTED/FAILED after approval closed nothing. The sim went
--     door receipt, then verify, so no closer ever ran.
--   * Closing never moved the date. An arrived order's event stayed on the
--     approval + 7 estimate instead of the day the goods came.
--
-- WHY THE TABLE, NOT THE GATEWAY
-- ------------------------------
-- The founder answered this class in ADR 0125 Q2 ("Enforce the table as a
-- database trigger"): a gateway rule cannot reach procurement_agent.py, the sim
-- harness or the SQL console. One function, reached by every writer of
-- `procurement_orders.status` / `.delivered_at`, replaces the two TypeScript
-- closers, which this same change deletes.
--
-- THE RULE (one function, two triggers)
-- -------------------------------------
--   arrived     (ORDER_GOODS_ARRIVED_STATUSES: DELIVERED, PARTIALLY_RECEIVED,
--               COMPLETED) -> the event is `completed`, on the house-local
--               date and time of `delivered_at`. PARTIALLY_RECEIVED closes it
--               too: the door is where a delivery ends (ADR 0267 ruling 1,
--               "At the door"); what is still owed shows on the order.
--   not coming  (ORDER_TERMINAL_STATUSES minus the arrived set: CANCELLED,
--               REJECTED, FAILED) -> the event is `cancelled`, its date kept.
--   ADR 0073's asymmetry is kept: an arrival closes even a cancelled event, and
--   a cancellation never touches a completed one. Matched on `order_id` within
--   the house, in CalendarEventStatus's lowercase words (ADR 0066 / 0073).
--   A closed delivery reminds nobody, so `reminder_enabled` goes false: the
--   reminder sweep (calendar-reminders.service.ts) skips cancelled rows but not
--   completed ones, and an arrival with no recorded time keeps its expected
--   date, which may still be ahead.
--
-- THE sync_calendar_dates_trigger TRAP
-- ------------------------------------
-- `sync_calendar_event_date_columns()` (baseline) copies a non-null
-- `start_time` over `event_time` on EVERY update. The gateway's insert writes
-- `event_time` 10:00 and the trigger fills `start_time` from it, so writing
-- `event_time` alone is silently undone. Both pairs (start_date/event_date,
-- start_time/event_time) are written together here, always.
--
-- NEVER FAILS AN ORDER OVER A CALENDAR ROW (ADR 0066)
-- ---------------------------------------------------
-- Both trigger functions catch every error from the helper and RAISE WARNING
-- with the order id; the order write stands. The helper itself raises
-- normally, so a direct caller (a future repair, ADR 0284 fork 1) is told.
-- This is quieter than the gateway's logger.error was: PostgREST does not pass
-- a WARNING to its caller, and it lands only in the Postgres log.
--
-- NOT DONE HERE: no backfill of the events written before this file (ADR 0284
-- fork 1, the founder's call). Additive: one index, three functions, two
-- triggers; no table, no column, no row.

-- Every close is an index hit. Before this, matching on order_id scanned the
-- whole house through idx_calendar_events_restaurant.
CREATE INDEX IF NOT EXISTS idx_calendar_events_order_delivery
  ON public.calendar_events (order_id)
  WHERE order_id IS NOT NULL AND event_type = 'delivery';

CREATE OR REPLACE FUNCTION public.delivery_event_follows_its_order(
  p_order_id      uuid,
  p_restaurant_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  -- GENERATED from ORDER_GOODS_ARRIVED_STATUSES (order-transitions.ts),
  -- sorted. order-calendar-event-lifecycle.spec.ts renders it and asserts this
  -- text character for character. Regenerate, never hand-edit.
  arrived    text[] := ARRAY['COMPLETED', 'DELIVERED', 'PARTIALLY_RECEIVED'];
  -- GENERATED from ORDER_TERMINAL_STATUSES minus ORDER_GOODS_ARRIVED_STATUSES,
  -- sorted. Pinned by the same spec.
  not_coming text[] := ARRAY['CANCELLED', 'FAILED', 'REJECTED'];
  v_status       text;
  v_delivered_at timestamptz;
  v_number       text;
  v_zone         text;
  v_local        timestamp;
  v_n            integer := 0;
BEGIN
  IF p_order_id IS NULL OR p_restaurant_id IS NULL THEN
    RETURN 0;
  END IF;

  -- The order, read in the same house. An event filed under another house than
  -- its order is not this order's to move.
  SELECT o.status::text, o.delivered_at, o.order_number::text
    INTO v_status, v_delivered_at, v_number
    FROM public.procurement_orders o
   WHERE o.id = p_order_id
     AND o.restaurant_id = p_restaurant_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF v_status = ANY (arrived) THEN
    IF v_delivered_at IS NULL THEN
      -- Arrived, but the order does not say when. Closed; the date is not
      -- invented.
      UPDATE public.calendar_events e
         SET status = 'completed',
             reminder_enabled = false,
             description = format(
               'Delivered: %s. The order does not record when it arrived, so this stays on the date it was expected.',
               v_number)
       WHERE e.restaurant_id = p_restaurant_id
         AND e.order_id = p_order_id
         AND e.event_type = 'delivery'
         AND e.status IS DISTINCT FROM 'completed';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      RETURN v_n;
    END IF;

    -- The house's own clock. A house with no zone set, or one Postgres cannot
    -- read, falls back to UTC and the text says which; it never fails the
    -- order. "Not set" is said, not hidden behind a bare "UTC": the founder's
    -- ruling for a house with no zone is "UTC, said on the page" (ADR 0149,
    -- 2026-09-27, item 61), and since ADR 0116 a null zone means nobody
    -- stated one.
    SELECT NULLIF(btrim(r.timezone::text), '')
      INTO v_zone
      FROM public.restaurants r
     WHERE r.id = p_restaurant_id;
    BEGIN
      IF v_zone IS NULL THEN
        v_local := date_trunc('minute', v_delivered_at AT TIME ZONE 'UTC');
        v_zone := 'UTC; the house has no time zone set';
      ELSE
        v_local := date_trunc('minute', v_delivered_at AT TIME ZONE v_zone);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_local := date_trunc('minute', v_delivered_at AT TIME ZONE 'UTC');
      v_zone := 'UTC; the house''s time zone could not be read';
    END;

    -- Not yet completed, or completed somewhere other than the arrival: both
    -- are moved. An already-matching row is left alone, so a second status
    -- move (PARTIALLY_RECEIVED -> COMPLETED) with the same delivered_at writes
    -- nothing.
    UPDATE public.calendar_events e
       SET status = 'completed',
           start_date = v_local::date,
           event_date = v_local::date,
           start_time = v_local::time,
           event_time = v_local::time,
           all_day = false,
           reminder_enabled = false,
           description = format('Delivered: %s, arrived %s (%s).',
             v_number, to_char(v_local, 'YYYY-MM-DD HH24:MI'), v_zone)
     WHERE e.restaurant_id = p_restaurant_id
       AND e.order_id = p_order_id
       AND e.event_type = 'delivery'
       AND (e.status IS DISTINCT FROM 'completed'
            OR e.start_date IS DISTINCT FROM v_local::date
            OR e.event_date IS DISTINCT FROM v_local::date
            OR e.start_time IS DISTINCT FROM v_local::time
            OR e.event_time IS DISTINCT FROM v_local::time);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END IF;

  IF v_status = ANY (not_coming) THEN
    -- A recorded arrival is a physical fact and an administrative end does not
    -- erase it; an event already cancelled keeps its first reason.
    UPDATE public.calendar_events e
       SET status = 'cancelled',
           reminder_enabled = false,
           description = format('Order %s %s; this delivery is not coming.',
             v_number,
             CASE v_status WHEN 'FAILED' THEN 'failed' ELSE 'was ' || lower(v_status) END)
     WHERE e.restaurant_id = p_restaurant_id
       AND e.order_id = p_order_id
       AND e.event_type = 'delivery'
       AND COALESCE(e.status, '') NOT IN ('completed', 'cancelled');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END IF;

  -- Still open: the event stays where it was placed.
  RETURN 0;
END;
$fn$;

COMMENT ON FUNCTION public.delivery_event_follows_its_order(uuid, uuid) IS
  'ADR 0284. Moves the delivery calendar events of one order, in one house, to match the order: arrived -> completed on the house-local arrival date and time; cancelled, rejected or failed -> cancelled, date kept; open -> untouched. Returns the rows it changed. Raises on error; the two triggers that call it catch and WARN instead.';

-- Reached through the triggers by whoever writes the order (the service role,
-- or postgres at the console). Not a client RPC.
REVOKE ALL ON FUNCTION public.delivery_event_follows_its_order(uuid, uuid) FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.delivery_event_follows_its_order(uuid, uuid) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.delivery_event_follows_its_order(uuid, uuid) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.delivery_event_follows_its_order(uuid, uuid) TO service_role';
  END IF;
END;
$grants$;

-- An order that moves takes its delivery event with it.
CREATE OR REPLACE FUNCTION public.procurement_order_moves_its_delivery_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  BEGIN
    PERFORM public.delivery_event_follows_its_order(NEW.id, NEW.restaurant_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Order % moved to % but its delivery calendar event did not follow (%: %). The order write stands.',
      NEW.id, NEW.status, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.procurement_order_moves_its_delivery_event() IS
  'ADR 0284. AFTER UPDATE OF status, delivered_at on procurement_orders: calls delivery_event_follows_its_order; never fails the order write.';

DROP TRIGGER IF EXISTS trg_procurement_order_moves_its_delivery_event
  ON public.procurement_orders;
CREATE TRIGGER trg_procurement_order_moves_its_delivery_event
  AFTER UPDATE OF status, delivered_at ON public.procurement_orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
        OR OLD.delivered_at IS DISTINCT FROM NEW.delivered_at)
  EXECUTE FUNCTION public.procurement_order_moves_its_delivery_event();

-- An event written for an order that has already arrived, or never will, is
-- closed at birth. approveDraft writes the event when the vendor letter goes,
-- whatever the order's state by then, and no later order write would reach it.
CREATE OR REPLACE FUNCTION public.delivery_event_is_born_matching_its_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  BEGIN
    PERFORM public.delivery_event_follows_its_order(NEW.order_id, NEW.restaurant_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Delivery calendar event % for order % was written but could not be matched to the order (%: %). The event stands as written.',
      NEW.id, NEW.order_id, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.delivery_event_is_born_matching_its_order() IS
  'ADR 0284. AFTER INSERT on calendar_events for a delivery event with an order_id: calls delivery_event_follows_its_order; never fails the insert.';

DROP TRIGGER IF EXISTS trg_delivery_event_is_born_matching_its_order
  ON public.calendar_events;
CREATE TRIGGER trg_delivery_event_is_born_matching_its_order
  AFTER INSERT ON public.calendar_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'delivery' AND NEW.order_id IS NOT NULL)
  EXECUTE FUNCTION public.delivery_event_is_born_matching_its_order();

-- In-file assertions: the catalog only, so this proves itself on a populated
-- database without touching a row.
DO $assert$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('delivery_event_follows_its_order',
                       'procurement_order_moves_its_delivery_event',
                       'delivery_event_is_born_matching_its_order')
     AND NOT p.prosecdef;
  IF n <> 3 THEN
    RAISE EXCEPTION 'expected 3 SECURITY INVOKER functions, found %', n;
  END IF;

  SELECT count(*) INTO n
    FROM pg_trigger
   WHERE NOT tgisinternal
     AND ((tgname = 'trg_procurement_order_moves_its_delivery_event'
           AND tgrelid = 'public.procurement_orders'::regclass)
       OR (tgname = 'trg_delivery_event_is_born_matching_its_order'
           AND tgrelid = 'public.calendar_events'::regclass));
  IF n <> 2 THEN
    RAISE EXCEPTION 'expected 2 delivery-event triggers, found %', n;
  END IF;

  IF to_regclass('public.idx_calendar_events_order_delivery') IS NULL THEN
    RAISE EXCEPTION 'idx_calendar_events_order_delivery was not created';
  END IF;
END;
$assert$;
