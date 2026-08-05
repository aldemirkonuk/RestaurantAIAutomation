-- Restaurant Feature Flags Migration
-- Version: 1.0
-- Date: January 25, 2026
-- Description: Adds feature flags system for restaurants to enable/disable features per restaurant

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================
-- RESTAURANT FEATURE FLAGS
-- ==============================================
-- Allows restaurants to enable/disable specific features
CREATE TABLE IF NOT EXISTS restaurant_feature_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL, -- References restaurants(id)
  
  -- Feature flags (all default to true for backward compatibility)
  enable_inventory_storage_locations BOOLEAN DEFAULT true,
  enable_auto_procurement BOOLEAN DEFAULT true,
  enable_visual_verification BOOLEAN DEFAULT true,
  enable_predictive_analytics BOOLEAN DEFAULT true,
  enable_ai_negotiation BOOLEAN DEFAULT true,
  enable_sommelier_ai BOOLEAN DEFAULT true,
  enable_voice_agent BOOLEAN DEFAULT true,
  enable_menu_analyzer BOOLEAN DEFAULT true,
  enable_calendar_sync BOOLEAN DEFAULT true,
  enable_whatsapp_business BOOLEAN DEFAULT true,
  enable_quickbooks_sync BOOLEAN DEFAULT true,
  enable_recurring_orders BOOLEAN DEFAULT true,
  enable_invoice_scanning BOOLEAN DEFAULT true,
  enable_check_scanning BOOLEAN DEFAULT true,
  enable_auction_purchases BOOLEAN DEFAULT true,
  enable_profit_margin_tracking BOOLEAN DEFAULT true,
  enable_guest_crm BOOLEAN DEFAULT true,
  enable_wine_pairing_ai BOOLEAN DEFAULT true,
  enable_compliance_autopilot BOOLEAN DEFAULT true,
  enable_shrinkage_detective BOOLEAN DEFAULT true,
  enable_staff_training_simulator BOOLEAN DEFAULT true,
  enable_pour_cost_optimizer BOOLEAN DEFAULT true,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure one flag set per restaurant
  CONSTRAINT uq_restaurant_feature_flags_restaurant UNIQUE (restaurant_id)
);

-- Index for fast lookups (idempotent)
CREATE INDEX IF NOT EXISTS idx_restaurant_feature_flags_restaurant ON restaurant_feature_flags(restaurant_id);

-- Foreign key constraint (if restaurants table exists)
-- Note: This will fail if restaurants table doesn't exist yet, but that's okay
-- The migration system should handle table creation order
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'restaurants') THEN
    ALTER TABLE restaurant_feature_flags
      ADD CONSTRAINT fk_restaurant_feature_flags_restaurant
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ==============================================
-- TRIGGER FOR UPDATED_AT
-- ==============================================
CREATE OR REPLACE FUNCTION update_feature_flags_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Idempotent trigger creation (drop if exists, then create)
DROP TRIGGER IF EXISTS update_restaurant_feature_flags_updated_at ON restaurant_feature_flags;
CREATE TRIGGER update_restaurant_feature_flags_updated_at 
  BEFORE UPDATE ON restaurant_feature_flags
  FOR EACH ROW 
  EXECUTE FUNCTION update_feature_flags_updated_at();

-- ==============================================
-- HELPER FUNCTION: Get feature flag value
-- ==============================================
CREATE OR REPLACE FUNCTION get_restaurant_feature_flag(
  p_restaurant_id UUID,
  p_feature_name TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_result BOOLEAN;
BEGIN
  SELECT CASE p_feature_name
    WHEN 'inventory_storage_locations' THEN enable_inventory_storage_locations
    WHEN 'auto_procurement' THEN enable_auto_procurement
    WHEN 'visual_verification' THEN enable_visual_verification
    WHEN 'predictive_analytics' THEN enable_predictive_analytics
    WHEN 'ai_negotiation' THEN enable_ai_negotiation
    WHEN 'sommelier_ai' THEN enable_sommelier_ai
    WHEN 'voice_agent' THEN enable_voice_agent
    WHEN 'menu_analyzer' THEN enable_menu_analyzer
    WHEN 'calendar_sync' THEN enable_calendar_sync
    WHEN 'whatsapp_business' THEN enable_whatsapp_business
    WHEN 'quickbooks_sync' THEN enable_quickbooks_sync
    WHEN 'recurring_orders' THEN enable_recurring_orders
    WHEN 'invoice_scanning' THEN enable_invoice_scanning
    WHEN 'check_scanning' THEN enable_check_scanning
    WHEN 'auction_purchases' THEN enable_auction_purchases
    WHEN 'profit_margin_tracking' THEN enable_profit_margin_tracking
    WHEN 'guest_crm' THEN enable_guest_crm
    WHEN 'wine_pairing_ai' THEN enable_wine_pairing_ai
    WHEN 'compliance_autopilot' THEN enable_compliance_autopilot
    WHEN 'shrinkage_detective' THEN enable_shrinkage_detective
    WHEN 'staff_training_simulator' THEN enable_staff_training_simulator
    WHEN 'pour_cost_optimizer' THEN enable_pour_cost_optimizer
    ELSE true -- Default to enabled if feature name not found
  END INTO v_result
  FROM restaurant_feature_flags
  WHERE restaurant_id = p_restaurant_id;
  
  -- If no flags exist for this restaurant, return true (default enabled)
  RETURN COALESCE(v_result, true);
END;
$$ LANGUAGE plpgsql;

-- ==============================================
-- COMMENTS FOR DOCUMENTATION
-- ==============================================
COMMENT ON TABLE restaurant_feature_flags IS 'Per-restaurant feature flags to enable/disable specific features';
COMMENT ON FUNCTION get_restaurant_feature_flag IS 'Helper function to check if a feature is enabled for a restaurant';

-- ==============================================
-- ROLLBACK SCRIPT (For reference)
-- ==============================================
-- To rollback this migration, run:
/*
DROP TRIGGER IF EXISTS update_restaurant_feature_flags_updated_at ON restaurant_feature_flags;
DROP FUNCTION IF EXISTS update_feature_flags_updated_at() CASCADE;
DROP FUNCTION IF EXISTS get_restaurant_feature_flag(UUID, TEXT) CASCADE;
DROP TABLE IF EXISTS restaurant_feature_flags CASCADE;
*/
