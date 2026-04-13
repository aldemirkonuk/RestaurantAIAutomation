-- ============================================================================
-- ONE-TAP ACTIONS TABLE
-- Stores custom one-tap actions for managers to quickly execute common workflows
-- ============================================================================

-- Create enum for action types
DO $$ BEGIN
    CREATE TYPE one_tap_action_type AS ENUM (
        'low_stock',
        'price_change', 
        'delivery_confirm',
        'inequality',
        'vintage_sub',
        'stock_receipt',
        'custom',
        'gmail_send',
        'gmail_contextual'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create enum for action status
DO $$ BEGIN
    CREATE TYPE one_tap_action_status AS ENUM (
        'pending',
        'in_progress',
        'completed',
        'cancelled',
        'expired'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create enum for priority
DO $$ BEGIN
    CREATE TYPE one_tap_priority AS ENUM (
        'low',
        'medium',
        'high',
        'critical'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create the one_tap_actions table
CREATE TABLE IF NOT EXISTS one_tap_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Ownership
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- Action definition
    action_type one_tap_action_type NOT NULL DEFAULT 'custom',
    title VARCHAR(255) NOT NULL,
    description TEXT,
    action_url VARCHAR(500),
    
    -- Styling
    priority one_tap_priority NOT NULL DEFAULT 'medium',
    color VARCHAR(50) DEFAULT 'wine',
    icon VARCHAR(50) DEFAULT 'Zap',
    
    -- Status tracking
    status one_tap_action_status NOT NULL DEFAULT 'pending',
    
    -- Related entities (for system-generated actions)
    related_wine_id UUID REFERENCES master_wine_library(id) ON DELETE SET NULL,
    related_order_id UUID REFERENCES procurement_orders(id) ON DELETE SET NULL,
    related_provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
    
    -- Flexible metadata for action-specific data
    metadata JSONB DEFAULT '{}',
    
    -- Execution tracking
    executed_at TIMESTAMPTZ,
    executed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    execution_result JSONB,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    
    -- Soft delete
    deleted_at TIMESTAMPTZ
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_one_tap_actions_restaurant ON one_tap_actions(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_one_tap_actions_user ON one_tap_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_one_tap_actions_status ON one_tap_actions(status);
CREATE INDEX IF NOT EXISTS idx_one_tap_actions_type ON one_tap_actions(action_type);
CREATE INDEX IF NOT EXISTS idx_one_tap_actions_priority ON one_tap_actions(priority);
CREATE INDEX IF NOT EXISTS idx_one_tap_actions_pending ON one_tap_actions(restaurant_id, status) 
    WHERE status = 'pending' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_one_tap_actions_created ON one_tap_actions(created_at DESC);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_one_tap_actions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_one_tap_actions_updated_at ON one_tap_actions;
CREATE TRIGGER trigger_one_tap_actions_updated_at
    BEFORE UPDATE ON one_tap_actions
    FOR EACH ROW
    EXECUTE FUNCTION update_one_tap_actions_updated_at();

-- Create view for pending actions (commonly queried)
CREATE OR REPLACE VIEW v_pending_one_tap_actions AS
SELECT 
    ota.*,
    r.name as restaurant_name,
    mwl.name as wine_name,
    po.order_number,
    p.name as provider_name
FROM one_tap_actions ota
LEFT JOIN restaurants r ON ota.restaurant_id = r.id
LEFT JOIN master_wine_library mwl ON ota.related_wine_id = mwl.id
LEFT JOIN procurement_orders po ON ota.related_order_id = po.id
LEFT JOIN providers p ON ota.related_provider_id = p.id
WHERE ota.status = 'pending' 
  AND ota.deleted_at IS NULL
  AND (ota.expires_at IS NULL OR ota.expires_at > NOW())
ORDER BY 
    CASE ota.priority 
        WHEN 'critical' THEN 1 
        WHEN 'high' THEN 2 
        WHEN 'medium' THEN 3 
        WHEN 'low' THEN 4 
    END,
    ota.created_at DESC;

-- Create action history view
CREATE OR REPLACE VIEW v_one_tap_action_history AS
SELECT 
    ota.*,
    r.name as restaurant_name,
    u.email as executed_by_email
FROM one_tap_actions ota
LEFT JOIN restaurants r ON ota.restaurant_id = r.id
LEFT JOIN auth.users u ON ota.executed_by = u.id
WHERE ota.status IN ('completed', 'cancelled')
  AND ota.deleted_at IS NULL
ORDER BY ota.executed_at DESC;

-- Enable Row Level Security
ALTER TABLE one_tap_actions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see actions for their restaurant
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'restaurant_users'
    ) THEN
        DROP POLICY IF EXISTS one_tap_actions_restaurant_policy ON one_tap_actions;
        CREATE POLICY one_tap_actions_restaurant_policy ON one_tap_actions
            FOR ALL
            USING (
                restaurant_id IN (
                    SELECT restaurant_id FROM restaurant_users 
                    WHERE user_id = auth.uid()
                )
            );
    ELSE
        RAISE NOTICE 'Skipping one_tap_actions_restaurant_policy: restaurant_users table not found';
    END IF;
END $$;

-- Grant permissions
GRANT ALL ON one_tap_actions TO authenticated;
GRANT ALL ON v_pending_one_tap_actions TO authenticated;
GRANT ALL ON v_one_tap_action_history TO authenticated;

-- Add comment
COMMENT ON TABLE one_tap_actions IS 'Stores one-tap actions for quick manager workflows (approve orders, confirm deliveries, etc.)';
