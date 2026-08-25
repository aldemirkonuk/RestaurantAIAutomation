-- Three-way invoice match (PO <-> Invoice <-> Receipt) on procurement_orders.
--
-- Root cause of the drift handled here is the same one documented in
-- 20260517300000_providers_missing_columns.sql: procurement_orders was created by hand
-- (see md/02-architecture/DATABASE_SCHEMA.sql) before the Supabase migration system, so the
-- baseline CREATE TABLE IF NOT EXISTS was a no-op and later columns never landed in this tree.
-- Every addition below is IF NOT EXISTS and therefore safe on any schema variant.
--
-- Model:
--   ORDERED  (PO)       quantity           @ final_price
--   INVOICED (vendor)   invoice_quantity   @ invoice_unit_price
--   RECEIVED (physical) received/accepted + rejected
-- Invariant: accepted_quantity + rejected_quantity = quantity physically handed over.

-- 1. Columns the API already reads/writes but that exist in no migration in this tree.
--    Adding them here makes the migration tree honest about the live shape.
ALTER TABLE procurement_orders
  ADD COLUMN IF NOT EXISTS quantity_received     INTEGER,
  ADD COLUMN IF NOT EXISTS price_verified        BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS invoice_image_url     TEXT,
  ADD COLUMN IF NOT EXISTS discrepancy_notes     TEXT;

-- 2. Three-way match fields.
ALTER TABLE procurement_orders
  ADD COLUMN IF NOT EXISTS invoice_quantity      INTEGER,
  ADD COLUMN IF NOT EXISTS invoice_unit_price    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS accepted_quantity     INTEGER,
  ADD COLUMN IF NOT EXISTS rejected_quantity     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_reason       TEXT,
  ADD COLUMN IF NOT EXISTS backorder_quantity    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS match_status          VARCHAR(30),
  ADD COLUMN IF NOT EXISTS price_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS match_verified_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS match_verified_by     UUID;

COMMENT ON COLUMN procurement_orders.invoice_quantity      IS 'Quantity stated on the vendor invoice. Compared against ordered quantity and physical count.';
COMMENT ON COLUMN procurement_orders.invoice_unit_price    IS 'Unit price billed on the vendor invoice. Expected to exactly equal final_price; any deviation requires a manual override.';
COMMENT ON COLUMN procurement_orders.accepted_quantity     IS 'Units physically accepted into stock. This is the quantity of record (INVENTORY_SOTA_PLAN D17), not ordered quantity.';
COMMENT ON COLUMN procurement_orders.rejected_quantity     IS 'Units that arrived but were refused (damaged/corked). Distinct from a short ship: these were sent but not accepted.';
COMMENT ON COLUMN procurement_orders.backorder_quantity    IS 'Ordered but not yet accepted; keeps the order open as PARTIALLY_RECEIVED instead of stranding phantom shadow stock.';
COMMENT ON COLUMN procurement_orders.match_status          IS 'matched | price_variance | qty_short | qty_over | rejected | partial | unmatched';
COMMENT ON COLUMN procurement_orders.price_override_reason IS 'Required justification when invoice_unit_price != final_price and a manager accepts anyway.';

-- 3. status gains PARTIALLY_RECEIVED. Safe: status is VARCHAR(50) with no CHECK constraint
--    in any tree, so no constraint needs widening (unlike procurement_conversations.outbound_email_type).

-- 4. Indexes for discrepancy review and the provider reliability rollup (Phase B).
CREATE INDEX IF NOT EXISTS idx_procurement_orders_match_status
  ON procurement_orders(restaurant_id, match_status)
  WHERE match_status IS NOT NULL AND match_status <> 'matched';

CREATE INDEX IF NOT EXISTS idx_procurement_orders_open_backorder
  ON procurement_orders(restaurant_id, provider_id)
  WHERE backorder_quantity > 0;
