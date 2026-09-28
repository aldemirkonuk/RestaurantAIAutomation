-- A delivery_item_to_name ask closes itself when the order it names gets its
-- stock booked some other way — the founder's answer of 2026-09-22
-- (round 6z) on ADR 0192's residual, verbatim pick:
--   (2) "Close by itself (Recommended)"
--
-- WHAT WAS BROKEN
-- ----------------
-- `nameDeliveredItem` (apps/api-gateway/src/procurement/
-- delivery-item-to-name.ts) already refused to double-book an order the
-- receiving door had booked since (`deliveryHasBookedOrder`, a 409) — but
-- the `delivery_item_to_name` row stayed `open` forever: the E4 last call
-- named this residual verbatim ("An ask outlives a booking made elsewhere:
-- it stays listed, and naming it returns 409"). The house kept seeing a
-- waiting ask for an order that no longer needed naming.
--
-- WHAT CHANGES ON delivery_item_to_name (20260921170530)
-- --------------------------------------------------------
--   status         widens to open | named | booked_elsewhere
--   closed_at      when the order was found already booked
--   closed_reason  why, in words (the receiving door, or a verification)
-- A `booked_elsewhere` row must say when and why (CHECK), same shape as
-- `named` must say who/when/what. Closing is written by the app
-- (`closeDeliveryItemToNameBookedElsewhere`, delivery-item-to-name.ts),
-- conditional on `status = 'open'` — the same "once" pattern the naming
-- claim already uses — from the two paths that book stock outside naming:
-- the receiving door (`ReceivingService.recordDoorReceipt`,
-- `DeliveryStockService.bookAtTheDoor`) and a verification correction
-- (`ProcurementService.applyReceiptAdjustment`). `readOpenDeliveryItemsToName`
-- already filters on `status = 'open'`, so a closed ask stops being listed
-- as soon as it closes — "shown as such" needs no separate read path.
--
-- `nameDeliveredItem`'s status branch now tells the caller WHY a
-- `booked_elsewhere` ask cannot be named, instead of the generic "already
-- named" message (which was true only for `named`) — "naming it no longer
-- 409s silently".
--
-- Additive (nullable columns, a widened CHECK, a new closed-on-the-record
-- CHECK), idempotent, actor-free (the closer names no person — neither
-- booking path that triggers it carries a "who closed this ask" concept of
-- its own; the reason names what closed it). RLS is unchanged (on,
-- service_role only, from 20260921170530). Assertions at the bottom.

ALTER TABLE public.delivery_item_to_name
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_reason TEXT;

ALTER TABLE public.delivery_item_to_name
  DROP CONSTRAINT IF EXISTS delivery_item_to_name_status_known;
ALTER TABLE public.delivery_item_to_name
  ADD CONSTRAINT delivery_item_to_name_status_known
  CHECK (status IN ('open', 'named', 'booked_elsewhere'));

ALTER TABLE public.delivery_item_to_name
  DROP CONSTRAINT IF EXISTS delivery_item_to_name_booked_elsewhere_on_the_record;
ALTER TABLE public.delivery_item_to_name
  ADD CONSTRAINT delivery_item_to_name_booked_elsewhere_on_the_record
  CHECK ((status = 'booked_elsewhere') = (closed_at IS NOT NULL AND closed_reason IS NOT NULL));

COMMENT ON COLUMN public.delivery_item_to_name.closed_reason IS
  'Why a booked_elsewhere ask closed itself: the receiving door or a verification booked this order''s stock before its item was named (founder, 2026-09-22: "Close by itself", ADR 0192).';

DO $$
DECLARE
  c TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY['closed_at', 'closed_reason'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'delivery_item_to_name' AND column_name = c
    ) THEN
      RAISE EXCEPTION 'delivery_item_to_name.% was not added', c;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = to_regclass('public.delivery_item_to_name')
       AND conname = 'delivery_item_to_name_booked_elsewhere_on_the_record'
  ) THEN
    RAISE EXCEPTION 'delivery_item_to_name has no booked-elsewhere-on-the-record CHECK';
  END IF;
  RAISE NOTICE 'delivery_item_to_name: a booked-elsewhere ask says when and why, and closes itself.';
END
$$;
