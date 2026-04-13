-- ============================================================================
-- WINE-SPECIFIC TABLES
-- ============================================================================
-- New tables for bottle/glass metrics, price tracking, and supplier catalogs.
-- Scoped to wine operations only (other beverage types are a future phase).
-- ============================================================================

-- 1. Bottle Specifications
-- Tracks bottle size, pour sizes, and cost-per-pour calculations
CREATE TABLE IF NOT EXISTS bottle_specifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_wine_id UUID REFERENCES master_wine_library(id),
    bottle_size_ml INTEGER NOT NULL DEFAULT 750,
    pour_size_ml FLOAT DEFAULT 150,       -- standard pour
    pours_per_bottle INTEGER GENERATED ALWAYS AS (FLOOR(bottle_size_ml / NULLIF(pour_size_ml, 0))::INTEGER) STORED,
    glass_size_ml FLOAT DEFAULT 175,      -- glass serving
    cost_per_bottle DECIMAL(10,2),
    cost_per_pour DECIMAL(10,2) GENERATED ALWAYS AS (
        cost_per_bottle / NULLIF(FLOOR(bottle_size_ml / NULLIF(pour_size_ml, 0)), 0)
    ) STORED,
    cost_per_glass DECIMAL(10,2) GENERATED ALWAYS AS (
        cost_per_bottle / NULLIF(FLOOR(bottle_size_ml / NULLIF(glass_size_ml, 0)), 0)
    ) STORED,
    weight_grams INTEGER,
    closure_type VARCHAR(50),  -- cork, screw cap, synthetic
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bottle_specs_wine ON bottle_specifications(master_wine_id);

COMMENT ON TABLE bottle_specifications IS 'Wine bottle specifications with auto-calculated cost-per-pour and cost-per-glass';


-- 2. Glass Pour Tracking
-- Tracks individual bottles opened and pours served (for by-the-glass programs)
CREATE TABLE IF NOT EXISTS glass_pour_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID REFERENCES restaurant_inventory(id),
    bottle_opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pours_served INTEGER DEFAULT 0,
    volume_poured_ml FLOAT DEFAULT 0,
    waste_ml FLOAT DEFAULT 0,
    remaining_ml FLOAT,
    expected_finish_at TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'OPEN',  -- OPEN, FINISHED, WASTED
    opened_by UUID,
    finished_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_glass_pour_restaurant ON glass_pour_tracking(restaurant_id, bottle_opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_glass_pour_status ON glass_pour_tracking(status) WHERE status = 'OPEN';

COMMENT ON TABLE glass_pour_tracking IS 'Tracks individual opened bottles and pours for by-the-glass wine programs';


-- 3. Price History
-- Historical price data per wine+provider combination
CREATE TABLE IF NOT EXISTS price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    master_wine_id UUID REFERENCES master_wine_library(id),
    provider_id UUID REFERENCES providers(id),
    price DECIMAL(10,2) NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit VARCHAR(20) DEFAULT 'BOTTLE',
    effective_date DATE NOT NULL,
    source VARCHAR(50) NOT NULL,  -- invoice, catalog, manual, negotiation
    order_id UUID REFERENCES procurement_orders(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_wine_provider ON price_history(master_wine_id, provider_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_restaurant ON price_history(restaurant_id);

COMMENT ON TABLE price_history IS 'Historical wine pricing data from invoices, catalogs, and negotiations';


-- 4. Supplier Catalogs
-- Vendor product catalogs for comparison and auto-matching
CREATE TABLE IF NOT EXISTS supplier_catalogs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID REFERENCES providers(id) ON DELETE CASCADE,
    catalog_name VARCHAR(255),
    items JSONB NOT NULL DEFAULT '[]',  -- [{wine_name, sku, price, vintage, availability}]
    pricing_tier VARCHAR(50),
    valid_from DATE,
    valid_until DATE,
    last_synced_at TIMESTAMPTZ,
    source VARCHAR(50),  -- manual, api, email_parse
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_catalogs_provider ON supplier_catalogs(provider_id);
CREATE INDEX IF NOT EXISTS idx_supplier_catalogs_valid ON supplier_catalogs(valid_from, valid_until);

COMMENT ON TABLE supplier_catalogs IS 'Vendor product catalogs with pricing tiers and availability';


-- ============================================================================
-- Unit Conversions (reference table for ml <-> bottles <-> cases)
-- ============================================================================
DROP TABLE IF EXISTS unit_conversions CASCADE;
CREATE TABLE IF NOT EXISTS unit_conversions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_unit VARCHAR(20) NOT NULL,
    to_unit VARCHAR(20) NOT NULL,
    factor DECIMAL(10,4) NOT NULL,
    notes TEXT,
    UNIQUE(from_unit, to_unit)
);

-- Seed common conversions
INSERT INTO unit_conversions (from_unit, to_unit, factor, notes) VALUES
    ('bottle', 'ml', 750, 'Standard 750ml bottle'),
    ('ml', 'bottle', 0.001333, '1/750'),
    ('case', 'bottle', 12, 'Standard 12-bottle case'),
    ('bottle', 'case', 0.083333, '1/12'),
    ('case', 'ml', 9000, '12 x 750ml'),
    ('ml', 'case', 0.000111, '1/9000'),
    ('magnum', 'ml', 1500, '1.5L magnum'),
    ('half_bottle', 'ml', 375, '375ml half bottle'),
    ('jeroboam', 'ml', 3000, '3L jeroboam')
ON CONFLICT (from_unit, to_unit) DO NOTHING;

COMMENT ON TABLE unit_conversions IS 'Reference table for wine volume unit conversions';
