-- ============================================================================
-- INVENTORY AUTO-LOGGING TRIGGERS
-- Migration: 006
-- Purpose: Automatically log inventory changes to the transaction ledger
-- Date: January 2026
-- ============================================================================

-- ============================================================================
-- 1. TRIGGER FUNCTION: Log inventory changes
-- ============================================================================

CREATE OR REPLACE FUNCTION log_inventory_change()
RETURNS TRIGGER AS $$
DECLARE
    v_quantity_change INTEGER;
    v_transaction_type inventory_transaction_type;
    v_source inventory_transaction_source;
BEGIN
    -- Only log if stock actually changed
    IF TG_OP = 'UPDATE' THEN
        -- Check if stock_live changed
        IF OLD.stock_live IS DISTINCT FROM NEW.stock_live THEN
            v_quantity_change := COALESCE(NEW.stock_live, 0) - COALESCE(OLD.stock_live, 0);
            
            -- Determine transaction type based on context
            -- This is a fallback - ideally transactions should be created via the API
            v_transaction_type := 'adjustment';
            v_source := 'system';
            
            -- Skip if change is 0
            IF v_quantity_change = 0 THEN
                RETURN NEW;
            END IF;
            
            -- Insert transaction record
            INSERT INTO inventory_transactions (
                restaurant_id,
                inventory_id,
                wine_id,
                transaction_type,
                source,
                quantity_change,
                quantity_before,
                quantity_after,
                stock_type,
                performed_by_type,
                reason,
                metadata
            ) VALUES (
                NEW.restaurant_id,
                NEW.id,
                NEW.wine_id,
                v_transaction_type,
                v_source,
                v_quantity_change,
                COALESCE(OLD.stock_live, 0),
                COALESCE(NEW.stock_live, 0),
                'live',
                'system',
                'Auto-logged from direct inventory update',
                jsonb_build_object(
                    'trigger', 'log_inventory_change',
                    'operation', TG_OP,
                    'old_updated_at', OLD.updated_at,
                    'new_updated_at', NEW.updated_at
                )
            );
        END IF;
        
        -- Check if shadow_stock changed
        IF OLD.shadow_stock IS DISTINCT FROM NEW.shadow_stock THEN
            v_quantity_change := COALESCE(NEW.shadow_stock, 0) - COALESCE(OLD.shadow_stock, 0);
            
            IF v_quantity_change != 0 THEN
                INSERT INTO inventory_transactions (
                    restaurant_id,
                    inventory_id,
                    wine_id,
                    transaction_type,
                    source,
                    quantity_change,
                    quantity_before,
                    quantity_after,
                    stock_type,
                    performed_by_type,
                    reason,
                    metadata
                ) VALUES (
                    NEW.restaurant_id,
                    NEW.id,
                    NEW.wine_id,
                    'adjustment',
                    'system',
                    v_quantity_change,
                    COALESCE(OLD.shadow_stock, 0),
                    COALESCE(NEW.shadow_stock, 0),
                    'shadow',
                    'system',
                    'Auto-logged shadow stock change',
                    jsonb_build_object(
                        'trigger', 'log_inventory_change',
                        'operation', TG_OP
                    )
                );
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. CREATE TRIGGER (disabled by default - enable if direct updates are needed)
-- ============================================================================

-- Note: This trigger is created but disabled by default.
-- The preferred approach is to use the record_inventory_transaction() function
-- which handles both the update and logging atomically.
-- Enable this trigger only if you need to log direct SQL updates.

DROP TRIGGER IF EXISTS inventory_change_logger ON restaurant_inventory;

CREATE TRIGGER inventory_change_logger
AFTER UPDATE ON restaurant_inventory
FOR EACH ROW
WHEN (
    OLD.stock_live IS DISTINCT FROM NEW.stock_live OR
    OLD.shadow_stock IS DISTINCT FROM NEW.shadow_stock
)
EXECUTE FUNCTION log_inventory_change();

-- Disable by default (uncomment to enable)
-- ALTER TABLE restaurant_inventory DISABLE TRIGGER inventory_change_logger;

-- ============================================================================
-- 3. TRIGGER FUNCTION: Log order deliveries
-- ============================================================================

CREATE OR REPLACE FUNCTION log_order_delivery()
RETURNS TRIGGER AS $$
DECLARE
    v_inventory_id UUID;
    v_wine_id UUID;
    v_quantity INTEGER;
    v_unit_cost DECIMAL(10,2);
BEGIN
    -- Only trigger when status changes to 'delivered'
    IF NEW.status = 'delivered' AND OLD.status != 'delivered' THEN
        -- Get the wine_id and quantity from the order
        v_wine_id := NEW.wine_id;
        v_quantity := NEW.quantity;
        v_unit_cost := NEW.final_price / NULLIF(NEW.quantity, 0);
        
        -- Find the inventory item for this wine
        SELECT id INTO v_inventory_id
        FROM restaurant_inventory
        WHERE restaurant_id = NEW.restaurant_id
          AND wine_id = v_wine_id
        LIMIT 1;
        
        -- If inventory item exists, log the transaction
        IF v_inventory_id IS NOT NULL THEN
            -- Use the record_inventory_transaction function
            PERFORM record_inventory_transaction(
                p_restaurant_id := NEW.restaurant_id,
                p_inventory_id := v_inventory_id,
                p_wine_id := v_wine_id,
                p_transaction_type := 'purchase',
                p_source := 'order',
                p_quantity_change := v_quantity,
                p_stock_type := 'live',
                p_reference_type := 'procurement_order',
                p_reference_id := NEW.id,
                p_order_id := NEW.id,
                p_unit_cost := v_unit_cost,
                p_performed_by_type := 'system',
                p_reason := 'Order delivered',
                p_metadata := jsonb_build_object(
                    'provider_id', NEW.provider_id,
                    'order_date', NEW.created_at,
                    'delivery_date', NEW.delivered_at
                )
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for order deliveries
DROP TRIGGER IF EXISTS order_delivery_logger ON procurement_orders;

CREATE TRIGGER order_delivery_logger
AFTER UPDATE ON procurement_orders
FOR EACH ROW
WHEN (NEW.status = 'delivered' AND OLD.status != 'delivered')
EXECUTE FUNCTION log_order_delivery();

-- ============================================================================
-- 4. FUNCTION: Log POS sale (to be called from Toast webhook handler)
-- ============================================================================

CREATE OR REPLACE FUNCTION log_pos_sale(
    p_restaurant_id UUID,
    p_wine_id UUID,
    p_quantity INTEGER,
    p_pos_transaction_id VARCHAR,
    p_unit_price DECIMAL DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    v_inventory_id UUID;
    v_transaction_id UUID;
BEGIN
    -- Find the inventory item
    SELECT id INTO v_inventory_id
    FROM restaurant_inventory
    WHERE restaurant_id = p_restaurant_id
      AND wine_id = p_wine_id
    LIMIT 1;
    
    IF v_inventory_id IS NULL THEN
        RAISE EXCEPTION 'Inventory item not found for wine: %', p_wine_id;
    END IF;
    
    -- Record the sale (negative quantity)
    v_transaction_id := record_inventory_transaction(
        p_restaurant_id := p_restaurant_id,
        p_inventory_id := v_inventory_id,
        p_wine_id := p_wine_id,
        p_transaction_type := 'sale',
        p_source := 'pos',
        p_quantity_change := -ABS(p_quantity),  -- Always negative for sales
        p_stock_type := 'live',
        p_pos_transaction_id := p_pos_transaction_id,
        p_unit_cost := p_unit_price,
        p_performed_by_type := 'system',
        p_reason := 'POS sale',
        p_metadata := p_metadata
    );
    
    RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. FUNCTION: Log waste/spillage
-- ============================================================================

CREATE OR REPLACE FUNCTION log_waste(
    p_restaurant_id UUID,
    p_wine_id UUID,
    p_quantity INTEGER,
    p_reason TEXT,
    p_performed_by UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_inventory_id UUID;
    v_transaction_id UUID;
BEGIN
    -- Find the inventory item
    SELECT id INTO v_inventory_id
    FROM restaurant_inventory
    WHERE restaurant_id = p_restaurant_id
      AND wine_id = p_wine_id
    LIMIT 1;
    
    IF v_inventory_id IS NULL THEN
        RAISE EXCEPTION 'Inventory item not found for wine: %', p_wine_id;
    END IF;
    
    -- Record the waste (negative quantity)
    v_transaction_id := record_inventory_transaction(
        p_restaurant_id := p_restaurant_id,
        p_inventory_id := v_inventory_id,
        p_wine_id := p_wine_id,
        p_transaction_type := 'waste',
        p_source := 'manual',
        p_quantity_change := -ABS(p_quantity),  -- Always negative for waste
        p_stock_type := 'live',
        p_performed_by := p_performed_by,
        p_performed_by_type := CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
        p_reason := p_reason,
        p_notes := p_notes,
        p_metadata := '{}'::jsonb
    );
    
    RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6. FUNCTION: Log comp/staff consumption
-- ============================================================================

CREATE OR REPLACE FUNCTION log_comp(
    p_restaurant_id UUID,
    p_wine_id UUID,
    p_quantity INTEGER,
    p_reason TEXT,
    p_performed_by UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_inventory_id UUID;
    v_transaction_id UUID;
BEGIN
    -- Find the inventory item
    SELECT id INTO v_inventory_id
    FROM restaurant_inventory
    WHERE restaurant_id = p_restaurant_id
      AND wine_id = p_wine_id
    LIMIT 1;
    
    IF v_inventory_id IS NULL THEN
        RAISE EXCEPTION 'Inventory item not found for wine: %', p_wine_id;
    END IF;
    
    -- Record the comp (negative quantity)
    v_transaction_id := record_inventory_transaction(
        p_restaurant_id := p_restaurant_id,
        p_inventory_id := v_inventory_id,
        p_wine_id := p_wine_id,
        p_transaction_type := 'comp',
        p_source := 'manual',
        p_quantity_change := -ABS(p_quantity),  -- Always negative for comps
        p_stock_type := 'live',
        p_performed_by := p_performed_by,
        p_performed_by_type := CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
        p_reason := p_reason,
        p_notes := p_notes,
        p_metadata := '{}'::jsonb
    );
    
    RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. SCHEDULED JOB: Refresh transaction summary (call via cron)
-- ============================================================================

-- This should be scheduled to run every hour via pg_cron or external scheduler:
-- SELECT refresh_inventory_transaction_summary();

-- ============================================================================
-- 8. COMMENTS
-- ============================================================================

COMMENT ON FUNCTION log_inventory_change IS 'Trigger function to auto-log direct inventory updates';
COMMENT ON FUNCTION log_order_delivery IS 'Trigger function to log inventory increase when orders are delivered';
COMMENT ON FUNCTION log_pos_sale IS 'Helper function to log POS sales - call from Toast webhook handler';
COMMENT ON FUNCTION log_waste IS 'Helper function to log waste/spillage';
COMMENT ON FUNCTION log_comp IS 'Helper function to log complimentary/staff consumption';

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
