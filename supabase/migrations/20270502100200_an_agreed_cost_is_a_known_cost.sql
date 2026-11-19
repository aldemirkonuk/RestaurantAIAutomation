-- An agreed cost is a known cost (QA round 15, finding 2).
--
-- A delivery cost settled at VERIFIED through an accepted vendor proposal is
-- posted as cost_provenance 'manual' with cost_state 'final': the price is
-- agreed, but it is not printed on an invoice, so calling it 'invoice' would
-- lie. `inventory_lot_rollup.has_invoice_cost` only counts 'invoice' lots, so a
-- recipe or a valuation reading the rollup sees such an item as having no cost
-- while the lot and the sale stamp carry the price.
--
-- This view states the agreed cost beside the rollup instead of redefining it:
-- `inventory_lot_rollup` is already redefined by two open migrations
-- (20270302143700, 20270303100000), and a third redefinition would silently
-- drop one of them. Readers join this view by inventory_id.
--
-- Final lots only. A provisional estimate never blends into an agreed cost.
-- Samples (free on purpose) are not evidence of what stock costs.
-- Six places, not two: the rollup rounds to cents, which loses a landed cost.
--
-- Wiring analytics loaders to read this view is a follow-up; see
-- .planning/tech-debt.d/2026-11-07-recipe-reads-agreed-lot-cost.md.

BEGIN;

CREATE OR REPLACE VIEW public.inventory_lot_agreed_cost
  WITH (security_invoker = true) AS
 SELECT inventory_id,
    restaurant_id,
    sum(qty) AS agreed_qty,
    round(sum((qty)::numeric * unit_cost) / (sum(qty))::numeric, 6) AS agreed_wac,
    (sum(qty) > 0) AS has_agreed_cost
   FROM public.inventory_lots
  WHERE ((stock_state)::text = 'live'::text)
    AND qty > 0
    AND cost_state = 'final'
    AND (cost_provenance)::text <> 'sample'::text
    AND unit_cost IS NOT NULL
  GROUP BY inventory_id, restaurant_id;

COMMENT ON VIEW public.inventory_lot_agreed_cost IS
  'Per stock item, the average cost of the live bottles whose cost is settled '
  '(cost_state final): from an invoice, or agreed with the vendor at delivery. '
  'Provisional estimates and free samples are left out. agreed_qty is how many '
  'bottles the average covers; agreed_wac keeps six decimal places.';
COMMENT ON COLUMN public.inventory_lot_agreed_cost.agreed_qty IS
  'Live bottles whose settled cost the average covers.';
COMMENT ON COLUMN public.inventory_lot_agreed_cost.agreed_wac IS
  'Quantity-weighted average settled unit cost, six decimal places.';
COMMENT ON COLUMN public.inventory_lot_agreed_cost.has_agreed_cost IS
  'True when at least one live bottle has a settled cost.';

-- Same posture as the rollup: server-side reads only (OD-72).
REVOKE ALL ON public.inventory_lot_agreed_cost FROM anon, authenticated;
GRANT SELECT ON public.inventory_lot_agreed_cost TO service_role;

COMMIT;
