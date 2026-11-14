-- A sold-out good keeps its last cost (r36 recipes audit, gap 1).
--
-- `inventory_lot_invoice_cost` and `inventory_lot_agreed_cost` read live lots
-- with stock (qty > 0) only. A recipe reads them and no longer falls back to
-- the rollup (`mergeInvoiceLotCost` marks the good as read). So the moment the
-- last bottle of Campari is poured, every drink with Campari in it reads "Not
-- known", and the pour cost is gone exactly when the owner is about to reorder,
-- although the price of the last delivery is on its lot.
--
-- This view states, per good, the cost of its newest lot whose cost is known,
-- whatever is left of it. It is a side view for the same reason as the two
-- above: redefining either would change what "on hand" means for their other
-- readers. Readers join it by inventory_id and use it only after the live
-- invoice and agreed costs, so stock on hand always speaks first.
--
-- A lot's cost is known when it is above 0 and either printed on an invoice
-- (provisional too, as the invoice view takes it) or settled (cost_state
-- final: agreed at delivery, or entered by hand). Estimates never count, and
-- neither do free samples, shadow stock or a lot with no good.
--
-- "Newest" is by when the lot was received, then created, then its id, so two
-- lines of one delivery at different prices always give the same answer.

BEGIN;

CREATE OR REPLACE VIEW public.inventory_lot_last_known_cost
  WITH (security_invoker = true) AS
 SELECT DISTINCT ON (inventory_id)
    inventory_id,
    restaurant_id,
    round(unit_cost::numeric, 6) AS last_unit_cost,
    received_at AS last_received_at,
    (cost_state = 'final') AS last_settled,
    ((cost_provenance)::text = 'invoice'::text) AS last_from_invoice
   FROM public.inventory_lots
  WHERE ((stock_state)::text = 'live'::text)
    AND inventory_id IS NOT NULL
    AND (cost_provenance)::text <> 'sample'::text
    AND unit_cost IS NOT NULL
    AND unit_cost > 0
    AND ((cost_provenance)::text = 'invoice'::text OR cost_state = 'final')
  ORDER BY inventory_id, received_at DESC, created_at DESC, id DESC;

COMMENT ON VIEW public.inventory_lot_last_known_cost IS
  'Per stock item, the unit cost of its newest live, non-sample lot whose cost '
  'is known (above 0, on an invoice or settled), whether or not any of it is '
  'left. Read after the live invoice and agreed costs, so a good that has sold '
  'out still has the price it was last bought at.';
COMMENT ON COLUMN public.inventory_lot_last_known_cost.last_unit_cost IS
  'That lot''s unit cost, six decimal places.';
COMMENT ON COLUMN public.inventory_lot_last_known_cost.last_received_at IS
  'When that lot was received.';
COMMENT ON COLUMN public.inventory_lot_last_known_cost.last_settled IS
  'True when that lot''s cost is final (verified, agreed or entered by hand).';
COMMENT ON COLUMN public.inventory_lot_last_known_cost.last_from_invoice IS
  'True when that lot''s cost is printed on an invoice.';

-- Same posture as the rollup and the other cost views: server-side reads only (OD-72).
REVOKE ALL ON public.inventory_lot_last_known_cost FROM anon, authenticated;
GRANT SELECT ON public.inventory_lot_last_known_cost TO service_role;

COMMIT;
