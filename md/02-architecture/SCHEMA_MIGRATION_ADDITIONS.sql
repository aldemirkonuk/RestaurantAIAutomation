-- ============================================================================
-- WineOps AI - Schema Migration: Missing Tables & Fields
-- Version: 1.0.1
-- Purpose: Add missing tables and fields required by Blueprint and Agent Plan
-- Date: January 14, 2026
-- ============================================================================
-- 
-- This migration adds:
-- 1. order_interactions table (for Plivo voice call transcripts/recordings)
-- 2. manager_preferences table (unified preferences, distinct from report_profiles)
-- 3. unit_conversions table (Case → Bottle → Shot conversions)
-- 4. is_optional_tracking field to restaurant_inventory
-- 5. State machine fields to procurement_orders
--
-- Run this AFTER your main schema is deployed.
-- ============================================================================

-- ============================================================================
-- 1. ORDER_INTERACTIONS (Voice Call Transcripts & Recordings)
-- ============================================================================
-- Stores detailed interaction data for voice calls, SMS, email, WhatsApp
-- This is separate from procurement_conversations which is for message logs

CREATE TABLE IF NOT EXISTS order_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES procurement_orders(id) ON DELETE CASCADE,
    
    -- Interaction Details
    interaction_type VARCHAR(20) NOT NULL CHECK (interaction_type IN ('VOICE', 'SMS', 'EMAIL', 'WHATSAPP')),
    interaction_direction VARCHAR(20) NOT NULL CHECK (interaction_direction IN ('OUTBOUND', 'INBOUND')),
    
    -- Voice Call Details (for VOICE type)
    recording_url TEXT,  -- Plivo recording URL
    transcript TEXT,  -- Full transcription of call
    call_duration_seconds INTEGER,
    call_uuid VARCHAR(100),  -- Plivo call UUID
    
    -- AI Analysis
    ai_summary TEXT,  -- "Vendor offered $23/bottle"
    detected_intent VARCHAR(100),
    detected_sentiment VARCHAR(50),
    important_dates_detected JSONB,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_interactions_order ON order_interactions(order_id);
CREATE INDEX IF NOT EXISTS idx_order_interactions_type ON order_interactions(interaction_type);
CREATE INDEX IF NOT EXISTS idx_order_interactions_created ON order_interactions(created_at DESC);

-- Add trigger for updated_at
CREATE TRIGGER update_order_interactions_updated_at 
BEFORE UPDATE ON order_interactions 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 2. MANAGER_PREFERENCES (Unified Manager Preferences)
-- ============================================================================
-- This is a simplified, unified preferences table for manager-level settings
-- Note: notification_preferences and manager_report_profiles are more detailed
-- This table provides quick access to common preferences

CREATE TABLE IF NOT EXISTS manager_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    manager_id UUID NOT NULL,  -- References auth.users
    
    -- Report Preferences
    report_frequency VARCHAR(20) CHECK (report_frequency IN ('DAILY', 'WEEKLY', 'MONTHLY', 'NONE')),
    report_delivery_time TIME DEFAULT '07:00:00',
    report_timezone VARCHAR(50) DEFAULT 'America/Los_Angeles',
    
    -- Notification Channels (JSONB)
    notification_channels JSONB DEFAULT '{"sms": true, "email": true, "push": true, "voice": false}',
    
    -- Low Stock Alerts
    low_stock_alert_enabled BOOLEAN DEFAULT true,
    low_stock_alert_channels JSONB DEFAULT '{"sms": true, "push": true}',
    
    -- Quiet Hours
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(manager_id)
);

CREATE INDEX IF NOT EXISTS idx_manager_preferences_manager ON manager_preferences(manager_id);

-- Add trigger for updated_at
CREATE TRIGGER update_manager_preferences_updated_at 
BEFORE UPDATE ON manager_preferences 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 3. UNIT_CONVERSIONS (Purchase Unit → Pour Unit Mapping)
-- ============================================================================
-- Maps purchase units (Case, Bottle) to pour units (Shot, Glass, Bottle)
-- Example: 1 Case = 12 Bottles = 144 Shots

CREATE TABLE IF NOT EXISTS unit_conversions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID NOT NULL REFERENCES restaurant_inventory(id) ON DELETE CASCADE,
    
    -- Unit Mapping
    purchase_unit VARCHAR(50) NOT NULL,  -- 'case', 'bottle', 'liter'
    pour_unit VARCHAR(50) NOT NULL,  -- 'shot', 'glass', 'bottle'
    
    -- Conversion Rates
    purchase_to_pour_ratio DECIMAL(10,4) NOT NULL,  -- e.g., 1 case = 12 bottles = 144 shots
    pour_to_purchase_ratio DECIMAL(10,4) NOT NULL,  -- Inverse
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(restaurant_id, inventory_id, purchase_unit, pour_unit)
);

CREATE INDEX IF NOT EXISTS idx_unit_conversions_restaurant ON unit_conversions(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_unit_conversions_inventory ON unit_conversions(inventory_id);
CREATE INDEX IF NOT EXISTS idx_unit_conversions_units ON unit_conversions(purchase_unit, pour_unit);

-- Add trigger for updated_at
CREATE TRIGGER update_unit_conversions_updated_at 
BEFORE UPDATE ON unit_conversions 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 4. ADD is_optional_tracking TO restaurant_inventory
-- ============================================================================
-- Allows "Lazy Counts" vs "Strict Bin Tracking"

ALTER TABLE restaurant_inventory 
ADD COLUMN IF NOT EXISTS is_optional_tracking BOOLEAN DEFAULT false;

COMMENT ON COLUMN restaurant_inventory.is_optional_tracking IS 
'If true, allows "Lazy Counts" - strict bin tracking not required. If false, requires strict tracking.';

-- ============================================================================
-- 5. ADD STATE MACHINE FIELDS TO procurement_orders
-- ============================================================================
-- Supports the "Golden Path" workflow from Blueprint:
-- DRAFT_LOW_STOCK → AWAITING_MANAGER_INPUT → AI_NEGOTIATING → 
-- NEGOTIATION_REVIEW → APPROVED_QUEUED → SENT_TO_VENDOR → 
-- DELIVERED_PENDING_VERIFY → COMPLETED

-- State machine state (separate from status for workflow tracking)
ALTER TABLE procurement_orders 
ADD COLUMN IF NOT EXISTS state_machine_state VARCHAR(50) DEFAULT 'DRAFT_LOW_STOCK';

COMMENT ON COLUMN procurement_orders.state_machine_state IS 
'Workflow state: DRAFT_LOW_STOCK, AWAITING_MANAGER_INPUT, AI_NEGOTIATING, NEGOTIATION_REVIEW, APPROVED_QUEUED, SENT_TO_VENDOR, DELIVERED_PENDING_VERIFY, COMPLETED';

-- Recurring order support
ALTER TABLE procurement_orders
ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS cron_schedule VARCHAR(100);  -- e.g., '0 9 * * 1' (every Monday at 9 AM)

COMMENT ON COLUMN procurement_orders.is_recurring IS 'If true, this order repeats on a schedule';
COMMENT ON COLUMN procurement_orders.cron_schedule IS 'Cron expression for recurring orders (e.g., "0 9 * * 1" for weekly)';

-- Cost tracking
ALTER TABLE procurement_orders
ADD COLUMN IF NOT EXISTS total_estimated_cost DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS final_confirmed_cost DECIMAL(10,2);

COMMENT ON COLUMN procurement_orders.total_estimated_cost IS 'Initial estimated cost before negotiation';
COMMENT ON COLUMN procurement_orders.final_confirmed_cost IS 'Final confirmed cost after negotiation';

-- Negotiation tracking
ALTER TABLE procurement_orders
ADD COLUMN IF NOT EXISTS negotiation_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_negotiation_at TIMESTAMPTZ;

COMMENT ON COLUMN procurement_orders.negotiation_attempts IS 'Number of negotiation attempts made';
COMMENT ON COLUMN procurement_orders.last_negotiation_at IS 'Timestamp of last negotiation attempt';

-- Index for state machine queries
CREATE INDEX IF NOT EXISTS idx_procurement_orders_state ON procurement_orders(state_machine_state);
CREATE INDEX IF NOT EXISTS idx_procurement_orders_recurring ON procurement_orders(is_recurring) WHERE is_recurring = true;

-- ============================================================================
-- 6. ADD SMART THRESHOLD & LIQUID TRACKING FIELDS TO restaurant_inventory
-- ============================================================================

-- Smart Threshold Fields (for auto-approve/reject logic)
ALTER TABLE restaurant_inventory
ADD COLUMN IF NOT EXISTS target_price DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS max_price DECIMAL(10,2);

COMMENT ON COLUMN restaurant_inventory.target_price IS 
'Target price per unit. Quotes <= this price auto-approve.';
COMMENT ON COLUMN restaurant_inventory.max_price IS 
'Maximum acceptable price. Quotes > this price auto-reject.';

-- Liquid Tracking (Core Philosophy: "Liquids are Fluid")
ALTER TABLE restaurant_inventory
ADD COLUMN IF NOT EXISTS current_volume_ml FLOAT DEFAULT 0,
ADD COLUMN IF NOT EXISTS unit_type VARCHAR(20) DEFAULT 'BOTTLE' CHECK (unit_type IN ('BOTTLE', 'CASE', 'SHOT', 'GLASS'));

COMMENT ON COLUMN restaurant_inventory.current_volume_ml IS 
'Current volume in milliliters. Crucial for liquid tracking (shots, pours).';
COMMENT ON COLUMN restaurant_inventory.unit_type IS 
'Unit type: BOTTLE, CASE, SHOT, GLASS';

-- Generic Bucket & Velocity Weight
ALTER TABLE restaurant_inventory
ADD COLUMN IF NOT EXISTS is_generic_bucket BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS velocity_weight FLOAT DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS sku VARCHAR(100);

COMMENT ON COLUMN restaurant_inventory.is_generic_bucket IS 
'If true, this is a generic bucket (e.g., "Top Shelf Scotch") for Mystery Bucket Algorithm';
COMMENT ON COLUMN restaurant_inventory.velocity_weight IS 
'Weight for probabilistic guessing in velocity calculations';
COMMENT ON COLUMN restaurant_inventory.sku IS 
'Stock Keeping Unit identifier';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_target_price ON restaurant_inventory(target_price) WHERE target_price IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_sku ON restaurant_inventory(sku) WHERE sku IS NOT NULL;

-- ============================================================================
-- 7. ADD COMPETITOR GROUP TO providers
-- ============================================================================

ALTER TABLE providers
ADD COLUMN IF NOT EXISTS competitor_group VARCHAR(100);

COMMENT ON COLUMN providers.competitor_group IS 
'Group identifier for RFQ bidding (e.g., "premium_red_wines", "champagne_suppliers")';

CREATE INDEX IF NOT EXISTS idx_providers_competitor_group ON providers(competitor_group) WHERE competitor_group IS NOT NULL;

-- ============================================================================
-- 8. ADD OFFLINE SYNC FLAG TO procurement_orders
-- ============================================================================

ALTER TABLE procurement_orders
ADD COLUMN IF NOT EXISTS is_offline_sync BOOLEAN DEFAULT false;

COMMENT ON COLUMN procurement_orders.is_offline_sync IS 
'Flag to indicate order was created/updated while offline and synced when back online';

-- ============================================================================
-- 9. CREATE RFQ_REQUESTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS rfq_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    inventory_id UUID NOT NULL REFERENCES restaurant_inventory(id),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    
    -- RFQ Details
    wine_name VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL,
    requested_delivery_date DATE,
    
    -- Vendor Responses
    vendor_responses JSONB[],  -- Array of {vendor_id, price, availability, delivery_date, received_at}
    
    -- Selection
    selected_vendor_id UUID REFERENCES providers(id),
    selected_price DECIMAL(10,2),
    selection_reason TEXT,
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'responses_received', 'presented', 'approved', 'cancelled'
    presented_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rfq_requests_inventory ON rfq_requests(inventory_id);
CREATE INDEX IF NOT EXISTS idx_rfq_requests_restaurant ON rfq_requests(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_rfq_requests_status ON rfq_requests(status);

-- Add trigger for updated_at
CREATE TRIGGER update_rfq_requests_updated_at 
BEFORE UPDATE ON rfq_requests 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE rfq_requests ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 10. ADD BARCODE TRACKING FOR VINTAGE INTERCEPTOR
-- ============================================================================

-- Add barcode to master_wine_library
ALTER TABLE master_wine_library
ADD COLUMN IF NOT EXISTS barcode VARCHAR(50),
ADD COLUMN IF NOT EXISTS barcode_vintage_mapping JSONB;

COMMENT ON COLUMN master_wine_library.barcode IS 
'Barcode/UPC code for the wine. Same barcode may be used across vintages.';
COMMENT ON COLUMN master_wine_library.barcode_vintage_mapping IS 
'Stores barcode vintage history: {"barcode": "012345", "vintages": [2019, 2020], "current_vintage": 2020}';

CREATE INDEX IF NOT EXISTS idx_master_wine_library_barcode ON master_wine_library(barcode) WHERE barcode IS NOT NULL;

-- Add barcode scan tracking to order_interactions
ALTER TABLE order_interactions
ADD COLUMN IF NOT EXISTS barcode_scanned VARCHAR(50),
ADD COLUMN IF NOT EXISTS vintage_confirmed INTEGER,
ADD COLUMN IF NOT EXISTS vintage_mismatch_detected BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS vintage_mismatch_details JSONB;

COMMENT ON COLUMN order_interactions.barcode_scanned IS 
'Barcode scanned during delivery verification';
COMMENT ON COLUMN order_interactions.vintage_confirmed IS 
'Vintage year confirmed by manager during verification';
COMMENT ON COLUMN order_interactions.vintage_mismatch_detected IS 
'True if barcode vintage differs from invoice vintage';
COMMENT ON COLUMN order_interactions.vintage_mismatch_details IS 
'Stores mismatch details: {"barcode_vintage": 2019, "invoice_vintage": 2020, "manager_confirmed": 2020}';

-- ============================================================================
-- 10. ENABLE RLS ON NEW TABLES
-- ============================================================================

ALTER TABLE order_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE manager_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_conversions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 11. BASIC RLS POLICIES (Adjust based on your auth model)
-- ============================================================================

-- Order Interactions: Managers can view interactions for their restaurant's orders
CREATE POLICY "Managers can view order interactions"
ON order_interactions FOR SELECT
USING (
    order_id IN (
        SELECT id FROM procurement_orders
        WHERE restaurant_id IN (
            SELECT restaurant_id FROM user_restaurant_access
            WHERE user_id = auth.uid()
        )
    )
);

-- Manager Preferences: Users can only view/edit their own preferences
CREATE POLICY "Users can manage own preferences"
ON manager_preferences FOR ALL
USING (manager_id = auth.uid())
WITH CHECK (manager_id = auth.uid());

-- Unit Conversions: Managers can view conversions for their restaurant
CREATE POLICY "Managers can view unit conversions"
ON unit_conversions FOR SELECT
USING (
    restaurant_id IN (
        SELECT restaurant_id FROM user_restaurant_access
        WHERE user_id = auth.uid()
    )
);

-- ============================================================================
-- 12. VERIFICATION QUERIES (Run these to verify the migration)
-- ============================================================================

-- Verify tables exist
-- SELECT table_name FROM information_schema.tables 
-- WHERE table_schema = 'public' 
-- AND table_name IN ('order_interactions', 'manager_preferences', 'unit_conversions');

-- Verify columns added
-- SELECT column_name, data_type, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'restaurant_inventory' 
-- AND column_name = 'is_optional_tracking';

-- SELECT column_name, data_type, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'procurement_orders' 
-- AND column_name IN ('state_machine_state', 'is_recurring', 'cron_schedule', 'total_estimated_cost', 'final_confirmed_cost', 'negotiation_attempts', 'last_negotiation_at', 'is_offline_sync');

-- Verify smart threshold fields added
-- SELECT column_name, data_type, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'restaurant_inventory' 
-- AND column_name IN ('target_price', 'max_price', 'current_volume_ml', 'unit_type', 'is_generic_bucket', 'velocity_weight', 'sku');

-- Verify competitor_group added
-- SELECT column_name, data_type 
-- FROM information_schema.columns 
-- WHERE table_name = 'providers' 
-- AND column_name = 'competitor_group';

-- Verify rfq_requests table exists
-- SELECT table_name FROM information_schema.tables 
-- WHERE table_schema = 'public' 
-- AND table_name = 'rfq_requests';

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================

