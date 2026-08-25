-- ============================================================================
-- WINE VOLUME & MEASUREMENT INTEGRATION
-- ============================================================================
-- Adds bottle_size_ml as a first-class attribute on wines, sale_type and
-- pour configuration per restaurant-inventory item, restaurant-level
-- default pour size, and a consumption log for tracking bottles vs glasses.
-- ============================================================================

-- 1. Add bottle_size_ml to master_wine_library (default 750ml for all existing)
ALTER TABLE master_wine_library
  ADD COLUMN IF NOT EXISTS bottle_size_ml INTEGER NOT NULL DEFAULT 750;

COMMENT ON COLUMN master_wine_library.bottle_size_ml
  IS 'Bottle volume in milliliters. Standard = 750, half = 375, magnum = 1500, etc.';

-- 2. Add sale/pour configuration to restaurant_inventory
ALTER TABLE restaurant_inventory
  ADD COLUMN IF NOT EXISTS sale_type VARCHAR(10) DEFAULT 'bottle'
    CHECK (sale_type IN ('bottle', 'glass', 'both')),
  ADD COLUMN IF NOT EXISTS pour_size_ml FLOAT DEFAULT 150,
  ADD COLUMN IF NOT EXISTS menu_price_glass DECIMAL(10,2);

COMMENT ON COLUMN restaurant_inventory.sale_type
  IS 'How this wine is sold at this restaurant: bottle only, glass only, or both';
COMMENT ON COLUMN restaurant_inventory.pour_size_ml
  IS 'Pour size in ml for by-the-glass service. Overrides restaurant default.';
COMMENT ON COLUMN restaurant_inventory.menu_price_glass
  IS 'Menu price for a single glass pour';

-- 3. Add default pour size to restaurants table
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS default_pour_ml FLOAT DEFAULT 150;

COMMENT ON COLUMN restaurants.default_pour_ml
  IS 'Restaurant-wide default glass pour size in ml. Overridable per inventory item.';

-- 4. Wine consumption log (bottles vs glasses tracked separately)
CREATE TABLE IF NOT EXISTS wine_consumption_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID NOT NULL REFERENCES restaurant_inventory(id) ON DELETE CASCADE,
    wine_name VARCHAR(500),
    consumption_type VARCHAR(10) NOT NULL CHECK (consumption_type IN ('bottle', 'glass')),
    quantity INTEGER NOT NULL DEFAULT 1,
    volume_ml FLOAT NOT NULL,
    unit_price DECIMAL(10,2),
    total_revenue DECIMAL(10,2),
    source VARCHAR(20) DEFAULT 'manual' CHECK (source IN ('manual', 'pos', 'ai_agent')),
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    recorded_by UUID,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consumption_restaurant
  ON wine_consumption_log(restaurant_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_consumption_inventory
  ON wine_consumption_log(inventory_id);
CREATE INDEX IF NOT EXISTS idx_consumption_type
  ON wine_consumption_log(consumption_type);

COMMENT ON TABLE wine_consumption_log
  IS 'Tracks wine consumption by bottle and glass separately. Enables reports like "5 bottles + 9 glasses of Wine X consumed".';

-- 5. View: consumption summary per wine with bottle-equivalent math
CREATE OR REPLACE VIEW wine_consumption_summary AS
SELECT
    cl.restaurant_id,
    cl.inventory_id,
    cl.wine_name,
    SUM(CASE WHEN cl.consumption_type = 'bottle' THEN cl.quantity ELSE 0 END) AS bottles_consumed,
    SUM(CASE WHEN cl.consumption_type = 'glass'  THEN cl.quantity ELSE 0 END) AS glasses_consumed,
    SUM(cl.volume_ml) AS total_volume_ml,
    SUM(CASE WHEN cl.consumption_type = 'bottle' THEN COALESCE(cl.total_revenue, 0) ELSE 0 END) AS bottle_revenue,
    SUM(CASE WHEN cl.consumption_type = 'glass'  THEN COALESCE(cl.total_revenue, 0) ELSE 0 END) AS glass_revenue,
    SUM(COALESCE(cl.total_revenue, 0)) AS total_revenue
FROM wine_consumption_log cl
GROUP BY cl.restaurant_id, cl.inventory_id, cl.wine_name;

COMMENT ON VIEW wine_consumption_summary
  IS 'Aggregated consumption per wine: bottles sold, glasses sold, revenue by type';
