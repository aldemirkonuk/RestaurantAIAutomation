-- Phase 2 POS→pour: a Toast menu item maps to an inventory item AND a sale unit (glass vs bottle),
-- so a glass sale drives record_glass_pour and a bottle sale drives apply_stock_movement.
-- Applied to prod exzueerziesmczwlhomd on 2026-07-10 (also via MCP migration history).
ALTER TABLE toast_item_mappings
  ADD COLUMN IF NOT EXISTS sale_unit varchar(10) CHECK (sale_unit IN ('glass','bottle'));

COMMENT ON COLUMN toast_item_mappings.sale_unit IS
  'How a sale of this Toast item depletes inventory: glass (record_glass_pour) or bottle (apply_stock_movement). NULL = infer from item name / inventory sale_type.';
