-- ============================================================================
-- VOLUME REFINEMENTS: oz support, bottle_specifications merge, overrides
-- ============================================================================

-- 1. Measurement unit preference on restaurants
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS measurement_unit VARCHAR(5) DEFAULT 'ml'
    CHECK (measurement_unit IN ('ml', 'oz'));

COMMENT ON COLUMN restaurants.measurement_unit
  IS 'Display preference for volumes: ml (metric) or oz (US fluid ounces). Stored canonical unit is always ml.';

-- 2. Inventory-level bottle size override + glasses-per-bottle override
ALTER TABLE restaurant_inventory
  ADD COLUMN IF NOT EXISTS bottle_size_ml INTEGER,
  ADD COLUMN IF NOT EXISTS glasses_per_bottle_override INTEGER;

COMMENT ON COLUMN restaurant_inventory.bottle_size_ml
  IS 'Override bottle size for this inventory item. NULL = inherit from master_wine_library.bottle_size_ml.';
COMMENT ON COLUMN restaurant_inventory.glasses_per_bottle_override
  IS 'Manual override for glasses per bottle. NULL = auto-calculate from bottle_size_ml / pour_size_ml.';

-- 3. Merge bottle_specifications useful fields into master_wine_library
ALTER TABLE master_wine_library
  ADD COLUMN IF NOT EXISTS weight_grams INTEGER,
  ADD COLUMN IF NOT EXISTS closure_type VARCHAR(50);

COMMENT ON COLUMN master_wine_library.weight_grams IS 'Bottle weight in grams (from bottle_specifications)';
COMMENT ON COLUMN master_wine_library.closure_type IS 'Cork, screw cap, synthetic, etc. (from bottle_specifications)';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bottle_specifications') THEN
    UPDATE master_wine_library mwl
    SET
      weight_grams = COALESCE(mwl.weight_grams, bs.weight_grams),
      closure_type = COALESCE(mwl.closure_type, bs.closure_type)
    FROM bottle_specifications bs
    WHERE bs.master_wine_id = mwl.id;

    DROP TABLE bottle_specifications;
  END IF;
END $$;

-- 4. Seed oz conversions into unit_conversions
INSERT INTO unit_conversions (from_unit, to_unit, factor, notes) VALUES
  ('oz', 'ml', 29.5735, '1 US fl oz = 29.5735 ml'),
  ('ml', 'oz', 0.033814, '1 ml = 0.033814 fl oz'),
  ('bottle', 'oz', 25.3605, 'Standard 750ml bottle = 25.36 oz'),
  ('oz', 'bottle', 0.039431, '1 oz / 25.36'),
  ('half_bottle', 'oz', 12.6803, '375ml = 12.68 oz'),
  ('magnum', 'oz', 50.7210, '1500ml = 50.72 oz'),
  ('case', 'oz', 304.3261, '12 x 25.36 oz'),
  ('jeroboam', 'oz', 101.4420, '3000ml = 101.44 oz')
ON CONFLICT (from_unit, to_unit) DO NOTHING;

-- 5a. Ensure restaurant_inventory has columns the view reads
ALTER TABLE restaurant_inventory ADD COLUMN IF NOT EXISTS wine_name VARCHAR(500);
ALTER TABLE restaurant_inventory ADD COLUMN IF NOT EXISTS stock_live INTEGER DEFAULT 0;
ALTER TABLE restaurant_inventory ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE;
ALTER TABLE restaurant_inventory ADD COLUMN IF NOT EXISTS master_wine_id UUID REFERENCES master_wine_library(id);

-- 5. Computed view: effective bottle size per inventory item (coalesces override)
CREATE OR REPLACE VIEW inventory_volume_details AS
SELECT
  ri.id AS inventory_id,
  ri.restaurant_id,
  ri.master_wine_id,
  ri.wine_name,
  COALESCE(ri.bottle_size_ml, mwl.bottle_size_ml, 750) AS effective_bottle_size_ml,
  ROUND((COALESCE(ri.bottle_size_ml, mwl.bottle_size_ml, 750) * 0.033814)::numeric, 1) AS effective_bottle_size_oz,
  ri.sale_type,
  ri.pour_size_ml,
  ROUND((COALESCE(ri.pour_size_ml, 150) * 0.033814)::numeric, 1) AS pour_size_oz,
  ri.menu_price_glass,
  COALESCE(
    ri.glasses_per_bottle_override,
    FLOOR(COALESCE(ri.bottle_size_ml, mwl.bottle_size_ml, 750) / NULLIF(ri.pour_size_ml, 0))::INTEGER
  ) AS glasses_per_bottle,
  ri.stock_live,
  ri.stock_live * COALESCE(ri.bottle_size_ml, mwl.bottle_size_ml, 750) AS total_volume_ml,
  ROUND((ri.stock_live * COALESCE(ri.bottle_size_ml, mwl.bottle_size_ml, 750) * 0.033814)::numeric, 1) AS total_volume_oz,
  r.measurement_unit
FROM restaurant_inventory ri
LEFT JOIN master_wine_library mwl ON mwl.id = ri.master_wine_id
LEFT JOIN restaurants r ON r.id = ri.restaurant_id;

COMMENT ON VIEW inventory_volume_details
  IS 'Pre-computed volume details per inventory item with effective sizes, oz conversions, and glasses-per-bottle';
