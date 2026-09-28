-- A receipt verification is an event row, and an auction lot states its cost
-- in the house's currency — the founder's answers (8), (10) and (11) of
-- 2026-09-21.
--
-- (8) ADR 0192 APPLIES TO THE SIBLING COLUMNS
-- -------------------------------------------
-- *Accepted, rejected, backorder and invoice quantities are answered from the
-- ledger / receipt event rows in one stated unit, and the app stops reading
-- and writing those columns.* `procurement_orders.accepted_quantity`,
-- `rejected_quantity`, `invoice_quantity` and `backorder_quantity` were
-- written by `verifyReceipt` alone, in two units at once (accepted and rejected
-- in the COUNTED unit, backorder in bottles from the match), and overwritten on
-- every re-verification. From now on:
--   * accepted  = the ledger's live sum for the order's item (ADR 0192's
--                 "received"; the verification's correction already moved it);
--   * rejected  = the door's `rejected_qty_bottles` plus the desk's, where the
--                 desk's is this new event row's own `rejected_qty_bottles`;
--   * invoice   = `invoice_qty_bottles` on the latest `reconciled` event;
--   * backorder = ordered bottles minus the ledger's count, never below zero.
-- All in BOTTLES. The verification writes one `reconciled` row per run (the
-- stage `procurement_receipt_events` has admitted since the baseline and no
-- code wrote); the latest one is the verification of record.
--
-- (10) A FOREIGN-CURRENCY LOT STATES ITS HOUSE COST
-- -------------------------------------------------
-- *Record the exchange rate the person states AND let them type the
-- per-bottle cost in the house currency (people round); a typed house cost
-- wins, both are recorded, nothing inferred.* `inventory_lots.unit_cost` is
-- read everywhere as the house's own money, and an auction lot's (hammer +
-- premium) / bottles is in the LOT's currency. So the record keeps:
--   house_currency     the house's currency when the lot was recorded
--                      (`restaurants.currency`, read by the gateway, never typed)
--   exchange_rate      what the person said 1 unit of the lot's currency was
--                      worth in the house's currency (NULL = not stated)
--   house_unit_cost    what the person typed as the per-bottle cost in the
--                      house's currency (NULL = not typed)
--   booked_unit_cost   the per-bottle cost the book was given: the typed house
--                      cost when there is one, else the lot's per-bottle cost
--                      times the stated rate, else (same currency) the lot's
--                      per-bottle cost. Never a looked-up rate.
-- A lot in another currency with neither a rate nor a typed cost is refused by
-- the CHECK: there is no honest number to book.
--
-- (11) THE LOT NUMBER IS OPTIONAL
-- -------------------------------
-- The auction house and the sale date stay required. The existing CHECK
-- `btrim(lot_number) <> ''` still refuses a blank; a NULL passes it.
--
-- Additive: nullable columns, one DROP NOT NULL, CHECKs over columns that start
-- NULL. Idempotent; assertions at the bottom.

-- ---------------------------------------------------------------------------
-- (8) the reconciled event's invoice quantity, in bottles.
-- ---------------------------------------------------------------------------
ALTER TABLE public.procurement_receipt_events
  ADD COLUMN IF NOT EXISTS invoice_qty_bottles NUMERIC(12,3);

ALTER TABLE public.procurement_receipt_events
  DROP CONSTRAINT IF EXISTS procurement_receipt_events_invoice_qty_bottles_check;
ALTER TABLE public.procurement_receipt_events
  ADD CONSTRAINT procurement_receipt_events_invoice_qty_bottles_check CHECK (
    invoice_qty_bottles IS NULL OR (invoice_qty_bottles >= 0 AND stage = 'reconciled')
  );

COMMENT ON COLUMN public.procurement_receipt_events.invoice_qty_bottles IS
  'On a reconciled (verification) row only: what the invoice billed, in bottles, as computeMatch converted it. NULL = no invoice was verified. ADR 0192 amendment, 2026-09-21.';

-- ---------------------------------------------------------------------------
-- (10) and (11) the auction lot's record.
-- ---------------------------------------------------------------------------
ALTER TABLE public.auction_lot_records
  ALTER COLUMN lot_number DROP NOT NULL;

ALTER TABLE public.auction_lot_records
  ADD COLUMN IF NOT EXISTS house_currency CHARACTER VARYING(3),
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,8),
  ADD COLUMN IF NOT EXISTS house_unit_cost NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS booked_unit_cost NUMERIC(12,2);

ALTER TABLE public.auction_lot_records
  DROP CONSTRAINT IF EXISTS auction_lot_records_house_currency_is_a_code;
ALTER TABLE public.auction_lot_records
  ADD CONSTRAINT auction_lot_records_house_currency_is_a_code CHECK (
    house_currency IS NULL OR house_currency ~ '^[A-Z]{3}$'
  );

ALTER TABLE public.auction_lot_records
  DROP CONSTRAINT IF EXISTS auction_lot_records_rate_positive;
ALTER TABLE public.auction_lot_records
  ADD CONSTRAINT auction_lot_records_rate_positive CHECK (exchange_rate IS NULL OR exchange_rate > 0);

ALTER TABLE public.auction_lot_records
  DROP CONSTRAINT IF EXISTS auction_lot_records_house_cost_not_negative;
ALTER TABLE public.auction_lot_records
  ADD CONSTRAINT auction_lot_records_house_cost_not_negative CHECK (
    (house_unit_cost IS NULL OR house_unit_cost >= 0)
    AND (booked_unit_cost IS NULL OR booked_unit_cost >= 0)
  );

-- A lot recorded from now on names the house's currency and what was booked.
-- A foreign lot states a rate or a typed house cost; a same-currency lot needs
-- neither. Rows written before this file (house_currency NULL) are left as
-- they were: what they booked was never recorded, and nothing is inferred.
ALTER TABLE public.auction_lot_records
  DROP CONSTRAINT IF EXISTS auction_lot_records_foreign_lot_states_its_house_cost;
ALTER TABLE public.auction_lot_records
  ADD CONSTRAINT auction_lot_records_foreign_lot_states_its_house_cost CHECK (
    house_currency IS NULL
    OR (
      booked_unit_cost IS NOT NULL
      AND (
        currency = house_currency
        OR exchange_rate IS NOT NULL
        OR house_unit_cost IS NOT NULL
      )
    )
  );

COMMENT ON COLUMN public.auction_lot_records.exchange_rate IS
  'What the person said one unit of the lot''s currency was worth in house_currency. Stated, never looked up. NULL = not stated.';
COMMENT ON COLUMN public.auction_lot_records.house_unit_cost IS
  'The per-bottle cost the person typed in house_currency (people round). When present it is what the book was given (founder, 2026-09-21: a typed house cost wins).';
COMMENT ON COLUMN public.auction_lot_records.booked_unit_cost IS
  'The per-bottle cost, in house_currency, the carry gave inventory_lots.unit_cost: house_unit_cost when typed, else the lot''s per-bottle cost times exchange_rate, else (same currency) the lot''s per-bottle cost.';
COMMENT ON COLUMN public.auction_lot_records.lot_number IS
  'The auction''s lot number, when the person has one (optional since 2026-09-21; a blank is refused, a NULL is "not stated").';

DO $$
DECLARE
  c TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY['house_currency', 'exchange_rate', 'house_unit_cost', 'booked_unit_cost'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'auction_lot_records' AND column_name = c
    ) THEN
      RAISE EXCEPTION 'auction_lot_records.% was not added', c;
    END IF;
  END LOOP;
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'auction_lot_records' AND column_name = 'lot_number') <> 'YES' THEN
    RAISE EXCEPTION 'auction_lot_records.lot_number is still required';
  END IF;
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'auction_lot_records' AND column_name = 'auction_house') <> 'NO'
     OR (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'auction_lot_records' AND column_name = 'sale_date') <> 'NO' THEN
    RAISE EXCEPTION 'the auction house and the sale date must stay required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'procurement_receipt_events' AND column_name = 'invoice_qty_bottles'
  ) THEN
    RAISE EXCEPTION 'procurement_receipt_events.invoice_qty_bottles was not added';
  END IF;
END
$$;
