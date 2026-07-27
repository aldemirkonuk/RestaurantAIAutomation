-- ============================================================================
-- BASELINE MIGRATION CONSOLIDATION
-- ============================================================================
-- This migration file consolidates all legacy migrations from
-- services/database/migrations/ (files 000-013) into the Supabase CLI
-- migration system as the single source of truth.
--
-- Previously, the schema was managed outside the Supabase migration system,
-- which caused migration faults. This file now acts as the authoritative
-- baseline.
--
-- IMPORTANT: This migration is idempotent (uses IF NOT EXISTS throughout).
-- If the tables already exist in the live DB, this is a no-op.
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Restaurants
CREATE TABLE IF NOT EXISTS restaurants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    address TEXT,
    timezone VARCHAR(50) DEFAULT 'America/New_York',
    cuisine_type VARCHAR(100),
    seating_capacity INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT,
    name VARCHAR(255),
    phone VARCHAR(50),
    role VARCHAR(50) DEFAULT 'manager',
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE SET NULL,
    auth_provider VARCHAR(50) DEFAULT 'email',
    oauth_provider VARCHAR(50),
    oauth_id TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User-Restaurant access (for RLS)
CREATE TABLE IF NOT EXISTS user_restaurant_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'manager',
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, restaurant_id)
);

-- Master Wine Library
CREATE TABLE IF NOT EXISTS master_wine_library (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(500) NOT NULL,
    producer VARCHAR(255),
    region VARCHAR(255),
    country VARCHAR(100),
    grape_variety VARCHAR(255),
    vintage INTEGER,
    wine_type VARCHAR(50),
    color VARCHAR(50),
    alcohol_pct DECIMAL(4,1),
    tasting_notes TEXT,
    description TEXT,
    avg_price DECIMAL(10,2),
    barcode VARCHAR(100),
    upc VARCHAR(50),
    ean VARCHAR(50),
    sku VARCHAR(100),
    image_url TEXT,
    embedding VECTOR(384),
    search_vector TSVECTOR,
    barcode_vintage_mapping JSONB DEFAULT '{}',
    ai_enriched BOOLEAN DEFAULT false,
    enrichment_source VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wine_library_search ON master_wine_library USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_wine_library_name_trgm ON master_wine_library USING GIN(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_wine_library_barcode ON master_wine_library(barcode) WHERE barcode IS NOT NULL;

-- Providers (Vendors)
CREATE TABLE IF NOT EXISTS providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    contact_name VARCHAR(255),
    address TEXT,
    specialties TEXT[],
    lead_time_days INTEGER DEFAULT 3,
    minimum_order DECIMAL(10,2),
    payment_terms VARCHAR(100),
    rating DECIMAL(3,2),
    ai_personality_notes TEXT,
    competitor_group VARCHAR(100),
    preferred_channel VARCHAR(50) DEFAULT 'email',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Restaurant Inventory
CREATE TABLE IF NOT EXISTS restaurant_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    master_wine_id UUID REFERENCES master_wine_library(id),
    wine_name VARCHAR(500),
    stock_live INTEGER DEFAULT 0,
    stock_physical INTEGER DEFAULT 0,
    shadow_stock INTEGER DEFAULT 0,
    in_transit_quantity INTEGER DEFAULT 0,
    threshold_min INTEGER DEFAULT 3,
    threshold_max INTEGER DEFAULT 50,
    reorder_quantity INTEGER DEFAULT 6,
    sales_velocity_7d DECIMAL(10,2) DEFAULT 0,
    current_volume_ml DECIMAL(10,2),
    storage_location_id UUID,
    toast_item_guid VARCHAR(255),
    internal_sku VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    last_counted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_restaurant ON restaurant_inventory(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_wine ON restaurant_inventory(master_wine_id);

-- Storage Locations
CREATE TABLE IF NOT EXISTS storage_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES storage_locations(id),
    location_type VARCHAR(50) DEFAULT 'cellar',
    temperature VARCHAR(50),
    humidity VARCHAR(50),
    capacity INTEGER DEFAULT 100,
    current_count INTEGER DEFAULT 0,
    color VARCHAR(20) DEFAULT '#6b7280',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- PROCUREMENT & ORDERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS procurement_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID REFERENCES restaurant_inventory(id),
    provider_id UUID REFERENCES providers(id),
    wine_name VARCHAR(500),
    quantity INTEGER NOT NULL,
    unit_type VARCHAR(20) DEFAULT 'BOTTLE',
    target_price_per_bottle DECIMAL(10,2),
    negotiated_price_per_bottle DECIMAL(10,2),
    total_estimated_cost DECIMAL(10,2),
    final_confirmed_cost DECIMAL(10,2),
    status VARCHAR(50) DEFAULT 'DRAFT',
    state_machine_state VARCHAR(50) DEFAULT 'DRAFT',
    urgency VARCHAR(20) DEFAULT 'medium',
    expected_delivery DATE,
    actual_delivery DATE,
    negotiation_attempt INTEGER DEFAULT 0,
    last_negotiation_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_procurement_orders_restaurant ON procurement_orders(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_procurement_orders_status ON procurement_orders(status);

-- Procurement conversations
CREATE TABLE IF NOT EXISTS procurement_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES procurement_orders(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id),
    direction VARCHAR(20) DEFAULT 'OUTBOUND',
    channel VARCHAR(50),
    content TEXT,
    ai_summary TEXT,
    status VARCHAR(50) DEFAULT 'PENDING',
    sent_at TIMESTAMPTZ,
    delivery_status VARCHAR(50),
    time_to_approval_seconds INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Order interactions (verification, barcode scans)
CREATE TABLE IF NOT EXISTS order_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES procurement_orders(id) ON DELETE CASCADE,
    interaction_type VARCHAR(50),
    channel VARCHAR(50),
    content TEXT,
    ai_summary TEXT,
    barcode_scanned VARCHAR(100),
    vintage_mismatch_detected BOOLEAN DEFAULT false,
    vintage_mismatch_details JSONB,
    recording_url TEXT,
    call_uuid VARCHAR(100),
    call_duration_seconds INTEGER,
    transcript TEXT,
    detected_intent VARCHAR(100),
    detected_sentiment VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- SALES & POS
-- ============================================================================

CREATE TABLE IF NOT EXISTS sales_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID REFERENCES restaurant_inventory(id),
    quantity INTEGER NOT NULL,
    price DECIMAL(10,2),
    pos_item_guid VARCHAR(255),
    pos_order_id VARCHAR(255),
    sold_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS toast_item_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    toast_item_guid VARCHAR(255) NOT NULL,
    inventory_id UUID REFERENCES restaurant_inventory(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(restaurant_id, toast_item_guid)
);

CREATE TABLE IF NOT EXISTS sku_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    source_system VARCHAR(50),
    source_sku VARCHAR(255),
    inventory_id UUID REFERENCES restaurant_inventory(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pos_webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID,
    event_type VARCHAR(100),
    payload JSONB,
    processed BOOLEAN DEFAULT false,
    error TEXT,
    received_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- NOTIFICATIONS & EVENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    source_page VARCHAR(100),
    payload JSONB DEFAULT '{}',
    idempotency_key VARCHAR(255),
    correlation_id VARCHAR(255),
    schema_version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(restaurant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    manager_id UUID,
    notification_type VARCHAR(100),
    channels TEXT[],
    payload JSONB,
    results JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    low_stock_channels TEXT[] DEFAULT ARRAY['push', 'email'],
    order_channels TEXT[] DEFAULT ARRAY['push'],
    report_channels TEXT[] DEFAULT ARRAY['email'],
    quiet_hours_enabled BOOLEAN DEFAULT false,
    quiet_hours_start VARCHAR(10) DEFAULT '22:00',
    quiet_hours_end VARCHAR(10) DEFAULT '08:00',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    type VARCHAR(50) DEFAULT 'web_push',
    subscription_data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS one_tap_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL,
    priority VARCHAR(20) DEFAULT 'MEDIUM',
    related_wine_id UUID,
    related_order_id UUID,
    related_provider_id UUID,
    metadata JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'PENDING',
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- CALENDAR
-- ============================================================================

CREATE TABLE IF NOT EXISTS calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    event_type VARCHAR(50) DEFAULT 'custom',
    start_date DATE NOT NULL,
    start_time TIME,
    end_date DATE,
    end_time TIME,
    all_day BOOLEAN DEFAULT false,
    provider_id UUID REFERENCES providers(id),
    order_id UUID REFERENCES procurement_orders(id),
    source VARCHAR(50) DEFAULT 'manual',
    status VARCHAR(20) DEFAULT 'pending',
    notification_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calendar_recurrence_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES calendar_events(id) ON DELETE CASCADE,
    frequency VARCHAR(20) NOT NULL,
    interval_value INTEGER DEFAULT 1,
    days_of_week INTEGER[],
    end_date DATE,
    max_occurrences INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calendar_recurrence_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recurrence_id UUID REFERENCES calendar_recurrence_rules(id) ON DELETE CASCADE,
    exception_date DATE NOT NULL,
    exception_type VARCHAR(20) DEFAULT 'cancelled',
    replacement_event_id UUID REFERENCES calendar_events(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provider_important_dates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID REFERENCES providers(id) ON DELETE CASCADE,
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    event_type VARCHAR(50),
    description TEXT,
    confidence DECIMAL(3,2) DEFAULT 1.0,
    source VARCHAR(50) DEFAULT 'manual',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- REPORTING & ANALYTICS
-- ============================================================================

CREATE TABLE IF NOT EXISTS generated_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    report_type VARCHAR(100),
    format VARCHAR(20) DEFAULT 'pdf',
    file_url TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduled_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    report_type VARCHAR(100),
    schedule VARCHAR(100),
    format VARCHAR(20) DEFAULT 'pdf',
    recipients TEXT[],
    active BOOLEAN DEFAULT true,
    last_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS manager_report_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    cadence VARCHAR(50) DEFAULT 'weekly',
    format VARCHAR(20) DEFAULT 'pdf',
    sections TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    metric_key VARCHAR(255) NOT NULL,
    metric_value JSONB NOT NULL,
    cached_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    UNIQUE(restaurant_id, metric_key)
);

CREATE TABLE IF NOT EXISTS budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    month DATE NOT NULL,
    total_budget DECIMAL(12,2),
    spent DECIMAL(12,2) DEFAULT 0,
    category_budgets JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(restaurant_id, month)
);

-- ============================================================================
-- INVENTORY LEDGER & AUDIT
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID REFERENCES restaurant_inventory(id),
    transaction_type VARCHAR(50) NOT NULL,
    quantity INTEGER NOT NULL,
    reference_id UUID,
    reference_type VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id VARCHAR(255),
    old_value JSONB,
    new_value JSONB,
    actor_type VARCHAR(50),
    actor_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS export_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    export_type VARCHAR(50),
    format VARCHAR(20),
    file_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- PROVIDER PERFORMANCE
-- ============================================================================

CREATE TABLE IF NOT EXISTS provider_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id),
    order_id UUID REFERENCES procurement_orders(id),
    delivery_time_accuracy DECIMAL(3,2),
    communication_score DECIMAL(3,2),
    price_fairness DECIMAL(3,2),
    quality_score DECIMAL(3,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provider_performance_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID REFERENCES providers(id) ON DELETE CASCADE,
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    avg_delivery_accuracy DECIMAL(3,2),
    avg_communication DECIMAL(3,2),
    avg_price_fairness DECIMAL(3,2),
    avg_quality DECIMAL(3,2),
    total_orders INTEGER DEFAULT 0,
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- AGENT TABLES (P1 features)
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory_trust_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID NOT NULL REFERENCES restaurant_inventory(id) ON DELETE CASCADE,
    trust_score DECIMAL(3,2) DEFAULT 1.0,
    last_calculated_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT
);

CREATE TABLE IF NOT EXISTS inventory_discrepancies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID NOT NULL REFERENCES restaurant_inventory(id) ON DELETE CASCADE,
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    expected_stock INTEGER,
    actual_stock INTEGER,
    delta INTEGER,
    source VARCHAR(50),
    status VARCHAR(50) DEFAULT 'open',
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT
);

CREATE TABLE IF NOT EXISTS negotiation_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id),
    order_id UUID REFERENCES procurement_orders(id),
    direction VARCHAR(20),
    message_text TEXT,
    price_offered DECIMAL(10,2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    success BOOLEAN
);

CREATE TABLE IF NOT EXISTS auto_pilot_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID NOT NULL REFERENCES restaurant_inventory(id) ON DELETE CASCADE,
    target_stock INTEGER NOT NULL,
    min_stock INTEGER NOT NULL,
    max_price DECIMAL(10,2),
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS compliance_deadlines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    jurisdiction VARCHAR(100),
    deadline_type VARCHAR(100),
    due_date DATE NOT NULL,
    status VARCHAR(50) DEFAULT 'open',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS excise_tax_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    total_tax DECIMAL(12,2),
    filed_at TIMESTAMPTZ,
    status VARCHAR(50) DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS shrinkage_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID REFERENCES restaurant_inventory(id),
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    severity VARCHAR(20),
    expected_loss DECIMAL(10,2),
    details JSONB,
    status VARCHAR(50) DEFAULT 'open'
);

-- ============================================================================
-- FEATURE FLAGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS restaurant_feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    flag_name VARCHAR(100) NOT NULL,
    enabled BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(restaurant_id, flag_name)
);

-- ============================================================================
-- AGENT ACTIVITY LOGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name VARCHAR(100) NOT NULL,
    restaurant_id UUID,
    action VARCHAR(100),
    status VARCHAR(50),
    duration_ms INTEGER,
    metadata JSONB DEFAULT '{}',
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_activity_logs_agent ON agent_activity_logs(agent_name, created_at DESC);

-- ============================================================================
-- RECURRING ORDERS & VENDOR DEADLINES
-- ============================================================================

CREATE TABLE IF NOT EXISTS recurring_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    wine_id UUID REFERENCES master_wine_library(id),
    provider_id UUID REFERENCES providers(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_type VARCHAR(10) DEFAULT 'bottle',
    frequency VARCHAR(20) NOT NULL,
    frequency_day INTEGER,
    auto_approve BOOLEAN DEFAULT false,
    next_order_date DATE NOT NULL,
    last_order_date DATE,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendor_deadlines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id),
    deadline_day INTEGER NOT NULL,
    deadline_time TIME NOT NULL,
    notification_hours_before INTEGER DEFAULT 48,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- MISCELLANEOUS TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS invoice_scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id),
    scan_type VARCHAR(10) DEFAULT 'image',
    file_url TEXT,
    ocr_status VARCHAR(20) DEFAULT 'pending',
    extracted_data JSONB,
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profit_margins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    total_revenue DECIMAL(10,2),
    total_cost DECIMAL(10,2),
    profit_margin DECIMAL(5,2),
    wine_revenue DECIMAL(10,2),
    wine_cost DECIMAL(10,2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(restaurant_id, date)
);

CREATE TABLE IF NOT EXISTS vintage_substitution_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    wine_id UUID REFERENCES master_wine_library(id),
    max_year_variance INTEGER DEFAULT 2,
    price_adjustment_formula TEXT,
    auto_accept BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS batch_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    operation_type VARCHAR(100),
    items JSONB DEFAULT '[]',
    status VARCHAR(50) DEFAULT 'pending',
    rollback_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rfq_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID REFERENCES restaurant_inventory(id),
    quantity INTEGER NOT NULL,
    delivery_deadline DATE,
    status VARCHAR(50) DEFAULT 'PENDING',
    vendor_responses JSONB DEFAULT '[]',
    winner_provider_id UUID REFERENCES providers(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    channel VARCHAR(50) DEFAULT 'email',
    subject TEXT,
    body TEXT NOT NULL,
    variables TEXT[],
    version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- HELPER FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- END OF BASELINE MIGRATION
-- ============================================================================
