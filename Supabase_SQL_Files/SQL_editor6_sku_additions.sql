-- ============================================================================
-- WineOps AI - SKU Schema Additions
-- Version: 1.0.0
-- Purpose: Add comprehensive SKU support across all relevant tables
-- Date: January 2026
-- ============================================================================
-- 
-- This migration adds:
-- 1. SKU fields to master_wine_library (global catalog)
-- 2. Toast/POS SKU mapping fields
-- 3. SKU fields to procurement_order_items
-- 4. SKU tracking in sales_events
-- 5. SKU lookup views and functions
-- 6. Barcode ↔ SKU mapping table
-- 7. Indexes for efficient SKU queries
--
-- Run this AFTER your main schema (SQL_editor5.sql) and migrations (SQL_editor3.sql)
-- ============================================================================

-- ============================================================================
-- 1. ADD SKU FIELDS TO MASTER_WINE_LIBRARY
-- ============================================================================
-- The global wine catalog needs SKU for cross-system identification

ALTER TABLE master_wine_library
ADD COLUMN IF NOT EXISTS sku VARCHAR(100),
ADD COLUMN IF NOT EXISTS upc VARCHAR(50),                    -- Universal Product Code (barcode number)
ADD COLUMN IF NOT EXISTS ean VARCHAR(50),                    -- European Article Number
ADD COLUMN IF NOT EXISTS manufacturer_sku VARCHAR(100),      -- Producer's SKU
ADD COLUMN IF NOT EXISTS distributor_skus JSONB;             -- Different distributors may use different SKUs

COMMENT ON COLUMN master_wine_library.sku IS 
'Primary Stock Keeping Unit identifier for this wine';
COMMENT ON COLUMN master_wine_library.upc IS 
'12-digit Universal Product Code (North American barcode)';
COMMENT ON COLUMN master_wine_library.ean IS 
'13-digit European Article Number (international barcode)';
COMMENT ON COLUMN master_wine_library.manufacturer_sku IS 
'Producer/winery SKU from their system';
COMMENT ON COLUMN master_wine_library.distributor_skus IS 
'SKUs from different distributors: {"southern_glazers": "SG-12345", "republic": "REP-67890"}';

-- Indexes for SKU lookups on master_wine_library
CREATE INDEX IF NOT EXISTS idx_master_wine_library_sku ON master_wine_library(sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_master_wine_library_upc ON master_wine_library(upc) WHERE upc IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_master_wine_library_ean ON master_wine_library(ean) WHERE ean IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_master_wine_library_manufacturer_sku ON master_wine_library(manufacturer_sku) WHERE manufacturer_sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_master_wine_library_distributor_skus ON master_wine_library USING GIN(distributor_skus);

-- ============================================================================
-- 2. ADD POS/TOAST SKU MAPPING TO RESTAURANT_INVENTORY
-- ============================================================================
-- Restaurant-specific SKU overrides and POS system mappings

ALTER TABLE restaurant_inventory
ADD COLUMN IF NOT EXISTS toast_item_guid VARCHAR(100),       -- Toast POS item GUID
ADD COLUMN IF NOT EXISTS toast_menu_item_id VARCHAR(100),    -- Toast menu item ID
ADD COLUMN IF NOT EXISTS square_item_id VARCHAR(100),        -- Square POS item ID
ADD COLUMN IF NOT EXISTS clover_item_id VARCHAR(100),        -- Clover POS item ID
ADD COLUMN IF NOT EXISTS internal_sku VARCHAR(100),          -- Restaurant's internal SKU (may differ from master)
ADD COLUMN IF NOT EXISTS pos_sku VARCHAR(100),               -- SKU as it appears in POS system
ADD COLUMN IF NOT EXISTS sku_aliases JSONB;                  -- Alternative SKUs for this item

COMMENT ON COLUMN restaurant_inventory.toast_item_guid IS 
'Toast POS item GUID for real-time sync';
COMMENT ON COLUMN restaurant_inventory.toast_menu_item_id IS 
'Toast POS menu item ID';
COMMENT ON COLUMN restaurant_inventory.square_item_id IS 
'Square POS item variation ID';
COMMENT ON COLUMN restaurant_inventory.clover_item_id IS 
'Clover POS item ID';
COMMENT ON COLUMN restaurant_inventory.internal_sku IS 
'Restaurant-specific internal SKU (can override master SKU)';
COMMENT ON COLUMN restaurant_inventory.pos_sku IS 
'SKU as configured in POS system (may differ from internal/master)';
COMMENT ON COLUMN restaurant_inventory.sku_aliases IS 
'Alternative SKUs: {"old_sku": "WINE-001", "vendor_sku": "V-123", "pos_sku": "BTG-CAB"}';

-- Indexes for POS item lookups
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_toast_guid ON restaurant_inventory(toast_item_guid) WHERE toast_item_guid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_toast_menu ON restaurant_inventory(toast_menu_item_id) WHERE toast_menu_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_square ON restaurant_inventory(square_item_id) WHERE square_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_clover ON restaurant_inventory(clover_item_id) WHERE clover_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_internal_sku ON restaurant_inventory(internal_sku) WHERE internal_sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_pos_sku ON restaurant_inventory(pos_sku) WHERE pos_sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_sku_aliases ON restaurant_inventory USING GIN(sku_aliases);

-- Composite index for restaurant + POS lookups
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_restaurant_toast ON restaurant_inventory(restaurant_id, toast_item_guid) WHERE toast_item_guid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_restaurant_sku ON restaurant_inventory(restaurant_id, sku) WHERE sku IS NOT NULL;

-- ============================================================================
-- 3. ADD SKU TO SALES_EVENTS
-- ============================================================================
-- Track SKU in sales events for POS reconciliation

ALTER TABLE sales_events
ADD COLUMN IF NOT EXISTS sku VARCHAR(100),
ADD COLUMN IF NOT EXISTS pos_item_guid VARCHAR(100),         -- Toast/Square/Clover item ID
ADD COLUMN IF NOT EXISTS pos_sku VARCHAR(100),               -- SKU from POS transaction
ADD COLUMN IF NOT EXISTS wine_id VARCHAR(20);                -- Reference to master_wine_library.wine_id

COMMENT ON COLUMN sales_events.sku IS 
'SKU from sales transaction';
COMMENT ON COLUMN sales_events.pos_item_guid IS 
'POS item GUID from transaction (Toast/Square/Clover)';
COMMENT ON COLUMN sales_events.pos_sku IS 
'SKU as it appeared in the POS transaction';
COMMENT ON COLUMN sales_events.wine_id IS 
'Reference to master_wine_library.wine_id for reconciliation';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sales_events_sku ON sales_events(sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_events_pos_guid ON sales_events(pos_item_guid) WHERE pos_item_guid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_events_wine_id ON sales_events(wine_id) WHERE wine_id IS NOT NULL;

-- ============================================================================
-- 4. CREATE PROCUREMENT_ORDER_ITEMS TABLE
-- ============================================================================
-- Line items for procurement orders with SKU tracking

CREATE TABLE IF NOT EXISTS procurement_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Parent Order
    order_id UUID NOT NULL REFERENCES procurement_orders(id) ON DELETE CASCADE,
    
    -- Item Reference
    inventory_id UUID REFERENCES restaurant_inventory(id),
    master_wine_id UUID REFERENCES master_wine_library(id),
    
    -- SKU Information
    sku VARCHAR(100),                           -- Ordered SKU
    vendor_sku VARCHAR(100),                    -- Vendor's SKU for this item
    upc VARCHAR(50),                            -- UPC if available
    
    -- Wine Details (denormalized for order history)
    wine_name VARCHAR(255) NOT NULL,
    producer VARCHAR(255),
    vintage INTEGER,
    
    -- Quantity
    quantity INTEGER NOT NULL,
    unit_type VARCHAR(20) DEFAULT 'bottles',    -- 'bottles', 'cases', 'liters'
    bottles_per_unit INTEGER DEFAULT 1,         -- For cases: 6 or 12 typically
    total_bottles INTEGER GENERATED ALWAYS AS (quantity * bottles_per_unit) STORED,
    
    -- Pricing
    quoted_unit_price DECIMAL(10,2),
    negotiated_unit_price DECIMAL(10,2),
    final_unit_price DECIMAL(10,2),
    line_total DECIMAL(10,2),
    
    -- Delivery Tracking
    quantity_received INTEGER,
    quantity_accepted INTEGER,
    quantity_rejected INTEGER,
    rejection_reason TEXT,
    
    -- Verification
    received_sku VARCHAR(100),                  -- SKU on delivered product
    sku_match BOOLEAN,                          -- Does received SKU match ordered?
    vintage_match BOOLEAN,                      -- Does vintage match?
    received_vintage INTEGER,
    
    -- Metadata
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_procurement_order_items_order ON procurement_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_procurement_order_items_inventory ON procurement_order_items(inventory_id);
CREATE INDEX IF NOT EXISTS idx_procurement_order_items_wine ON procurement_order_items(master_wine_id);
CREATE INDEX IF NOT EXISTS idx_procurement_order_items_sku ON procurement_order_items(sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_procurement_order_items_vendor_sku ON procurement_order_items(vendor_sku) WHERE vendor_sku IS NOT NULL;

-- Trigger for updated_at
CREATE TRIGGER update_procurement_order_items_updated_at 
BEFORE UPDATE ON procurement_order_items 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 5. CREATE SKU_MAPPINGS TABLE
-- ============================================================================
-- Central mapping table for cross-system SKU reconciliation

CREATE TABLE IF NOT EXISTS sku_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Restaurant Context (NULL for global mappings)
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    
    -- Primary Reference
    master_wine_id UUID REFERENCES master_wine_library(id),
    inventory_id UUID REFERENCES restaurant_inventory(id),
    
    -- SKU Types
    sku_type VARCHAR(50) NOT NULL,              -- 'internal', 'pos', 'vendor', 'upc', 'ean', 'manufacturer'
    sku_value VARCHAR(100) NOT NULL,
    
    -- Source System
    source_system VARCHAR(50),                  -- 'toast', 'square', 'clover', 'manual', 'import'
    source_id VARCHAR(100),                     -- ID in source system
    
    -- Vendor (if vendor-specific SKU)
    provider_id UUID REFERENCES providers(id),
    
    -- Status
    is_primary BOOLEAN DEFAULT false,           -- Primary SKU for this wine?
    is_active BOOLEAN DEFAULT true,
    verified_at TIMESTAMPTZ,
    verified_by UUID,
    
    -- Metadata
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(restaurant_id, master_wine_id, sku_type, sku_value)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sku_mappings_restaurant ON sku_mappings(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_sku_mappings_wine ON sku_mappings(master_wine_id);
CREATE INDEX IF NOT EXISTS idx_sku_mappings_inventory ON sku_mappings(inventory_id);
CREATE INDEX IF NOT EXISTS idx_sku_mappings_type ON sku_mappings(sku_type);
CREATE INDEX IF NOT EXISTS idx_sku_mappings_value ON sku_mappings(sku_value);
CREATE INDEX IF NOT EXISTS idx_sku_mappings_provider ON sku_mappings(provider_id);
CREATE INDEX IF NOT EXISTS idx_sku_mappings_lookup ON sku_mappings(sku_type, sku_value) WHERE is_active = true;

-- Trigger for updated_at
CREATE TRIGGER update_sku_mappings_updated_at 
BEFORE UPDATE ON sku_mappings 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE sku_mappings ENABLE ROW LEVEL SECURITY;

-- RLS Policy
CREATE POLICY "Users can view SKU mappings for their restaurant"
ON sku_mappings FOR SELECT
USING (
    restaurant_id IS NULL OR  -- Global mappings visible to all
    restaurant_id IN (
        SELECT restaurant_id FROM user_restaurant_access
        WHERE user_id = auth.uid()
    )
);

-- ============================================================================
-- 6. CREATE TOAST_ITEM_MAPPINGS TABLE
-- ============================================================================
-- Dedicated table for Toast POS item ↔ Inventory mapping

CREATE TABLE IF NOT EXISTS toast_item_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    
    -- Toast Side
    toast_guid VARCHAR(100) NOT NULL,           -- Toast item GUID
    toast_menu_item_id VARCHAR(100),
    toast_item_name VARCHAR(255) NOT NULL,
    toast_price DECIMAL(10,2),
    toast_sku VARCHAR(100),
    toast_plu VARCHAR(50),                      -- Price Look-Up code
    
    -- WineOps Side
    inventory_id UUID REFERENCES restaurant_inventory(id),
    master_wine_id UUID REFERENCES master_wine_library(id),
    
    -- Mapping Status
    mapping_status VARCHAR(50) DEFAULT 'unmapped',  -- 'unmapped', 'mapped', 'ignored', 'pending_review'
    mapping_confidence DECIMAL(3,2),                -- 0.00 to 1.00 (AI suggestion confidence)
    mapped_at TIMESTAMPTZ,
    mapped_by UUID,                                  -- NULL for AI mapping, user ID for manual
    
    -- Sales Tracking
    total_sales_count INTEGER DEFAULT 0,
    total_revenue DECIMAL(12,2) DEFAULT 0,
    last_sale_at TIMESTAMPTZ,
    
    -- Sync Status
    last_synced_at TIMESTAMPTZ,
    sync_error TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(restaurant_id, toast_guid)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_toast_mappings_restaurant ON toast_item_mappings(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_toast_mappings_guid ON toast_item_mappings(toast_guid);
CREATE INDEX IF NOT EXISTS idx_toast_mappings_inventory ON toast_item_mappings(inventory_id);
CREATE INDEX IF NOT EXISTS idx_toast_mappings_status ON toast_item_mappings(mapping_status);
CREATE INDEX IF NOT EXISTS idx_toast_mappings_restaurant_status ON toast_item_mappings(restaurant_id, mapping_status);
CREATE INDEX IF NOT EXISTS idx_toast_mappings_unmapped ON toast_item_mappings(restaurant_id) WHERE mapping_status = 'unmapped';

-- Trigger for updated_at
CREATE TRIGGER update_toast_item_mappings_updated_at 
BEFORE UPDATE ON toast_item_mappings 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 7. CREATE SKU LOOKUP FUNCTIONS
-- ============================================================================

-- Function: Find inventory item by any SKU
CREATE OR REPLACE FUNCTION find_inventory_by_sku(
    p_restaurant_id UUID,
    p_sku VARCHAR(100)
)
RETURNS TABLE(
    inventory_id UUID,
    master_wine_id UUID,
    wine_name VARCHAR(255),
    sku VARCHAR(100),
    sku_type VARCHAR(50),
    current_stock INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ri.id as inventory_id,
        ri.master_wine_id,
        mw.name as wine_name,
        COALESCE(ri.sku, ri.internal_sku, ri.pos_sku, mw.sku) as sku,
        CASE 
            WHEN ri.sku = p_sku THEN 'sku'
            WHEN ri.internal_sku = p_sku THEN 'internal_sku'
            WHEN ri.pos_sku = p_sku THEN 'pos_sku'
            WHEN mw.sku = p_sku THEN 'master_sku'
            WHEN mw.upc = p_sku THEN 'upc'
            WHEN mw.ean = p_sku THEN 'ean'
            ELSE 'alias'
        END as sku_type,
        ri.stock_live as current_stock
    FROM restaurant_inventory ri
    JOIN master_wine_library mw ON ri.master_wine_id = mw.id
    WHERE ri.restaurant_id = p_restaurant_id
      AND ri.deleted_at IS NULL
      AND (
          ri.sku = p_sku
          OR ri.internal_sku = p_sku
          OR ri.pos_sku = p_sku
          OR mw.sku = p_sku
          OR mw.upc = p_sku
          OR mw.ean = p_sku
          OR mw.manufacturer_sku = p_sku
          OR ri.sku_aliases ? p_sku
          OR mw.distributor_skus ? p_sku
      )
    LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function: Find inventory by Toast GUID
CREATE OR REPLACE FUNCTION find_inventory_by_toast_guid(
    p_restaurant_id UUID,
    p_toast_guid VARCHAR(100)
)
RETURNS TABLE(
    inventory_id UUID,
    master_wine_id UUID,
    wine_name VARCHAR(255),
    sku VARCHAR(100),
    current_stock INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ri.id as inventory_id,
        ri.master_wine_id,
        mw.name as wine_name,
        COALESCE(ri.sku, mw.sku) as sku,
        ri.stock_live as current_stock
    FROM restaurant_inventory ri
    JOIN master_wine_library mw ON ri.master_wine_id = mw.id
    WHERE ri.restaurant_id = p_restaurant_id
      AND ri.toast_item_guid = p_toast_guid
      AND ri.deleted_at IS NULL
    LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function: Resolve SKU to inventory (tries multiple methods)
CREATE OR REPLACE FUNCTION resolve_sku_to_inventory(
    p_restaurant_id UUID,
    p_sku VARCHAR(100),
    p_toast_guid VARCHAR(100) DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_inventory_id UUID;
BEGIN
    -- Priority 1: Try Toast GUID first (most reliable for POS sync)
    IF p_toast_guid IS NOT NULL THEN
        SELECT id INTO v_inventory_id
        FROM restaurant_inventory
        WHERE restaurant_id = p_restaurant_id
          AND toast_item_guid = p_toast_guid
          AND deleted_at IS NULL
        LIMIT 1;
        
        IF v_inventory_id IS NOT NULL THEN
            RETURN v_inventory_id;
        END IF;
    END IF;
    
    -- Priority 2: Try direct SKU match
    SELECT id INTO v_inventory_id
    FROM restaurant_inventory ri
    WHERE ri.restaurant_id = p_restaurant_id
      AND ri.deleted_at IS NULL
      AND (ri.sku = p_sku OR ri.internal_sku = p_sku OR ri.pos_sku = p_sku)
    LIMIT 1;
    
    IF v_inventory_id IS NOT NULL THEN
        RETURN v_inventory_id;
    END IF;
    
    -- Priority 3: Try master wine SKU
    SELECT ri.id INTO v_inventory_id
    FROM restaurant_inventory ri
    JOIN master_wine_library mw ON ri.master_wine_id = mw.id
    WHERE ri.restaurant_id = p_restaurant_id
      AND ri.deleted_at IS NULL
      AND (mw.sku = p_sku OR mw.upc = p_sku OR mw.ean = p_sku)
    LIMIT 1;
    
    IF v_inventory_id IS NOT NULL THEN
        RETURN v_inventory_id;
    END IF;
    
    -- Priority 4: Try SKU mappings table
    SELECT sm.inventory_id INTO v_inventory_id
    FROM sku_mappings sm
    WHERE sm.restaurant_id = p_restaurant_id
      AND sm.sku_value = p_sku
      AND sm.is_active = true
    LIMIT 1;
    
    RETURN v_inventory_id;  -- May be NULL if not found
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- 8. CREATE SKU VIEWS
-- ============================================================================

-- View: Complete SKU reference for a restaurant
CREATE OR REPLACE VIEW v_restaurant_sku_reference AS
SELECT 
    ri.restaurant_id,
    r.name as restaurant_name,
    ri.id as inventory_id,
    ri.master_wine_id,
    mw.name as wine_name,
    mw.producer,
    mw.vintage,
    
    -- All SKU variants
    COALESCE(ri.sku, mw.sku) as primary_sku,
    ri.internal_sku,
    ri.pos_sku,
    mw.sku as master_sku,
    mw.upc,
    mw.ean,
    mw.manufacturer_sku,
    
    -- POS Item IDs
    ri.toast_item_guid,
    ri.toast_menu_item_id,
    ri.square_item_id,
    ri.clover_item_id,
    
    -- Stock Info
    ri.stock_live as current_stock,
    ri.threshold_min,
    ri.is_active
FROM restaurant_inventory ri
JOIN restaurants r ON ri.restaurant_id = r.id
JOIN master_wine_library mw ON ri.master_wine_id = mw.id
WHERE ri.deleted_at IS NULL;

-- View: Unmapped Toast items
CREATE OR REPLACE VIEW v_unmapped_toast_items AS
SELECT 
    tim.restaurant_id,
    r.name as restaurant_name,
    tim.toast_guid,
    tim.toast_item_name,
    tim.toast_price,
    tim.toast_sku,
    tim.toast_plu,
    tim.total_sales_count,
    tim.total_revenue,
    tim.last_sale_at,
    tim.created_at
FROM toast_item_mappings tim
JOIN restaurants r ON tim.restaurant_id = r.id
WHERE tim.mapping_status = 'unmapped'
ORDER BY tim.total_revenue DESC;

-- View: SKU conflicts/duplicates
CREATE OR REPLACE VIEW v_sku_conflicts AS
SELECT 
    restaurant_id,
    sku_value,
    sku_type,
    COUNT(*) as conflict_count,
    array_agg(DISTINCT master_wine_id) as conflicting_wines,
    array_agg(DISTINCT inventory_id) as conflicting_inventory
FROM sku_mappings
WHERE is_active = true
GROUP BY restaurant_id, sku_value, sku_type
HAVING COUNT(*) > 1;

-- ============================================================================
-- 9. ADD TRIGGERS FOR SKU SYNC
-- ============================================================================

-- Trigger: Sync SKU from master_wine_library to new inventory items
CREATE OR REPLACE FUNCTION sync_sku_to_new_inventory()
RETURNS TRIGGER AS $$
BEGIN
    -- If no SKU set on inventory, copy from master wine
    IF NEW.sku IS NULL THEN
        SELECT sku INTO NEW.sku
        FROM master_wine_library
        WHERE id = NEW.master_wine_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_sku_on_inventory_insert
BEFORE INSERT ON restaurant_inventory
FOR EACH ROW EXECUTE FUNCTION sync_sku_to_new_inventory();

-- ============================================================================
-- 10. SEED DEFAULT SKU DATA (Optional)
-- ============================================================================

-- Update existing wines with generated SKUs if missing
UPDATE master_wine_library
SET sku = 'WO-' || wine_id
WHERE sku IS NULL AND wine_id IS NOT NULL;

-- Update existing inventory with SKU from master
UPDATE restaurant_inventory ri
SET sku = mw.sku
FROM master_wine_library mw
WHERE ri.master_wine_id = mw.id
  AND ri.sku IS NULL
  AND mw.sku IS NOT NULL;

-- ============================================================================
-- 11. VERIFICATION QUERIES
-- ============================================================================
-- Run these to verify the migration succeeded

/*
-- Check new columns on master_wine_library
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'master_wine_library' 
AND column_name IN ('sku', 'upc', 'ean', 'manufacturer_sku', 'distributor_skus');

-- Check new columns on restaurant_inventory
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'restaurant_inventory' 
AND column_name IN ('toast_item_guid', 'toast_menu_item_id', 'square_item_id', 'clover_item_id', 'internal_sku', 'pos_sku', 'sku_aliases');

-- Check new columns on sales_events
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'sales_events' 
AND column_name IN ('sku', 'pos_item_guid', 'pos_sku', 'wine_id');

-- Check new tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('procurement_order_items', 'sku_mappings', 'toast_item_mappings');

-- Check functions exist
SELECT proname FROM pg_proc 
WHERE proname IN ('find_inventory_by_sku', 'find_inventory_by_toast_guid', 'resolve_sku_to_inventory');

-- Check views exist
SELECT table_name FROM information_schema.views 
WHERE table_schema = 'public' 
AND table_name IN ('v_restaurant_sku_reference', 'v_unmapped_toast_items', 'v_sku_conflicts');

-- Check indexes
SELECT indexname FROM pg_indexes 
WHERE tablename IN ('master_wine_library', 'restaurant_inventory', 'sales_events', 'sku_mappings', 'toast_item_mappings')
AND indexname LIKE '%sku%' OR indexname LIKE '%toast%';
*/

-- ============================================================================
-- 12. ENABLE REALTIME FOR NEW TABLES
-- ============================================================================

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'toast_item_mappings'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE toast_item_mappings;
    END IF;
EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'supabase_realtime publication not found, skipping';
END $$;

-- ============================================================================
-- END OF SKU SCHEMA ADDITIONS
-- ============================================================================

-- Success message
SELECT 
    '✅ SKU Schema Additions Complete!' as status,
    'Run verification queries above to confirm' as next_step;
