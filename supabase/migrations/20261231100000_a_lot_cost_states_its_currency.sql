-- A lot's cost states its currency (F-343, sim wave 5, 2026-10-09).
--
-- `inventory_lots.unit_cost` carries no currency (baseline :3180, and
-- 20261116100400:28 says so in as many words). Yet every writer puts a figure
-- in somebody's money there: delivery books the ORDER's per-bottle price in
-- the order's currency (`apply_stock_movement` from
-- ProcurementService.markDelivered), and verify overwrites it with the
-- INVOICE's price in the invoice's (`finalise_delivery_cost`). A house that
-- buys from a vendor billing in EUR and sells in TRY then gets
-- `inventory_lot_rollup.wac` in euros, and margin advice compares it with a
-- menu price in lira and says "raise to X".
--
-- Rule 3 of 20260905120000_a_house_names_its_money.sql: nothing converts; a
-- reader that would compare figures in different currencies refuses in words.
-- A reader cannot refuse what it cannot see, so the lot says its currency.
--
-- WHAT THIS FILE DOES (additive: one column, one CHECK, one trigger, a view
-- extended at its end, a backfill that copies a stated fact and guesses
-- nothing)
--
--   1. `inventory_lots.unit_cost_currency varchar(3)`, NULL-able, ISO 4217.
--      NULL means NOT STATED — every lot booked before this column existed.
--
--   2. A trigger copies the linked order's currency onto a lot that has a cost
--      and no currency, when `source_order_id` names an order of the SAME
--      house. Why a trigger and not a gateway write after the RPC: it is
--      atomic with the booking, and `transfer_stock` (baseline :1873) re-inserts
--      a moved lot copying `unit_cost` and `source_order_id` but no other
--      column, so a gateway-stamped currency would fall off on the first move.
--      SECURITY INVOKER: every writer of lots is the service role.
--
--   3. Backfill: the same copy, once, for lots already booked. A lot with no
--      order, or whose order names no currency, stays NULL. Nothing is
--      inferred from the vendor, the house or the price.
--
--   4. `inventory_lot_rollup` gains, AT ITS END (CREATE OR REPLACE VIEW can
--      only append), two columns over exactly the lots `wac` averages
--      (live, costed, not a sample, qty > 0):
--        cost_currency_count  how many distinct stated codes the WAC mixes
--        cost_currency        the one code when there is exactly one, else NULL
--      The body above them is 20260902150000_lot_cost_truth.sql:486 verbatim.

BEGIN;

ALTER TABLE public.inventory_lots
  -- `character varying(3)`, the width of every other currency column here.
  ADD COLUMN IF NOT EXISTS unit_cost_currency CHARACTER VARYING(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'inventory_lots_unit_cost_currency_is_iso_4217'
       AND conrelid = to_regclass('public.inventory_lots')
  ) THEN
    ALTER TABLE public.inventory_lots
      ADD CONSTRAINT inventory_lots_unit_cost_currency_is_iso_4217
      CHECK (unit_cost_currency IS NULL OR unit_cost_currency ~ '^[A-Z]{3}$');
  END IF;
END
$$;

COMMENT ON COLUMN public.inventory_lots.unit_cost_currency IS
  'The ISO 4217 code unit_cost is in: the order''s currency when the lot was booked from an order, the invoice''s once a delivery is verified (F-343, 2026-10-09). NULL = not stated, which is every lot booked before this column. Nothing converts: a reader comparing this cost with a menu price in the house''s money must refuse when the codes differ (20260905120000 rule 3).';

-- 2. The order's currency follows the lot it booked.
CREATE OR REPLACE FUNCTION public.a_lot_cost_takes_its_order_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.unit_cost IS NOT NULL
     AND NEW.unit_cost_currency IS NULL
     AND NEW.source_order_id IS NOT NULL THEN
    SELECT o.currency INTO NEW.unit_cost_currency
      FROM public.procurement_orders o
     WHERE o.id = NEW.source_order_id
       AND o.restaurant_id = NEW.restaurant_id;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.a_lot_cost_takes_its_order_currency() IS
  'F-343. A costed lot with no stated currency takes the currency of the order that booked it (same house only). Never overwrites a stated code; a lot with no order stays NULL.';

-- Reached only through the trigger. Not a client RPC.
REVOKE ALL ON FUNCTION public.a_lot_cost_takes_its_order_currency() FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.a_lot_cost_takes_its_order_currency() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.a_lot_cost_takes_its_order_currency() FROM authenticated';
  END IF;
END;
$grants$;

DROP TRIGGER IF EXISTS a_lot_cost_takes_its_order_currency ON public.inventory_lots;
CREATE TRIGGER a_lot_cost_takes_its_order_currency
  BEFORE INSERT OR UPDATE OF unit_cost, source_order_id ON public.inventory_lots
  FOR EACH ROW EXECUTE FUNCTION public.a_lot_cost_takes_its_order_currency();

-- 3. Backfill: copy, never guess.
UPDATE public.inventory_lots l
   SET unit_cost_currency = o.currency
  FROM public.procurement_orders o
 WHERE l.source_order_id = o.id
   AND o.restaurant_id = l.restaurant_id
   AND l.unit_cost IS NOT NULL
   AND l.unit_cost_currency IS NULL
   AND o.currency IS NOT NULL;

-- 4. The rollup says which money its WAC is in.
CREATE OR REPLACE VIEW public.inventory_lot_rollup AS
 SELECT inventory_id,
    restaurant_id,
    master_wine_id,
    COALESCE(sum(qty) FILTER (WHERE ((stock_state)::text = 'live'::text)), (0)::bigint) AS live_qty,
    COALESCE(sum(qty) FILTER (WHERE ((stock_state)::text = 'shadow'::text)), (0)::bigint) AS shadow_qty,
        CASE
            WHEN (COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))), (0)::bigint) > 0) THEN round((sum(((qty)::numeric * unit_cost)) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))) / (sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))))::numeric), 2)
            ELSE NULL::numeric
        END AS wac,
    bool_or(((cost_provenance)::text = 'invoice'::text)) FILTER (WHERE ((stock_state)::text = 'live'::text)) AS has_invoice_cost,
    count(*) FILTER (WHERE ((stock_state)::text = 'live'::text)) AS live_lot_count,
    count(DISTINCT location_id) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (location_id IS NOT NULL))) AS live_location_count,
    COALESCE(sum(open_bottle_ml) FILTER (WHERE ((stock_state)::text = 'live'::text)), (0)::bigint) AS open_ml,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND ((cost_provenance)::text = 'sample'::text))), (0)::bigint) AS sample_qty,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))), (0)::bigint) AS wac_qty,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND ((cost_provenance)::text = 'invoice'::text))), (0)::bigint) AS invoice_qty,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NULL) AND ((cost_provenance)::text <> 'sample'::text))), (0)::bigint) AS unpriced_qty,
    count(DISTINCT unit_cost_currency) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text) AND (qty > 0))) AS cost_currency_count,
        CASE
            WHEN (count(DISTINCT unit_cost_currency) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text) AND (qty > 0))) = 1) THEN (min((unit_cost_currency)::text) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text) AND (qty > 0))))::character varying(3)
            ELSE NULL::character varying(3)
        END AS cost_currency
   FROM public.inventory_lots
  GROUP BY inventory_id, restaurant_id, master_wine_id;

COMMENT ON VIEW public.inventory_lot_rollup IS
  'Per-inventory lot rollup. wac excludes sample lots. wac_qty / invoice_qty / '
  'unpriced_qty added 2026-09-02 (ADR 0078) so a consumer can tell per-row '
  'COVERAGE (has_invoice_cost: at least one invoiced bottle) from per-row '
  'COMPLETENESS (wac_qty = live_qty: the average covers every bottle it is '
  'quoted for). cost_currency_count / cost_currency added 2026-10-09 (F-343): '
  'the stated currencies among the lots wac averages. A count above 1 means '
  'wac mixes moneys and is no figure at all; lots with no stated currency '
  '(booked before the column) are not counted.';

COMMIT;
