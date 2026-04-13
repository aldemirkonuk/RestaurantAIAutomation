-- ============================================================================
-- CALENDAR RECURRENCE & INVENTORY TRANSACTION LEDGER
-- Migration: 005
-- Purpose: Add recurring event support and immutable inventory transaction log
-- Date: January 2026
-- ============================================================================

-- ============================================================================
-- PART 1: CALENDAR RECURRENCE SYSTEM
-- ============================================================================

-- 1.1 ENUMS FOR RECURRENCE
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE recurrence_frequency AS ENUM (
        'daily',
        'weekly',
        'monthly',
        'yearly',
        'custom'
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE recurrence_end_type AS ENUM (
        'never',
        'after_count',
        'on_date'
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE calendar_event_status AS ENUM (
        'pending',
        'approved',
        'dismissed',
        'completed',
        'cancelled'
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 1.1.1 ENSURE RESTAURANTS TABLE EXISTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS restaurants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    parent_restaurant_id UUID REFERENCES restaurants(id),
    group_name VARCHAR(100),
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    address JSONB,
    timezone VARCHAR(50) DEFAULT 'America/Los_Angeles',
    currency VARCHAR(3) DEFAULT 'USD',
    pos_system VARCHAR(50) DEFAULT 'toast',
    pos_credentials JSONB,
    buffer_window_minutes INTEGER DEFAULT 30,
    default_threshold_min INTEGER DEFAULT 3,
    is_active BOOLEAN DEFAULT true,
    subscription_tier VARCHAR(50) DEFAULT 'pilot',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_restaurants_slug ON restaurants(slug);
CREATE INDEX IF NOT EXISTS idx_restaurants_parent ON restaurants(parent_restaurant_id);
CREATE INDEX IF NOT EXISTS idx_restaurants_active ON restaurants(is_active) WHERE is_active = true;

-- 1.2 ADD RECURRENCE COLUMNS TO EXISTING CALENDAR_EVENTS TABLE
-- ============================================================================

-- Add recurrence fields to calendar_events if they don't exist
DO $$ BEGIN
    ALTER TABLE calendar_events ADD COLUMN is_recurring BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE calendar_events ADD COLUMN recurrence_rule_id UUID;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE calendar_events ADD COLUMN parent_event_id UUID REFERENCES calendar_events(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE calendar_events ADD COLUMN occurrence_date DATE;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE calendar_events ADD COLUMN is_exception BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE calendar_events ADD COLUMN exception_type VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN null;
END $$;

-- 1.3 RECURRENCE RULES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS calendar_recurrence_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Ownership
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    calendar_event_id UUID NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    
    -- Recurrence Pattern
    frequency recurrence_frequency NOT NULL,
    interval_value INTEGER NOT NULL DEFAULT 1,  -- Every N days/weeks/months
    
    -- Weekly: which days (0=Sunday, 1=Monday, ..., 6=Saturday)
    days_of_week INTEGER[],  -- e.g., [1, 3, 5] for Mon, Wed, Fri
    
    -- Monthly: which day of month or which week/day combo
    day_of_month INTEGER,  -- 1-31, NULL for "same day as start"
    week_of_month INTEGER,  -- 1-5, NULL for day_of_month mode
    
    -- Yearly: which month and day
    month_of_year INTEGER,  -- 1-12
    
    -- End Conditions
    end_type recurrence_end_type NOT NULL DEFAULT 'never',
    end_after_count INTEGER,  -- Number of occurrences
    end_on_date DATE,  -- End by this date
    
    -- Generation Tracking
    last_generated_date DATE,
    next_generation_date DATE,
    generation_horizon_days INTEGER DEFAULT 90,  -- Generate this many days ahead
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT valid_interval CHECK (interval_value > 0),
    CONSTRAINT valid_end_count CHECK (end_after_count IS NULL OR end_after_count > 0),
    CONSTRAINT valid_day_of_month CHECK (day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 31)),
    CONSTRAINT valid_week_of_month CHECK (week_of_month IS NULL OR (week_of_month >= 1 AND week_of_month <= 5)),
    CONSTRAINT valid_month_of_year CHECK (month_of_year IS NULL OR (month_of_year >= 1 AND month_of_year <= 12))
);

-- Indexes for recurrence rules
CREATE INDEX IF NOT EXISTS idx_recurrence_rules_restaurant ON calendar_recurrence_rules(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_recurrence_rules_event ON calendar_recurrence_rules(calendar_event_id);
CREATE INDEX IF NOT EXISTS idx_recurrence_rules_next_gen ON calendar_recurrence_rules(next_generation_date) 
    WHERE next_generation_date IS NOT NULL;

-- 1.4 RECURRENCE EXCEPTIONS TABLE (for modified/deleted occurrences)
-- ============================================================================

CREATE TABLE IF NOT EXISTS calendar_recurrence_exceptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    recurrence_rule_id UUID NOT NULL REFERENCES calendar_recurrence_rules(id) ON DELETE CASCADE,
    
    -- The original occurrence date being modified/deleted
    original_date DATE NOT NULL,
    
    -- Exception type
    exception_type VARCHAR(50) NOT NULL,  -- 'deleted', 'modified'
    
    -- For modified exceptions, the replacement event
    replacement_event_id UUID REFERENCES calendar_events(id) ON DELETE SET NULL,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT uq_exception_date UNIQUE (recurrence_rule_id, original_date)
);

CREATE INDEX IF NOT EXISTS idx_recurrence_exceptions_rule ON calendar_recurrence_exceptions(recurrence_rule_id);

-- 1.5 UPDATE CALENDAR_EVENTS INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_calendar_events_parent ON calendar_events(parent_event_id) 
    WHERE parent_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_events_recurring ON calendar_events(restaurant_id, is_recurring) 
    WHERE is_recurring = true;
CREATE INDEX IF NOT EXISTS idx_calendar_events_occurrence ON calendar_events(restaurant_id, occurrence_date) 
    WHERE occurrence_date IS NOT NULL;

-- ============================================================================
-- PART 2: INVENTORY TRANSACTION LEDGER
-- ============================================================================

-- 2.1 ENUMS FOR INVENTORY TRANSACTIONS
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE inventory_transaction_type AS ENUM (
        'sale',           -- POS sale
        'purchase',       -- Order received/delivered
        'adjustment',     -- Manual adjustment
        'transfer',       -- Location transfer
        'waste',          -- Spillage, breakage, spoilage
        'return',         -- Customer return
        'comp',           -- Complimentary/staff consumption
        'reconciliation', -- Physical count reconciliation
        'initial',        -- Initial inventory setup
        'correction'      -- Error correction
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE inventory_transaction_source AS ENUM (
        'pos',            -- Toast POS
        'manual',         -- Manual entry
        'order',          -- Procurement order
        'mobile_count',   -- Mobile inventory count
        'reconciliation', -- Reconciliation process
        'system',         -- System-generated
        'import',         -- Bulk import
        'api'             -- External API
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 2.2 INVENTORY TRANSACTIONS TABLE (IMMUTABLE LEDGER)
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Ownership
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    
    -- What changed
    inventory_id UUID NOT NULL,  -- References restaurant_inventory.id
    wine_id UUID NOT NULL,       -- Denormalized for query performance
    
    -- Transaction Details
    transaction_type inventory_transaction_type NOT NULL,
    source inventory_transaction_source NOT NULL,
    
    -- Quantity Change (positive = increase, negative = decrease)
    quantity_change INTEGER NOT NULL,
    
    -- Running Balance (for audit trail)
    quantity_before INTEGER NOT NULL,
    quantity_after INTEGER NOT NULL,
    
    -- Stock Type (which stock was affected)
    stock_type VARCHAR(20) NOT NULL DEFAULT 'live',  -- 'live', 'shadow', 'reserved'
    
    -- Reference IDs (for traceability)
    reference_type VARCHAR(50),  -- 'order', 'pos_transaction', 'count_session', etc.
    reference_id UUID,           -- ID of the related entity
    pos_transaction_id VARCHAR(100),  -- External POS transaction ID
    order_id UUID,               -- Procurement order ID
    
    -- Location (for transfers)
    from_location_id UUID,
    to_location_id UUID,
    
    -- Cost Tracking
    unit_cost DECIMAL(10, 2),    -- Cost per unit at time of transaction
    total_cost DECIMAL(10, 2),   -- Total cost impact
    
    -- Actor
    performed_by UUID,           -- User who performed the action
    performed_by_type VARCHAR(50) DEFAULT 'user',  -- 'user', 'system', 'agent'
    
    -- Reason/Notes
    reason TEXT,
    notes TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- IMMUTABILITY: No updates allowed, only inserts
    -- Corrections are made by adding a new 'correction' transaction
    
    CONSTRAINT valid_quantity_change CHECK (quantity_change != 0),
    CONSTRAINT valid_quantity_after CHECK (quantity_after = quantity_before + quantity_change)
);

-- Indexes for inventory transactions
CREATE INDEX IF NOT EXISTS idx_inv_txn_restaurant ON inventory_transactions(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_inv_txn_inventory ON inventory_transactions(inventory_id);
CREATE INDEX IF NOT EXISTS idx_inv_txn_wine ON inventory_transactions(wine_id);
CREATE INDEX IF NOT EXISTS idx_inv_txn_type ON inventory_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_inv_txn_source ON inventory_transactions(source);
CREATE INDEX IF NOT EXISTS idx_inv_txn_date ON inventory_transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_txn_restaurant_date ON inventory_transactions(restaurant_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_txn_reference ON inventory_transactions(reference_type, reference_id) 
    WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_txn_order ON inventory_transactions(order_id) 
    WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_txn_pos ON inventory_transactions(pos_transaction_id) 
    WHERE pos_transaction_id IS NOT NULL;

-- Partial index for recent transactions removed (NOW() is not IMMUTABLE in predicates)

-- 2.3 INVENTORY TRANSACTION SUMMARY (MATERIALIZED VIEW)
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS inventory_transaction_summary AS
SELECT 
    restaurant_id,
    wine_id,
    inventory_id,
    date_trunc('day', transaction_date) AS day,
    transaction_type,
    source,
    SUM(quantity_change) AS total_quantity_change,
    SUM(CASE WHEN quantity_change > 0 THEN quantity_change ELSE 0 END) AS total_in,
    SUM(CASE WHEN quantity_change < 0 THEN ABS(quantity_change) ELSE 0 END) AS total_out,
    COUNT(*) AS transaction_count,
    SUM(total_cost) AS total_cost_impact
FROM inventory_transactions
WHERE transaction_date > NOW() - INTERVAL '90 days'
GROUP BY 1, 2, 3, 4, 5, 6;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_txn_summary_pk 
ON inventory_transaction_summary(restaurant_id, wine_id, inventory_id, day, transaction_type, source);

-- 2.4 FUNCTION: Record Inventory Transaction
-- ============================================================================

CREATE OR REPLACE FUNCTION record_inventory_transaction(
    p_restaurant_id UUID,
    p_inventory_id UUID,
    p_wine_id UUID,
    p_transaction_type inventory_transaction_type,
    p_source inventory_transaction_source,
    p_quantity_change INTEGER,
    p_stock_type VARCHAR DEFAULT 'live',
    p_reference_type VARCHAR DEFAULT NULL,
    p_reference_id UUID DEFAULT NULL,
    p_pos_transaction_id VARCHAR DEFAULT NULL,
    p_order_id UUID DEFAULT NULL,
    p_unit_cost DECIMAL DEFAULT NULL,
    p_performed_by UUID DEFAULT NULL,
    p_performed_by_type VARCHAR DEFAULT 'user',
    p_reason TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    v_quantity_before INTEGER;
    v_quantity_after INTEGER;
    v_transaction_id UUID;
    v_stock_column TEXT;
BEGIN
    -- Determine which stock column to read
    v_stock_column := CASE p_stock_type
        WHEN 'live' THEN 'live_stock'
        WHEN 'shadow' THEN 'shadow_stock'
        ELSE 'live_stock'
    END;
    
    -- Get current quantity (with row lock)
    EXECUTE format(
        'SELECT COALESCE(%I, 0) FROM restaurant_inventory WHERE id = $1 FOR UPDATE',
        v_stock_column
    ) INTO v_quantity_before USING p_inventory_id;
    
    IF v_quantity_before IS NULL THEN
        RAISE EXCEPTION 'Inventory item not found: %', p_inventory_id;
    END IF;
    
    -- Calculate new quantity
    v_quantity_after := v_quantity_before + p_quantity_change;
    
    -- Prevent negative stock (optional - can be disabled for certain transaction types)
    IF v_quantity_after < 0 AND p_transaction_type NOT IN ('correction', 'reconciliation') THEN
        RAISE EXCEPTION 'Insufficient stock. Current: %, Requested change: %', v_quantity_before, p_quantity_change;
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
        reference_type,
        reference_id,
        pos_transaction_id,
        order_id,
        unit_cost,
        total_cost,
        performed_by,
        performed_by_type,
        reason,
        notes,
        metadata
    ) VALUES (
        p_restaurant_id,
        p_inventory_id,
        p_wine_id,
        p_transaction_type,
        p_source,
        p_quantity_change,
        v_quantity_before,
        v_quantity_after,
        p_stock_type,
        p_reference_type,
        p_reference_id,
        p_pos_transaction_id,
        p_order_id,
        p_unit_cost,
        CASE WHEN p_unit_cost IS NOT NULL THEN p_unit_cost * ABS(p_quantity_change) ELSE NULL END,
        p_performed_by,
        p_performed_by_type,
        p_reason,
        p_notes,
        p_metadata
    ) RETURNING id INTO v_transaction_id;
    
    -- Update the inventory table
    EXECUTE format(
        'UPDATE restaurant_inventory SET %I = $1, updated_at = NOW() WHERE id = $2',
        v_stock_column
    ) USING v_quantity_after, p_inventory_id;
    
    RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql;

-- 2.5 FUNCTION: Get Inventory Balance at Point in Time
-- ============================================================================

CREATE OR REPLACE FUNCTION get_inventory_balance_at(
    p_inventory_id UUID,
    p_as_of TIMESTAMPTZ,
    p_stock_type VARCHAR DEFAULT 'live'
)
RETURNS INTEGER AS $$
DECLARE
    v_balance INTEGER;
BEGIN
    SELECT quantity_after INTO v_balance
    FROM inventory_transactions
    WHERE inventory_id = p_inventory_id
      AND stock_type = p_stock_type
      AND transaction_date <= p_as_of
    ORDER BY transaction_date DESC, created_at DESC
    LIMIT 1;
    
    RETURN COALESCE(v_balance, 0);
END;
$$ LANGUAGE plpgsql STABLE;

-- 2.6 FUNCTION: Generate Recurrence Occurrences
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_recurring_events(
    p_rule_id UUID,
    p_horizon_date DATE DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_rule RECORD;
    v_parent_event RECORD;
    v_current_date DATE;
    v_end_date DATE;
    v_count INTEGER := 0;
    v_occurrence_count INTEGER := 0;
    v_max_occurrences INTEGER;
    v_days_of_week INTEGER[];
    v_next_dow INTEGER;
BEGIN
    -- Get the recurrence rule
    SELECT * INTO v_rule FROM calendar_recurrence_rules WHERE id = p_rule_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Recurrence rule not found: %', p_rule_id;
    END IF;
    
    -- Get the parent event
    SELECT * INTO v_parent_event FROM calendar_events WHERE id = v_rule.calendar_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent event not found: %', v_rule.calendar_event_id;
    END IF;
    
    -- Determine end date for generation
    v_end_date := COALESCE(
        p_horizon_date,
        CURRENT_DATE + (v_rule.generation_horizon_days || ' days')::INTERVAL
    );
    
    -- Apply rule end conditions
    IF v_rule.end_type = 'on_date' AND v_rule.end_on_date < v_end_date THEN
        v_end_date := v_rule.end_on_date;
    END IF;
    
    v_max_occurrences := CASE 
        WHEN v_rule.end_type = 'after_count' THEN v_rule.end_after_count
        ELSE 1000  -- Safety limit
    END;
    
    -- Start from last generated date or parent event date
    v_current_date := COALESCE(v_rule.last_generated_date, v_parent_event.event_date);
    
    -- Count existing occurrences
    SELECT COUNT(*) INTO v_occurrence_count
    FROM calendar_events
    WHERE parent_event_id = v_parent_event.id;
    
    -- Generate occurrences
    WHILE v_current_date <= v_end_date AND v_occurrence_count < v_max_occurrences LOOP
        -- Calculate next occurrence based on frequency
        CASE v_rule.frequency
            WHEN 'daily' THEN
                v_current_date := v_current_date + (v_rule.interval_value || ' days')::INTERVAL;
                
            WHEN 'weekly' THEN
                IF v_rule.days_of_week IS NOT NULL AND array_length(v_rule.days_of_week, 1) > 0 THEN
                    -- Find next matching day of week
                    v_current_date := v_current_date + '1 day'::INTERVAL;
                    WHILE EXTRACT(DOW FROM v_current_date)::INTEGER != ALL(v_rule.days_of_week) 
                          AND v_current_date <= v_end_date LOOP
                        v_current_date := v_current_date + '1 day'::INTERVAL;
                    END LOOP;
                ELSE
                    v_current_date := v_current_date + (v_rule.interval_value * 7 || ' days')::INTERVAL;
                END IF;
                
            WHEN 'monthly' THEN
                v_current_date := v_current_date + (v_rule.interval_value || ' months')::INTERVAL;
                IF v_rule.day_of_month IS NOT NULL THEN
                    v_current_date := date_trunc('month', v_current_date) + ((v_rule.day_of_month - 1) || ' days')::INTERVAL;
                END IF;
                
            WHEN 'yearly' THEN
                v_current_date := v_current_date + (v_rule.interval_value || ' years')::INTERVAL;
                
            ELSE
                EXIT;  -- Unknown frequency
        END CASE;
        
        -- Skip if past end date
        IF v_current_date > v_end_date THEN
            EXIT;
        END IF;
        
        -- Check if this date is an exception
        IF EXISTS (
            SELECT 1 FROM calendar_recurrence_exceptions
            WHERE recurrence_rule_id = p_rule_id AND original_date = v_current_date
        ) THEN
            CONTINUE;
        END IF;
        
        -- Check if occurrence already exists
        IF NOT EXISTS (
            SELECT 1 FROM calendar_events
            WHERE parent_event_id = v_parent_event.id AND occurrence_date = v_current_date
        ) THEN
            -- Create the occurrence
            INSERT INTO calendar_events (
                restaurant_id,
                provider_id,
                order_id,
                title,
                description,
                event_type,
                event_date,
                event_date_end,
                all_day,
                event_time,
                source,
                status,
                reminder_enabled,
                reminder_days_before,
                parent_event_id,
                occurrence_date,
                is_recurring,
                recurrence_rule_id
            ) VALUES (
                v_parent_event.restaurant_id,
                v_parent_event.provider_id,
                v_parent_event.order_id,
                v_parent_event.title,
                v_parent_event.description,
                v_parent_event.event_type,
                v_current_date,
                CASE WHEN v_parent_event.event_date_end IS NOT NULL 
                     THEN v_current_date + (v_parent_event.event_date_end - v_parent_event.event_date)
                     ELSE NULL END,
                v_parent_event.all_day,
                v_parent_event.event_time,
                'system_generated',
                'pending',
                v_parent_event.reminder_enabled,
                v_parent_event.reminder_days_before,
                v_parent_event.id,
                v_current_date,
                false,
                p_rule_id
            );
            
            v_count := v_count + 1;
            v_occurrence_count := v_occurrence_count + 1;
        END IF;
    END LOOP;
    
    -- Update last generated date
    UPDATE calendar_recurrence_rules
    SET last_generated_date = v_current_date,
        next_generation_date = v_end_date - (v_rule.generation_horizon_days / 2 || ' days')::INTERVAL,
        updated_at = NOW()
    WHERE id = p_rule_id;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- 2.7 FUNCTION: Refresh Inventory Transaction Summary
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_inventory_transaction_summary()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY inventory_transaction_summary;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PART 3: ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE calendar_recurrence_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_recurrence_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;

-- Recurrence Rules RLS
CREATE POLICY "Users can view their restaurant recurrence rules"
ON calendar_recurrence_rules FOR SELECT
USING (
    restaurant_id IN (
        SELECT restaurant_id FROM user_restaurant_access
        WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Users can manage their restaurant recurrence rules"
ON calendar_recurrence_rules FOR ALL
USING (
    restaurant_id IN (
        SELECT restaurant_id FROM user_restaurant_access
        WHERE user_id = auth.uid()
    )
);

-- Recurrence Exceptions RLS
CREATE POLICY "Users can view their restaurant recurrence exceptions"
ON calendar_recurrence_exceptions FOR SELECT
USING (
    recurrence_rule_id IN (
        SELECT id FROM calendar_recurrence_rules
        WHERE restaurant_id IN (
            SELECT restaurant_id FROM user_restaurant_access
            WHERE user_id = auth.uid()
        )
    )
);

-- Inventory Transactions RLS
CREATE POLICY "Users can view their restaurant transactions"
ON inventory_transactions FOR SELECT
USING (
    restaurant_id IN (
        SELECT restaurant_id FROM user_restaurant_access
        WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Users can insert transactions for their restaurant"
ON inventory_transactions FOR INSERT
WITH CHECK (
    restaurant_id IN (
        SELECT restaurant_id FROM user_restaurant_access
        WHERE user_id = auth.uid()
    )
);

-- No UPDATE or DELETE policies - ledger is immutable!

-- ============================================================================
-- PART 4: ENABLE REALTIME
-- ============================================================================

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'calendar_recurrence_rules'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE calendar_recurrence_rules;
    END IF;
EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'supabase_realtime publication not found, skipping';
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'inventory_transactions'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE inventory_transactions;
    END IF;
EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'supabase_realtime publication not found, skipping';
END $$;

-- ============================================================================
-- PART 5: GRANTS
-- ============================================================================

GRANT ALL ON calendar_recurrence_rules TO authenticated;
GRANT ALL ON calendar_recurrence_exceptions TO authenticated;
GRANT SELECT, INSERT ON inventory_transactions TO authenticated;
GRANT SELECT ON inventory_transaction_summary TO authenticated;

-- ============================================================================
-- PART 6: COMMENTS
-- ============================================================================

COMMENT ON TABLE calendar_recurrence_rules IS 'Defines recurrence patterns for calendar events';
COMMENT ON TABLE calendar_recurrence_exceptions IS 'Stores exceptions (deleted/modified occurrences) for recurring events';
COMMENT ON TABLE inventory_transactions IS 'Immutable ledger of all inventory changes for audit trail';
COMMENT ON FUNCTION record_inventory_transaction IS 'Atomically records an inventory transaction and updates stock';
COMMENT ON FUNCTION generate_recurring_events IS 'Generates future occurrences for a recurring event rule';
COMMENT ON FUNCTION get_inventory_balance_at IS 'Returns inventory balance at a specific point in time';

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
