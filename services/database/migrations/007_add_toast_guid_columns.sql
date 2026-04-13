-- ============================================================================
-- TOAST GUID MAPPING COLUMNS
-- Migration: 007
-- Purpose: Add Toast POS GUID columns for restaurant and inventory mapping
-- Date: January 2026
-- ============================================================================

-- ============================================================================
-- 1. ADD toast_restaurant_guid TO restaurants TABLE
-- ============================================================================
-- This column stores the Toast POS restaurant GUID for webhook routing
-- Webhooks from Toast include restaurantGuid - we need to map to our internal ID

DO $$ BEGIN
    ALTER TABLE restaurants ADD COLUMN toast_restaurant_guid VARCHAR(100);
EXCEPTION WHEN duplicate_column THEN null;
END $$;

-- Unique index (one Toast GUID per restaurant)
CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_toast_guid 
ON restaurants(toast_restaurant_guid) 
WHERE toast_restaurant_guid IS NOT NULL;

COMMENT ON COLUMN restaurants.toast_restaurant_guid IS 
'Toast POS restaurant GUID for webhook routing. Format: rest_XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX';

-- ============================================================================
-- 2. ADD toast_item_guid TO restaurant_inventory TABLE
-- ============================================================================
-- This column stores the Toast POS menu item GUID for sales mapping
-- When a POS sale comes in, we need to map the Toast item to our inventory

DO $$ BEGIN
    ALTER TABLE restaurant_inventory ADD COLUMN toast_item_guid VARCHAR(100);
EXCEPTION WHEN duplicate_column THEN null;
END $$;

-- Index for lookup (not unique - same Toast item could be mapped differently per restaurant)
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_toast_guid 
ON restaurant_inventory(toast_item_guid) 
WHERE toast_item_guid IS NOT NULL;

-- Composite unique index (one Toast item per restaurant)
CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_inventory_toast_guid_unique
ON restaurant_inventory(restaurant_id, toast_item_guid)
WHERE toast_item_guid IS NOT NULL;

COMMENT ON COLUMN restaurant_inventory.toast_item_guid IS 
'Toast POS menu item GUID for sales mapping. Format: item_XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX';

-- ============================================================================
-- 3. ADD toast_order_guid TO procurement_orders TABLE (for order tracking)
-- ============================================================================
-- Optional: If using Toast for order placement tracking

DO $$ BEGIN
    ALTER TABLE procurement_orders ADD COLUMN toast_order_guid VARCHAR(100);
EXCEPTION WHEN duplicate_column THEN null;
END $$;

CREATE INDEX IF NOT EXISTS idx_procurement_orders_toast_guid 
ON procurement_orders(toast_order_guid) 
WHERE toast_order_guid IS NOT NULL;

COMMENT ON COLUMN procurement_orders.toast_order_guid IS 
'Toast POS order GUID for tracking orders placed through Toast';

-- ============================================================================
-- 4. FUNCTION: Map Toast item to internal inventory
-- ============================================================================
-- Helper function to find inventory by Toast item GUID

CREATE OR REPLACE FUNCTION get_inventory_by_toast_guid(
    p_restaurant_id UUID,
    p_toast_item_guid VARCHAR
)
RETURNS TABLE (
    inventory_id UUID,
    wine_id UUID,
    wine_name TEXT,
    current_stock INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ri.id AS inventory_id,
        ri.master_wine_id AS wine_id,
        mwl.name AS wine_name,
        ri.stock_live AS current_stock
    FROM restaurant_inventory ri
    JOIN master_wine_library mwl ON ri.master_wine_id = mwl.id
    WHERE ri.restaurant_id = p_restaurant_id
      AND ri.toast_item_guid = p_toast_item_guid
      AND ri.is_active = true
    LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_inventory_by_toast_guid IS 
'Maps Toast POS item GUID to internal inventory for sales processing';

-- ============================================================================
-- 5. FUNCTION: Process Toast sale webhook
-- ============================================================================
-- Processes a sale from Toast, mapping the item and logging the transaction

CREATE OR REPLACE FUNCTION process_toast_sale(
    p_toast_restaurant_guid VARCHAR,
    p_toast_item_guid VARCHAR,
    p_quantity INTEGER,
    p_pos_transaction_id VARCHAR,
    p_unit_price DECIMAL DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS TABLE (
    success BOOLEAN,
    transaction_id UUID,
    inventory_id UUID,
    message TEXT
) AS $$
DECLARE
    v_restaurant_id UUID;
    v_inventory_id UUID;
    v_wine_id UUID;
    v_txn_id UUID;
BEGIN
    -- Find restaurant by Toast GUID
    SELECT id INTO v_restaurant_id
    FROM restaurants
    WHERE toast_restaurant_guid = p_toast_restaurant_guid;
    
    IF v_restaurant_id IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, 
            'Restaurant not found for Toast GUID: ' || p_toast_restaurant_guid;
        RETURN;
    END IF;
    
    -- Find inventory item by Toast item GUID
    SELECT ri.id, ri.master_wine_id INTO v_inventory_id, v_wine_id
    FROM restaurant_inventory ri
    WHERE ri.restaurant_id = v_restaurant_id
      AND ri.toast_item_guid = p_toast_item_guid
      AND ri.is_active = true
    LIMIT 1;
    
    IF v_inventory_id IS NULL THEN
        -- Item not mapped - could be a new menu item or non-wine item
        RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, 
            'Inventory item not mapped for Toast item GUID: ' || p_toast_item_guid;
        RETURN;
    END IF;
    
    -- Record the sale transaction
    BEGIN
        v_txn_id := record_inventory_transaction(
            p_restaurant_id := v_restaurant_id,
            p_inventory_id := v_inventory_id,
            p_wine_id := v_wine_id,
            p_transaction_type := 'sale',
            p_source := 'pos',
            p_quantity_change := -ABS(p_quantity),
            p_stock_type := 'live',
            p_pos_transaction_id := p_pos_transaction_id,
            p_unit_cost := p_unit_price,
            p_performed_by_type := 'system',
            p_reason := 'Toast POS sale',
            p_metadata := p_metadata
        );
        
        RETURN QUERY SELECT true, v_txn_id, v_inventory_id, 'Sale recorded successfully';
    EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT false, NULL::UUID, v_inventory_id, SQLERRM;
    END;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION process_toast_sale IS 
'Processes a Toast POS sale webhook, mapping the item and logging the inventory transaction';

-- ============================================================================
-- 6. VIEW: Unmapped Toast items
-- ============================================================================
-- Shows inventory items that don't have a Toast item GUID mapped

CREATE OR REPLACE VIEW v_unmapped_toast_items AS
SELECT 
    ri.id AS inventory_id,
    ri.restaurant_id,
    r.name AS restaurant_name,
    mwl.name AS wine_name,
    mwl.producer,
    mwl.vintage,
    ri.stock_live AS current_stock,
    ri.is_active,
    ri.created_at
FROM restaurant_inventory ri
JOIN restaurants r ON ri.restaurant_id = r.id
JOIN master_wine_library mwl ON ri.master_wine_id = mwl.id
WHERE ri.toast_item_guid IS NULL
  AND ri.is_active = true
  AND r.toast_restaurant_guid IS NOT NULL  -- Only show for Toast-connected restaurants
ORDER BY r.name, mwl.name;

COMMENT ON VIEW v_unmapped_toast_items IS 
'Shows active inventory items without Toast GUID mapping (need mapping for POS integration)';

-- ============================================================================
-- 7. GRANTS
-- ============================================================================

GRANT EXECUTE ON FUNCTION get_inventory_by_toast_guid TO authenticated;
GRANT EXECUTE ON FUNCTION process_toast_sale TO authenticated;
GRANT SELECT ON v_unmapped_toast_items TO authenticated;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
