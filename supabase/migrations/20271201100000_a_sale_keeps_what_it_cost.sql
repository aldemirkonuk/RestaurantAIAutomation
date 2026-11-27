-- A sale keeps what it cost (r57 table side, D4).
--
-- COGS and margin on a check used the lot cost at read time, so a later
-- invoice or a corrected unit price moved the margin of checks already closed.
-- The cost is now written on the consumption row when the line sells, with
-- the basis it was costed on and the lot and order it came from. Rows booked
-- before this migration keep these columns null and read as "cost not kept";
-- they are never back-filled from today's lot cost.
--
-- cost_at_sale is the cost of the whole line (not per unit), in the house's
-- currency, to four places. A void zeroes it with the rest of the row.

ALTER TABLE public.wine_consumption_log
  ADD COLUMN IF NOT EXISTS cost_at_sale numeric(12,4),
  ADD COLUMN IF NOT EXISTS cost_basis text,
  ADD COLUMN IF NOT EXISTS cost_source_lot_id uuid,
  ADD COLUMN IF NOT EXISTS cost_source_order_id uuid;

ALTER TABLE public.wine_consumption_log
  DROP CONSTRAINT IF EXISTS wine_consumption_log_cost_basis_check;
ALTER TABLE public.wine_consumption_log
  ADD CONSTRAINT wine_consumption_log_cost_basis_check
  CHECK (cost_basis IS NULL OR cost_basis IN
    ('invoice_lot_wac', 'invoice_lot_wac_partial', 'last_purchase_price'));

COMMENT ON COLUMN public.wine_consumption_log.cost_at_sale IS
  'Cost of the whole line when it sold (bottle cost x share of the bottle). Null = cost not kept.';
COMMENT ON COLUMN public.wine_consumption_log.cost_basis IS
  'What the cost was read from at sale: invoice_lot_wac, invoice_lot_wac_partial or last_purchase_price.';
COMMENT ON COLUMN public.wine_consumption_log.cost_source_lot_id IS
  'The oldest live costed lot at sale, the one a pour draws from first. No foreign key: lots are spent and deleted.';
COMMENT ON COLUMN public.wine_consumption_log.cost_source_order_id IS
  'The order (invoice) that lot arrived on, when it names one.';
