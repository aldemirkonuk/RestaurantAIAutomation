-- A serve is costed from invoices only (r28 recipes audit, gap 3).
--
-- `resolveUnitCost` takes `inventory_lot_rollup.wac` as "the invoiced lot WAC"
-- whenever ANY live lot of the good is invoice-provenanced. But the rollup's
-- `wac` averages every priced, non-sample live lot: estimated prices included.
-- And its completeness test compares `wac_qty` (every priced lot) to `live_qty`,
-- not the invoiced quantity. So 10 units invoiced at 100 beside 90 units
-- estimated at 60 read as 64, labelled an invoice cost, with every line of the
-- recipe "priced".
--
-- This view states the invoice figures beside the rollup instead of redefining
-- it: `inventory_lot_rollup` is already redefined by two open migrations, and a
-- third redefinition would silently drop one of them (the same reason
-- `inventory_lot_agreed_cost` is a side view). Readers join it by inventory_id.
--
-- Per good, over live, non-sample lots with stock (qty > 0):
--
--   stock_qty     the units a cost is quoted for
--   invoice_qty   units on invoice-provenanced lots with a cost above 0
--   invoice_wac   their quantity-weighted average cost, six places
--   settled_qty   the part of invoice_qty whose cost is final (verified)
--
-- Estimated and hand-entered lots never enter the average. A lot invoiced at 0
-- is not evidence of a price (a form left at "0", a line read with no price;
-- a bottle that is really free is booked as a sample), so it counts in
-- stock_qty and not in invoice_qty: the cost is quoted as covering part of the
-- stock, never as free. A delivered invoice not yet verified (cost_state
-- provisional) still prices the serve, but it is not settled, so the figure is
-- complete only when settled_qty = stock_qty.

BEGIN;

CREATE OR REPLACE VIEW public.inventory_lot_invoice_cost
  WITH (security_invoker = true) AS
 SELECT inventory_id,
    restaurant_id,
    sum(qty)::bigint AS stock_qty,
    COALESCE(sum(qty) FILTER (WHERE invoiced), 0)::bigint AS invoice_qty,
    round(
      sum((qty)::numeric * unit_cost) FILTER (WHERE invoiced)
        / NULLIF(sum(qty) FILTER (WHERE invoiced), 0)::numeric,
      6) AS invoice_wac,
    COALESCE(sum(qty) FILTER (WHERE invoiced AND cost_state = 'final'), 0)::bigint AS settled_qty
   FROM (
     SELECT inventory_id,
        restaurant_id,
        qty,
        unit_cost,
        cost_state,
        ((cost_provenance)::text = 'invoice'::text AND unit_cost IS NOT NULL AND unit_cost > 0) AS invoiced
       FROM public.inventory_lots
      WHERE ((stock_state)::text = 'live'::text)
        AND qty > 0
        AND (cost_provenance)::text <> 'sample'::text
   ) l
  GROUP BY inventory_id, restaurant_id;

COMMENT ON VIEW public.inventory_lot_invoice_cost IS
  'Per stock item, the average cost of the live units on invoices (cost above '
  '0), and how much of the stock that covers. Estimated and hand-entered lots '
  'and free samples never enter the average. stock_qty: live non-sample units; '
  'invoice_qty: of those, units on a priced invoice; settled_qty: of those, '
  'units whose invoice cost is final. Six decimal places.';
COMMENT ON COLUMN public.inventory_lot_invoice_cost.stock_qty IS
  'Live, non-sample units on hand: what a cost is quoted for.';
COMMENT ON COLUMN public.inventory_lot_invoice_cost.invoice_qty IS
  'Live units on invoice-provenanced lots with a unit cost above 0.';
COMMENT ON COLUMN public.inventory_lot_invoice_cost.invoice_wac IS
  'Quantity-weighted average unit cost of the invoice_qty units, six decimal places; NULL when invoice_qty is 0.';
COMMENT ON COLUMN public.inventory_lot_invoice_cost.settled_qty IS
  'The part of invoice_qty whose cost_state is final (verified).';

-- Same posture as the rollup and the agreed-cost view: server-side reads only (OD-72).
REVOKE ALL ON public.inventory_lot_invoice_cost FROM anon, authenticated;
GRANT SELECT ON public.inventory_lot_invoice_cost TO service_role;

COMMIT;
