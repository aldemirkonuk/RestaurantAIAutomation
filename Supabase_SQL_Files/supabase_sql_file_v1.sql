-- ============================================================================
-- WineOps AI - Complete Database Schema
-- Version: 1.0.0
-- Database: PostgreSQL 15+ with pgvector extension
-- Platform: Supabase
-- Last Updated: January 7, 2026
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Supabase pgvector extension is named "vector" (not "pgvector")
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For fuzzy text search

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- ============================================================================
-- 1. MASTER WINE LIBRARY (Global Catalog)
-- ============================================================================
-- The single source of truth for all wine information globally
-- This is a "Big Library" that all restaurants reference

CREATE TABLE master_wine_library (
    -- Primary Key
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wine_id VARCHAR(20) UNIQUE NOT NULL,  -- e.g., "WINE_001"
    sequential_id INTEGER UNIQUE,
    
    -- Basic Wine Info
    name VARCHAR(255) NOT NULL,
    producer VARCHAR(255) NOT NULL,
    vintage INTEGER,  -- NULL for NV (Non-Vintage)
    price_reference DECIMAL(10,2),  -- Suggested retail price
    
    -- Classification
    primary_type VARCHAR(50) NOT NULL,  -- 'red', 'white', 'sparkling', 'rosé', 'dessert'
    grape_variety TEXT,  -- 'Cabernet Sauvignon, Merlot'
    grape_family VARCHAR(100),
    country VARCHAR(100) NOT NULL,
    region VARCHAR(100),
    appellation VARCHAR(150),
    sub_region VARCHAR(100),
    appellation_class VARCHAR(150),
    
    -- Wine Structure (JSON for flexibility)
    wine_structure JSONB,  -- body, sweetness, acidity, tannins, alcohol_level, texture, finish, alcohol_pct
    
    -- Sensory Profile (JSON)
    sensory_profile JSONB,  -- primary_aromas, secondary_aromas, tertiary_aromas, flavor_intensity, aroma_complexity, flavor_profile
    
    -- Quality Classification (JSON)
    quality_classification JSONB,  -- quality_level, reserve_status, vintage_quality, producer_tier, awards_ratings
    
    -- Practical Attributes (JSON)
    practical_attributes JSONB,  -- glass_type, decanting_needed, ageability, drinking_window, serving_temp_c
    
    -- Market Value (JSON)
    market_value JSONB,  -- price_tier, value_rating, availability, trend_status, collectibility
    
    -- Advanced Categories (JSON)
    advanced_categories JSONB,  -- winemaking_techniques, farming_production, soil_terroir, climate_influence, oak_influence
    
    -- Technical Specs (JSON)
    technical_specs JSONB,  -- ph_level, malolactic_fermentation, sulfites, organic_biodynamic, residual_sugar_g_per_l
    
    -- Wine Insights
    producer_story TEXT,
    awards TEXT[],
    historical_notes TEXT,
    
    -- Grape Blend Info (JSON)
    grape_blend_info JSONB,  -- is_blend, blend_type, grape_composition, dominant_grape, dominant_percentage
    
    -- Region Hierarchy (JSON)
    region_hierarchy JSONB,  -- country, level_1, level_2, level_3, level_4, full_path
    
    -- Professional Ratings (JSON)
    professional_ratings JSONB,  -- ratings array, aggregated_scores, major_critics
    
    -- Winemaking Details (JSON)
    winemaking_details JSONB,  -- harvest, fermentation, aging, finishing
    
    -- Producer Details (JSON)
    producer_details JSONB,  -- winery_name, estate_name, winemaker, owner, year_founded, certifications
    
    -- Vineyard Details (JSON)
    vineyard_details JSONB,  -- vineyard_name, vine_age, altitude, soil_composition, viticulture practices
    
    -- Market Data (JSON)
    market_data JSONB,  -- pricing, distribution, sales_data
    
    -- AI Agent Features (JSON)
    ai_agent_features JSONB,  -- ai_readiness_score, feature_completeness, recommended_use_cases, conversation_starters
    
    -- ML Derived Features (JSON)
    ml_derived_features JSONB,  -- vintage_age_years, aroma_diversity_score, complexity_index, body_index
    
    -- Vector Embedding for Similarity Search
    embedding VECTOR(384),  -- Sentence-transformers embedding (all-MiniLM-L6-v2)
    
    -- Metadata
    source VARCHAR(100),  -- 'manual', 'vivino', 'wine_searcher', 'import'
    data_enrichment JSONB,  -- enhanced_date, enhancement_version, confidence_level, verified_updates
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,  -- Soft delete
    
    -- Full-text search
    search_vector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('english', 
            COALESCE(name, '') || ' ' || 
            COALESCE(producer, '') || ' ' || 
            COALESCE(region, '') || ' ' ||
            COALESCE(grape_variety, '')
        )
    ) STORED
);

-- Indexes for master_wine_library
CREATE INDEX idx_master_wine_library_wine_id ON master_wine_library(wine_id);
CREATE INDEX idx_master_wine_library_name ON master_wine_library(name);
CREATE INDEX idx_master_wine_library_producer ON master_wine_library(producer);
CREATE INDEX idx_master_wine_library_country_region ON master_wine_library(country, region);
CREATE INDEX idx_master_wine_library_primary_type ON master_wine_library(primary_type);
CREATE INDEX idx_master_wine_library_search_vector ON master_wine_library USING GIN(search_vector);
CREATE INDEX idx_master_wine_library_embedding ON master_wine_library USING ivfflat(embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_master_wine_library_deleted_at ON master_wine_library(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- 2. RESTAURANTS
-- ============================================================================

CREATE TABLE restaurants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Basic Info
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,  -- 'meyhouse-palo-alto'
    
    -- Hierarchy (for franchises)
    parent_restaurant_id UUID REFERENCES restaurants(id),  -- NULL for main, points to parent for franchises
    group_name VARCHAR(100),  -- e.g., 'MeyHouse Group'
    
    -- Contact Info
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    address JSONB,  -- street, city, state, zip, country
    
    -- Configuration
    timezone VARCHAR(50) DEFAULT 'America/Los_Angeles',
    currency VARCHAR(3) DEFAULT 'USD',
    
    -- POS Integration
    pos_system VARCHAR(50) DEFAULT 'toast',  -- 'toast', 'square', 'clover'
    pos_credentials JSONB,  -- Encrypted API keys
    
    -- Manager Configuration
    buffer_window_minutes INTEGER DEFAULT 30,
    default_threshold_min INTEGER DEFAULT 3,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    subscription_tier VARCHAR(50) DEFAULT 'pilot',  -- 'pilot', 'basic', 'premium'
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_restaurants_slug ON restaurants(slug);
CREATE INDEX idx_restaurants_parent ON restaurants(parent_restaurant_id);
CREATE INDEX idx_restaurants_active ON restaurants(is_active) WHERE is_active = true;

-- ============================================================================
-- 3. RESTAURANT INVENTORY (Local Stock per Restaurant)
-- ============================================================================
-- Links master wines to specific restaurant stock levels

CREATE TABLE restaurant_inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Links
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    master_wine_id UUID NOT NULL REFERENCES master_wine_library(id),
    -- NOTE: providers table is defined later in this file, so we add the FK constraint after providers exists.
    provider_id UUID,  -- Primary provider for this wine
    
    -- Stock Levels
    stock_live INTEGER NOT NULL DEFAULT 0,
    physical_stock INTEGER,  -- Last manual count
    shadow_stock INTEGER DEFAULT 0,  -- Unrecorded purchases
    expected_stock INTEGER DEFAULT 0,  -- What we think it should be
    in_transit_quantity INTEGER DEFAULT 0,
    
    -- Thresholds & Configuration
    threshold_min INTEGER NOT NULL DEFAULT 3,
    validation_max INTEGER,  -- Fat-finger guard (e.g., 240 bottles = flag)
    buffer_window_minutes INTEGER,  -- Override restaurant default if needed
    
    -- State Management
    inventory_state VARCHAR(50) DEFAULT 'LIVE',  -- 'PENDING_APPROVAL', 'LIVE', 'IN_TRANSIT', 'SHADOW', 'RESERVED', 'OUT_OF_STOCK'
    
    -- Alerting
    last_alerted_at TIMESTAMPTZ,
    last_alert_level INTEGER,  -- Stock level when last alert sent
    alert_count INTEGER DEFAULT 0,
    
    -- Manual Edits
    last_manual_edit_at TIMESTAMPTZ,
    last_manual_edit_by UUID,  -- References auth.users
    manual_edit_reason TEXT,
    
    -- Pricing
    custom_price DECIMAL(10,2),  -- Restaurant-specific price (can differ from master)
    last_purchase_price DECIMAL(10,2),
    negotiated_price DECIMAL(10,2),
    margin_percentage DECIMAL(5,2),
    
    -- Sales Intelligence
    sales_velocity_30d DECIMAL(8,2),  -- Bottles per day (last 30 days)
    sales_velocity_7d DECIMAL(8,2),   -- Bottles per day (last 7 days)
    last_sold_at TIMESTAMPTZ,
    times_ordered_count INTEGER DEFAULT 0,
    total_revenue DECIMAL(12,2) DEFAULT 0,
    
    -- Delivery Tracking
    expected_delivery_date DATE,
    last_delivery_date DATE,
    
    -- Menu Integration
    is_active BOOLEAN DEFAULT true,  -- On menu or not
    menu_section VARCHAR(100),  -- 'By the Glass', 'Reserve List', etc.
    menu_position INTEGER,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    
    -- Constraints
    UNIQUE(restaurant_id, master_wine_id)
);

-- Indexes for restaurant_inventory
CREATE INDEX idx_restaurant_inventory_restaurant ON restaurant_inventory(restaurant_id);
CREATE INDEX idx_restaurant_inventory_wine ON restaurant_inventory(master_wine_id);
CREATE INDEX idx_restaurant_inventory_provider ON restaurant_inventory(provider_id);
CREATE INDEX idx_restaurant_inventory_state ON restaurant_inventory(inventory_state);
CREATE INDEX idx_restaurant_inventory_low_stock ON restaurant_inventory(restaurant_id, stock_live) WHERE stock_live < threshold_min AND is_active = true;
CREATE INDEX idx_restaurant_inventory_active ON restaurant_inventory(restaurant_id, is_active) WHERE is_active = true;

-- ============================================================================
-- 4. PROVIDERS (Supplier Database)
-- ============================================================================

CREATE TABLE providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Basic Info
    name VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    
    -- Contact Information
    primary_contact JSONB NOT NULL,  -- {email, phone, whatsapp, preferred_method}
    alternative_contacts JSONB[],  -- Array of contact objects
    
    -- Address
    address JSONB,  -- street, city, state, zip, country
    
    -- Business Details
    specialties TEXT[],  -- ['Bordeaux', 'Burgundy', 'Italian']
    regions_covered TEXT[],
    minimum_order INTEGER,  -- Minimum bottles
    lead_time_days INTEGER DEFAULT 7,
    
    -- Important Dates (AI-detected)
    important_dates JSONB,  -- {birthday, holidays, unavailable_periods, last_contact}
    
    -- AI Learning & Patterns
    conversation_history JSONB[],  -- Array of conversation summaries
    response_pattern JSONB,  -- {avg_response_time_hours, preferred_contact_time, communication_style}
    personality_notes TEXT,  -- AI-detected personality traits
    
    -- Performance Metrics
    reliability_score DECIMAL(3,2) DEFAULT 5.0,  -- 1.0 to 5.0
    avg_response_time_hours DECIMAL(6,2),
    on_time_delivery_rate DECIMAL(5,2),  -- Percentage
    price_consistency_score DECIMAL(3,2),  -- How often prices match quotes
    total_orders_count INTEGER DEFAULT 0,
    
    -- Price History
    price_deviation_history JSONB[],  -- Track price changes over time
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    tier VARCHAR(50),  -- 'primary', 'alternative', 'backup'
    
    -- Metadata
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_providers_name ON providers(name);
CREATE INDEX idx_providers_tier ON providers(tier);
CREATE INDEX idx_providers_active ON providers(is_active) WHERE is_active = true;

-- Add deferred FK constraint now that providers table exists
ALTER TABLE restaurant_inventory
ADD CONSTRAINT restaurant_inventory_provider_id_fkey
FOREIGN KEY (provider_id) REFERENCES providers(id);

-- ============================================================================
-- 5. RESTAURANT_PROVIDERS (Link Table: Restaurant ↔ Provider)
-- ============================================================================

CREATE TABLE restaurant_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    
    -- Relationship Details
    tier VARCHAR(50) NOT NULL,  -- 'primary', 'alternative'
    wine_categories TEXT[],  -- Which wine types this provider handles for this restaurant
    
    -- Custom Configuration
    custom_lead_time_days INTEGER,  -- Override provider default
    custom_minimum_order INTEGER,
    
    -- Performance (Restaurant-specific)
    orders_placed INTEGER DEFAULT 0,
    last_order_date DATE,
    total_spent DECIMAL(12,2) DEFAULT 0,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(restaurant_id, provider_id)
);

CREATE INDEX idx_restaurant_providers_restaurant ON restaurant_providers(restaurant_id);
CREATE INDEX idx_restaurant_providers_provider ON restaurant_providers(provider_id);
CREATE INDEX idx_restaurant_providers_tier ON restaurant_providers(tier);

-- ============================================================================
-- 6. SALES_EVENTS (POS History)
-- ============================================================================

CREATE TABLE sales_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Source
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID NOT NULL REFERENCES restaurant_inventory(id),
    
    -- Event Details
    event_type VARCHAR(50) NOT NULL,  -- 'sale', 'void', 'refund', 'comp', 'waste'
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    
    -- POS Data
    pos_order_id VARCHAR(100),  -- Toast order ID
    pos_check_id VARCHAR(100),
    pos_item_id VARCHAR(100),
    pos_event_timestamp TIMESTAMPTZ NOT NULL,
    pos_raw_data JSONB,  -- Full Toast webhook payload
    
    -- Time Analysis
    day_of_week INTEGER,  -- 0-6 (Monday-Sunday)
    hour_of_day INTEGER,  -- 0-23
    is_weekend BOOLEAN,
    time_window VARCHAR(50),  -- 'lunch', 'dinner', 'late_night'
    
    -- Stock Impact
    stock_before INTEGER,
    stock_after INTEGER,
    
    -- Server/Staff Info (if available from POS)
    server_name VARCHAR(100),
    server_id VARCHAR(100),
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- Indexes for sales_events
CREATE INDEX idx_sales_events_restaurant ON sales_events(restaurant_id);
CREATE INDEX idx_sales_events_inventory ON sales_events(inventory_id);
CREATE INDEX idx_sales_events_timestamp ON sales_events(pos_event_timestamp DESC);
CREATE INDEX idx_sales_events_event_type ON sales_events(event_type);
CREATE INDEX idx_sales_events_time_analysis ON sales_events(restaurant_id, day_of_week, hour_of_day);

-- ============================================================================
-- 7. PROCUREMENT_ORDERS (Order History)
-- ============================================================================

CREATE TABLE procurement_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number VARCHAR(50) UNIQUE NOT NULL,  -- 'ORD-2026-001'
    
    -- Links
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID NOT NULL REFERENCES restaurant_inventory(id),
    provider_id UUID NOT NULL REFERENCES providers(id),
    
    -- Order Details
    quantity INTEGER NOT NULL,
    unit_type VARCHAR(20) DEFAULT 'bottles',  -- 'bottles', 'cases'
    bottles_total INTEGER NOT NULL,  -- Total bottles (quantity * conversion)
    
    -- Pricing
    quoted_price DECIMAL(10,2),
    negotiated_price DECIMAL(10,2),
    final_price DECIMAL(10,2) NOT NULL,
    total_cost DECIMAL(10,2) NOT NULL,
    
    -- Status Tracking
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',  
    -- 'PENDING', 'APPROVAL_NEEDED', 'APPROVED', 'CONFIRMED', 'IN_TRANSIT', 
    -- 'DELIVERED', 'COMPLETED', 'CANCELLED', 'FAILED'
    
    -- Timeline
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    approved_by UUID,  -- References auth.users
    confirmed_at TIMESTAMPTZ,
    shipped_at TIMESTAMPTZ,
    expected_delivery_date DATE,
    delivered_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Delivery Details
    tracking_number VARCHAR(100),
    delivery_notes TEXT,
    received_by UUID,  -- References auth.users
    
    -- Verification
    quantity_received INTEGER,
    price_verified BOOLEAN DEFAULT false,
    invoice_image_url TEXT,
    discrepancy_notes TEXT,
    
    -- Manager Actions
    manager_notes TEXT,
    rejection_reason TEXT,
    
    -- Emergency Flag
    is_emergency BOOLEAN DEFAULT false,
    priority_level INTEGER DEFAULT 5,  -- 1-10 (10 = highest)
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_procurement_orders_restaurant ON procurement_orders(restaurant_id);
CREATE INDEX idx_procurement_orders_provider ON procurement_orders(provider_id);
CREATE INDEX idx_procurement_orders_status ON procurement_orders(status);
CREATE INDEX idx_procurement_orders_expected_delivery ON procurement_orders(expected_delivery_date) WHERE status = 'IN_TRANSIT';

-- ============================================================================
-- 8. PROCUREMENT_CONVERSATIONS (AI Negotiation Logs)
-- ============================================================================

CREATE TABLE procurement_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Links
    order_id UUID REFERENCES procurement_orders(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES providers(id),
    
    -- Message Details
    direction VARCHAR(20) NOT NULL,  -- 'outbound', 'inbound'
    channel VARCHAR(50) NOT NULL,  -- 'sms', 'email', 'whatsapp', 'voice'
    
    -- Content
    message_text TEXT NOT NULL,
    ai_generated BOOLEAN DEFAULT false,
    llm_model VARCHAR(50),  -- 'gemini-pro', 'gpt-4', etc.
    
    -- AI Analysis
    detected_intent VARCHAR(100),  -- 'price_quote', 'availability_check', 'order_confirmation'
    detected_sentiment VARCHAR(50),  -- 'positive', 'neutral', 'negative'
    important_dates_detected JSONB,  -- Any dates mentioned
    
    -- Metadata
    sent_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ,
    delivery_status VARCHAR(50),  -- 'sent', 'delivered', 'read', 'failed'
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_procurement_conversations_order ON procurement_conversations(order_id);
CREATE INDEX idx_procurement_conversations_provider ON procurement_conversations(provider_id);
CREATE INDEX idx_procurement_conversations_created ON procurement_conversations(created_at DESC);

-- ============================================================================
-- 9. CALENDAR_EVENTS (Important Dates)
-- ============================================================================

CREATE TABLE calendar_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Links
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id),  -- NULL for non-provider events
    order_id UUID REFERENCES procurement_orders(id),  -- NULL for non-order events
    
    -- Event Details
    title VARCHAR(255) NOT NULL,
    description TEXT,
    event_type VARCHAR(100) NOT NULL,  
    -- 'provider_birthday', 'holiday', 'delivery_eta', 'provider_unavailable', 
    -- 'inventory_count', 'manual', 'high_volume_expected'
    
    -- Timing
    event_date DATE NOT NULL,
    event_date_end DATE,  -- For multi-day events
    all_day BOOLEAN DEFAULT true,
    event_time TIME,
    
    -- Source
    source VARCHAR(50) NOT NULL,  -- 'ai_detected', 'manual', 'system_generated'
    ai_confidence DECIMAL(3,2),  -- 0.00 to 1.00 for AI-detected events
    detected_from_conversation_id UUID,  -- If AI detected from conversation
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'approved', 'dismissed'
    
    -- Reminders
    reminder_enabled BOOLEAN DEFAULT true,
    reminder_days_before INTEGER DEFAULT 1,
    reminder_sent BOOLEAN DEFAULT false,
    reminder_sent_at TIMESTAMPTZ,
    
    -- Metadata
    created_by UUID,  -- NULL for AI-generated
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_calendar_events_restaurant ON calendar_events(restaurant_id);
CREATE INDEX idx_calendar_events_provider ON calendar_events(provider_id);
CREATE INDEX idx_calendar_events_date ON calendar_events(event_date);
CREATE INDEX idx_calendar_events_type ON calendar_events(event_type);
-- NOTE: index predicates must be IMMUTABLE; CURRENT_DATE is not allowed in a partial index predicate.
-- Keep your query filter `event_date >= CURRENT_DATE`, and use this partial index to speed up approved lookups.
CREATE INDEX idx_calendar_events_approved_by_date ON calendar_events(restaurant_id, event_date) WHERE status = 'approved';

-- ============================================================================
-- 10. MANAGER_REPORT_PROFILES (Report Configuration)
-- ============================================================================

CREATE TABLE manager_report_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    manager_id UUID NOT NULL,  -- References auth.users
    
    -- Cadence
    daily_enabled BOOLEAN DEFAULT true,
    weekly_enabled BOOLEAN DEFAULT true,
    monthly_enabled BOOLEAN DEFAULT true,
    
    -- Time Windows (for time-based analysis)
    time_windows_enabled BOOLEAN DEFAULT false,
    time_windows JSONB,  -- [{start: "12:00", end: "16:00", label: "Lunch"}, ...]
    
    -- Report Contents
    daily_contents TEXT[],  -- ['stock_changes', 'live_inventory_snapshot', 'low_stock_alerts']
    weekly_contents TEXT[],
    monthly_contents TEXT[],
    
    -- Intelligence Modules
    wine_ai_agent_enabled BOOLEAN DEFAULT false,
    sommelier_ai_enabled BOOLEAN DEFAULT false,
    predictive_analytics_enabled BOOLEAN DEFAULT false,
    
    -- Delivery Channels
    delivery_channels TEXT[] DEFAULT ARRAY['email', 'dashboard'],  -- 'email', 'dashboard', 'sms'
    
    -- Custom Report Files
    custom_reports_enabled BOOLEAN DEFAULT false,
    allowed_formats TEXT[] DEFAULT ARRAY['pdf', 'excel'],
    trigger_mode VARCHAR(50) DEFAULT 'scheduled',  -- 'scheduled', 'on_demand', 'both'
    
    -- Email Settings
    email_address VARCHAR(255),
    email_cc TEXT[],
    
    -- Preferences
    timezone VARCHAR(50) DEFAULT 'America/Los_Angeles',
    preferred_language VARCHAR(10) DEFAULT 'en',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(restaurant_id, manager_id)
);

CREATE INDEX idx_manager_report_profiles_restaurant ON manager_report_profiles(restaurant_id);
CREATE INDEX idx_manager_report_profiles_manager ON manager_report_profiles(manager_id);

-- ============================================================================
-- 11. GENERATED_REPORTS (Report History)
-- ============================================================================

CREATE TABLE generated_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    profile_id UUID REFERENCES manager_report_profiles(id),
    
    -- Report Details
    report_type VARCHAR(50) NOT NULL,  -- 'daily', 'weekly', 'monthly', 'custom'
    report_period_start DATE NOT NULL,
    report_period_end DATE NOT NULL,
    
    -- Content
    title VARCHAR(255) NOT NULL,
    summary TEXT,
    modules_included TEXT[],
    
    -- Files
    pdf_url TEXT,
    excel_url TEXT,
    csv_url TEXT,
    
    -- Data
    report_data JSONB,  -- Full report data structure
    
    -- AI Insights (if enabled)
    ai_insights TEXT,
    ai_model VARCHAR(50),
    
    -- Status
    status VARCHAR(50) DEFAULT 'completed',  -- 'generating', 'completed', 'failed'
    generation_time_ms INTEGER,
    
    -- Delivery
    delivered_at TIMESTAMPTZ,
    delivery_status JSONB,  -- {email: 'sent', dashboard: 'available'}
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_generated_reports_restaurant ON generated_reports(restaurant_id);
CREATE INDEX idx_generated_reports_type ON generated_reports(report_type);
CREATE INDEX idx_generated_reports_period ON generated_reports(report_period_start, report_period_end);
CREATE INDEX idx_generated_reports_created ON generated_reports(created_at DESC);

-- ============================================================================
-- 12. AGENT_ACTIVITY_LOGS (Agent Performance Tracking)
-- ============================================================================

CREATE TABLE agent_activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Agent Info
    agent_name VARCHAR(100) NOT NULL,  -- 'buffer_manager', 'procurement_agent', etc.
    agent_action VARCHAR(100) NOT NULL,  -- 'evaluate_buffer', 'send_order_request', etc.
    
    -- Context
    restaurant_id UUID REFERENCES restaurants(id),
    related_entity_type VARCHAR(50),  -- 'inventory', 'order', 'provider'
    related_entity_id UUID,
    
    -- Performance Metrics
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    
    -- Status
    status VARCHAR(50) NOT NULL,  -- 'success', 'failed', 'partial'
    error_message TEXT,
    error_stack TEXT,
    
    -- AI Model Info (if applicable)
    llm_model VARCHAR(50),
    tokens_used INTEGER,
    llm_cost_usd DECIMAL(10,6),
    
    -- Input/Output (for debugging)
    input_data JSONB,
    output_data JSONB,
    
    -- Self-Improvement Data
    edge_case_detected BOOLEAN DEFAULT false,
    edge_case_type VARCHAR(100),
    improvement_suggestion TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_activity_logs_agent ON agent_activity_logs(agent_name);
CREATE INDEX idx_agent_activity_logs_restaurant ON agent_activity_logs(restaurant_id);
CREATE INDEX idx_agent_activity_logs_created ON agent_activity_logs(created_at DESC);
CREATE INDEX idx_agent_activity_logs_status ON agent_activity_logs(status);
CREATE INDEX idx_agent_activity_logs_edge_cases ON agent_activity_logs(edge_case_detected) WHERE edge_case_detected = true;

-- ============================================================================
-- 13. NOTIFICATIONS (Notification History)
-- ============================================================================

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL,  -- References auth.users (manager)
    
    -- Notification Details
    notification_type VARCHAR(100) NOT NULL,  
    -- 'low_stock_alert', 'order_approval_needed', 'delivery_eta', 
    -- 'inequality_detected', 'price_deviation', 'provider_unavailable'
    
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    
    -- Priority
    priority VARCHAR(50) DEFAULT 'normal',  -- 'low', 'normal', 'high', 'urgent'
    
    -- Channels
    channels TEXT[] NOT NULL,  -- ['sms', 'email', 'push']
    
    -- Delivery Status
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    delivery_status JSONB,  -- {sms: 'delivered', email: 'sent', push: 'failed'}
    
    -- Action Buttons (for one-tap approvals)
    actions JSONB,  -- [{label: "Approve", action: "approve_order", order_id: "..."}]
    
    -- Response
    responded_at TIMESTAMPTZ,
    response_action VARCHAR(100),
    response_data JSONB,
    
    -- Links
    related_entity_type VARCHAR(50),
    related_entity_id UUID,
    
    -- Grouping (to prevent spam)
    notification_group VARCHAR(100),  -- Group related notifications
    batch_id UUID,  -- If sent in batch
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_restaurant ON notifications(restaurant_id);
CREATE INDEX idx_notifications_recipient ON notifications(recipient_id);
CREATE INDEX idx_notifications_type ON notifications(notification_type);
CREATE INDEX idx_notifications_unread ON notifications(recipient_id, read_at) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);

-- ============================================================================
-- 14. SYSTEM_AUDIT_LOG (Complete Audit Trail)
-- ============================================================================

CREATE TABLE system_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Actor
    actor_type VARCHAR(50) NOT NULL,  -- 'user', 'agent', 'system'
    actor_id UUID,  -- User ID or agent name
    
    -- Action
    action VARCHAR(100) NOT NULL,  
    -- 'inventory_updated', 'order_placed', 'price_changed', 'manual_adjustment'
    entity_type VARCHAR(50) NOT NULL,  -- 'inventory', 'order', 'provider', 'report'
    entity_id UUID,
    
    -- Changes
    changes JSONB,  -- {field: {old: value, new: value}}
    
    -- Context
    restaurant_id UUID REFERENCES restaurants(id),
    ip_address INET,
    user_agent TEXT,
    
    -- Reason (for manual actions)
    reason TEXT,
    
    -- Security
    is_suspicious BOOLEAN DEFAULT false,
    flagged_reason TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_system_audit_log_actor ON system_audit_log(actor_id);
CREATE INDEX idx_system_audit_log_entity ON system_audit_log(entity_type, entity_id);
CREATE INDEX idx_system_audit_log_restaurant ON system_audit_log(restaurant_id);
CREATE INDEX idx_system_audit_log_created ON system_audit_log(created_at DESC);
CREATE INDEX idx_system_audit_log_suspicious ON system_audit_log(is_suspicious) WHERE is_suspicious = true;

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- View: Active Inventory with Wine Details
CREATE VIEW v_active_inventory AS
SELECT 
    ri.*,
    mw.name as wine_name,
    mw.producer,
    mw.vintage,
    mw.primary_type,
    mw.region,
    p.name as provider_name,
    p.primary_contact as provider_contact
FROM restaurant_inventory ri
JOIN master_wine_library mw ON ri.master_wine_id = mw.id
LEFT JOIN providers p ON ri.provider_id = p.id
WHERE ri.deleted_at IS NULL AND ri.is_active = true;

-- View: Low Stock Items
CREATE VIEW v_low_stock_items AS
SELECT 
    ri.*,
    mw.name as wine_name,
    mw.producer,
    mw.vintage,
    r.name as restaurant_name
FROM restaurant_inventory ri
JOIN master_wine_library mw ON ri.master_wine_id = mw.id
JOIN restaurants r ON ri.restaurant_id = r.id
WHERE ri.stock_live < ri.threshold_min 
  AND ri.is_active = true 
  AND ri.deleted_at IS NULL
  AND ri.inventory_state NOT IN ('IN_TRANSIT');

-- View: Sales Summary (Last 30 Days)
CREATE VIEW v_sales_summary_30d AS
SELECT 
    se.restaurant_id,
    se.inventory_id,
    mw.name as wine_name,
    COUNT(*) as total_sales_count,
    SUM(se.quantity) as total_bottles_sold,
    SUM(se.total_price) as total_revenue,
    AVG(se.unit_price) as avg_price_per_bottle,
    MIN(se.pos_event_timestamp) as first_sale,
    MAX(se.pos_event_timestamp) as last_sale
FROM sales_events se
JOIN restaurant_inventory ri ON se.inventory_id = ri.id
JOIN master_wine_library mw ON ri.master_wine_id = mw.id
WHERE se.pos_event_timestamp >= NOW() - INTERVAL '30 days'
  AND se.event_type = 'sale'
GROUP BY se.restaurant_id, se.inventory_id, mw.name;

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- Function: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
CREATE TRIGGER update_master_wine_library_updated_at BEFORE UPDATE ON master_wine_library FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_restaurants_updated_at BEFORE UPDATE ON restaurants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_restaurant_inventory_updated_at BEFORE UPDATE ON restaurant_inventory FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_providers_updated_at BEFORE UPDATE ON providers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_restaurant_providers_updated_at BEFORE UPDATE ON restaurant_providers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_procurement_orders_updated_at BEFORE UPDATE ON procurement_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_calendar_events_updated_at BEFORE UPDATE ON calendar_events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_manager_report_profiles_updated_at BEFORE UPDATE ON manager_report_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function: Calculate sales velocity (called by scheduler)
CREATE OR REPLACE FUNCTION calculate_sales_velocity()
RETURNS void AS $$
BEGIN
    UPDATE restaurant_inventory ri
    SET 
        sales_velocity_30d = (
            SELECT COALESCE(SUM(se.quantity) / 30.0, 0)
            FROM sales_events se
            WHERE se.inventory_id = ri.id
            AND se.event_type = 'sale'
            AND se.pos_event_timestamp >= NOW() - INTERVAL '30 days'
        ),
        sales_velocity_7d = (
            SELECT COALESCE(SUM(se.quantity) / 7.0, 0)
            FROM sales_events se
            WHERE se.inventory_id = ri.id
            AND se.event_type = 'sale'
            AND se.pos_event_timestamp >= NOW() - INTERVAL '7 days'
        ),
        last_sold_at = (
            SELECT MAX(se.pos_event_timestamp)
            FROM sales_events se
            WHERE se.inventory_id = ri.id
            AND se.event_type = 'sale'
        );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Minimal access mapping table used by RLS policies below
-- (Adjust/replace this based on your final auth/roles model.)
CREATE TABLE IF NOT EXISTS user_restaurant_access (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,  -- References auth.users
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'manager',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, restaurant_id)
);

CREATE INDEX IF NOT EXISTS idx_user_restaurant_access_user ON user_restaurant_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_restaurant_access_restaurant ON user_restaurant_access(restaurant_id);

-- Enable RLS on all tables
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Example RLS Policy: Managers can only access their restaurant's data
CREATE POLICY "Managers can view their restaurant data"
ON restaurant_inventory FOR SELECT
USING (
    restaurant_id IN (
        SELECT restaurant_id FROM user_restaurant_access
        WHERE user_id = auth.uid()
    )
);

-- Note: Full RLS policies to be defined based on auth schema

-- ============================================================================
-- 15. MESSAGE_TEMPLATES (Provider Communication)
-- ============================================================================

CREATE TABLE message_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- NULL means "global default template" shared across restaurants
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    
    -- Template Info
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL,  -- 'order', 'inquiry', 'confirmation', 'followup'
    description TEXT,
    
    -- Template Content
    template_text TEXT NOT NULL,
    variables TEXT[],  -- ['provider_name', 'wine_name', 'quantity', 'last_price']
    
    -- Version Control
    version INTEGER DEFAULT 1,
    parent_template_id UUID REFERENCES message_templates(id),  -- For versioning
    change_notes TEXT,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false,  -- System default templates
    
    -- Usage Tracking
    times_used INTEGER DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    
    -- Metadata
    created_by UUID,  -- References auth.users
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_message_templates_restaurant ON message_templates(restaurant_id);
CREATE INDEX idx_message_templates_category ON message_templates(category);
CREATE INDEX idx_message_templates_active ON message_templates(is_active) WHERE is_active = true;

-- ============================================================================
-- 16. VINTAGE_SUBSTITUTION_RULES
-- ============================================================================

CREATE TABLE vintage_substitution_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    master_wine_id UUID NOT NULL REFERENCES master_wine_library(id),
    
    -- Primary Vintage
    primary_vintage INTEGER NOT NULL,
    
    -- Acceptable Substitutions
    acceptable_vintages INTEGER[],  -- [2019, 2021]
    
    -- Price Adjustment Rules
    price_adjustment_rules JSONB,
    -- {
    --   "older_vintage": {"+10": "percent"},
    --   "newer_vintage": {"-5": "percent"},
    --   "specific_rules": {"2019": "+15"}
    -- }
    
    -- Approval Settings
    auto_approve BOOLEAN DEFAULT false,
    max_auto_approve_price_diff DECIMAL(10,2),
    
    -- Notes
    notes TEXT,
    reason_for_rule TEXT,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(restaurant_id, master_wine_id, primary_vintage)
);

CREATE INDEX idx_vintage_rules_restaurant ON vintage_substitution_rules(restaurant_id);
CREATE INDEX idx_vintage_rules_wine ON vintage_substitution_rules(master_wine_id);
CREATE INDEX idx_vintage_rules_active ON vintage_substitution_rules(is_active) WHERE is_active = true;

-- ============================================================================
-- 17. NOTIFICATION_PREFERENCES
-- ============================================================================

CREATE TABLE notification_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,  -- References auth.users (manager)
    
    -- Low Stock Alerts
    low_stock_enabled BOOLEAN DEFAULT true,
    low_stock_channels TEXT[] DEFAULT ARRAY['sms', 'push'],
    low_stock_threshold_override INTEGER,
    
    -- Order Approvals
    order_approval_enabled BOOLEAN DEFAULT true,
    order_approval_channels TEXT[] DEFAULT ARRAY['sms', 'push', 'email'],
    
    -- Delivery Notifications
    delivery_enabled BOOLEAN DEFAULT true,
    delivery_channels TEXT[] DEFAULT ARRAY['push', 'email'],
    
    -- Financial Reports
    financial_reports_enabled BOOLEAN DEFAULT true,
    financial_reports_channels TEXT[] DEFAULT ARRAY['email', 'dashboard'],
    
    -- Inequality Alerts
    inequality_alerts_enabled BOOLEAN DEFAULT true,
    inequality_alerts_channels TEXT[] DEFAULT ARRAY['sms', 'push'],
    
    -- Calendar Reminders
    calendar_reminders_enabled BOOLEAN DEFAULT true,
    calendar_reminders_channels TEXT[] DEFAULT ARRAY['push', 'email'],
    
    -- Quiet Hours
    quiet_hours_enabled BOOLEAN DEFAULT false,
    quiet_hours_start VARCHAR(5),  -- "22:00"
    quiet_hours_end VARCHAR(5),    -- "07:00"
    quiet_hours_emergency_override BOOLEAN DEFAULT true,
    
    -- Alert Grouping
    alert_grouping_enabled BOOLEAN DEFAULT true,
    alert_grouping_window_minutes INTEGER DEFAULT 15,
    
    -- Digest Settings
    daily_digest_enabled BOOLEAN DEFAULT true,
    daily_digest_time VARCHAR(5) DEFAULT '08:00',
    weekly_digest_enabled BOOLEAN DEFAULT true,
    weekly_digest_day INTEGER DEFAULT 1,  -- Monday
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(restaurant_id, user_id)
);

CREATE INDEX idx_notification_prefs_restaurant ON notification_preferences(restaurant_id);
CREATE INDEX idx_notification_prefs_user ON notification_preferences(user_id);

-- ============================================================================
-- 18. BUDGET_TRACKING
-- ============================================================================

CREATE TABLE budgets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    
    -- Period
    period_type VARCHAR(50) NOT NULL,  -- 'monthly', 'quarterly', 'yearly'
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- Overall Budget
    total_budget DECIMAL(12,2) NOT NULL,
    total_spent DECIMAL(12,2) DEFAULT 0,
    
    -- Category Budgets
    category_budgets JSONB,
    -- {
    --   "red": {"budget": 5000, "spent": 4200},
    --   "white": {"budget": 3000, "spent": 2800},
    --   "sparkling": {"budget": 2000, "spent": 1450}
    -- }
    
    -- Alerts
    alert_at_percentage INTEGER DEFAULT 75,  -- Alert at 75% spent
    alerted_at_75 BOOLEAN DEFAULT false,
    alerted_at_90 BOOLEAN DEFAULT false,
    alerted_at_100 BOOLEAN DEFAULT false,
    
    -- Forecasting
    projected_spend DECIMAL(12,2),
    projection_confidence DECIMAL(3,2),
    last_projection_date DATE,
    
    -- Status
    status VARCHAR(50) DEFAULT 'active',  -- 'active', 'exceeded', 'closed'
    
    -- Notes
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_budgets_restaurant ON budgets(restaurant_id);
CREATE INDEX idx_budgets_period ON budgets(period_start, period_end);
CREATE INDEX idx_budgets_active ON budgets(status) WHERE status = 'active';

-- ============================================================================
-- 19. STORAGE_LOCATIONS
-- ============================================================================

CREATE TABLE storage_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    
    -- Location Hierarchy
    zone VARCHAR(100),         -- 'Cellar A', 'Main Bar', 'Reserve Room'
    section VARCHAR(100),      -- 'North Wall', 'South Wall'
    shelf VARCHAR(50),         -- '1', '2', '3'
    position VARCHAR(50),      -- 'A', 'B', 'C'
    
    -- Full Location String (auto-generated)
    full_location VARCHAR(255) GENERATED ALWAYS AS 
        (CONCAT_WS(' > ', zone, section, 'Shelf ' || shelf, 'Pos ' || position)) STORED,
    
    -- Capacity
    capacity_bottles INTEGER NOT NULL,
    current_occupancy INTEGER DEFAULT 0,
    
    -- Environmental
    temperature_zone VARCHAR(50),  -- 'cool', 'cellar', 'room_temp'
    temperature_min DECIMAL(5,2),  -- 50°F
    temperature_max DECIMAL(5,2),  -- 65°F
    humidity_controlled BOOLEAN DEFAULT false,
    
    -- Access
    requires_special_access BOOLEAN DEFAULT false,
    access_notes TEXT,
    
    -- Display
    display_order INTEGER,  -- For sorting in UI
    color_code VARCHAR(7),  -- Hex color for map visualization
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    -- Notes
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_storage_locations_restaurant ON storage_locations(restaurant_id);
CREATE INDEX idx_storage_locations_zone ON storage_locations(zone);
CREATE INDEX idx_storage_locations_active ON storage_locations(is_active) WHERE is_active = true;

-- Add storage location to inventory
ALTER TABLE restaurant_inventory 
ADD COLUMN IF NOT EXISTS storage_location_id UUID REFERENCES storage_locations(id);

CREATE INDEX idx_restaurant_inventory_storage_location ON restaurant_inventory(storage_location_id);

-- ============================================================================
-- 20. BATCH_OPERATIONS (Track bulk operations)
-- ============================================================================

CREATE TABLE batch_operations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    
    -- Operation Details
    operation_type VARCHAR(100) NOT NULL,  -- 'bulk_adjust', 'bulk_reorder', 'bulk_price_update'
    operation_description TEXT,
    
    -- Items Affected
    items_count INTEGER NOT NULL,
    items_affected JSONB,  -- Array of inventory_ids or wine_ids
    
    -- Operation Data
    operation_data JSONB,
    -- For bulk_adjust: {"adjustment": 12, "reason": "manual purchase"}
    -- For bulk_reorder: {"provider_id": "...", "items": [...]}
    -- For bulk_price_update: {"margin_change_percent": 10, "category": "red"}
    
    -- Preview vs Applied
    is_preview BOOLEAN DEFAULT true,
    applied_at TIMESTAMPTZ,
    
    -- Results
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    results JSONB,  -- Detailed results per item
    
    -- Approval
    requires_approval BOOLEAN DEFAULT true,
    approved_by UUID,  -- References auth.users
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    
    -- Rollback
    can_rollback BOOLEAN DEFAULT false,
    rollback_data JSONB,
    rolled_back_at TIMESTAMPTZ,
    
    -- Metadata
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_batch_operations_restaurant ON batch_operations(restaurant_id);
CREATE INDEX idx_batch_operations_type ON batch_operations(operation_type);
CREATE INDEX idx_batch_operations_created ON batch_operations(created_at DESC);

-- ============================================================================
-- 21. EXPORT_HISTORY (Track data exports for audit)
-- ============================================================================

CREATE TABLE export_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,  -- References auth.users
    
    -- Export Details
    export_type VARCHAR(100) NOT NULL,  -- 'inventory', 'sales', 'financial', 'audit'
    export_format VARCHAR(50) NOT NULL,  -- 'csv', 'pdf', 'excel', 'sheets', 'drive'
    
    -- Filters Applied
    filters_applied JSONB,
    -- {
    --   "date_range": {"start": "2026-01-01", "end": "2026-01-31"},
    --   "categories": ["red", "white"],
    --   "min_price": 50
    -- }
    
    -- File Info
    file_url TEXT,
    file_size_bytes BIGINT,
    row_count INTEGER,
    
    -- Delivery
    destination VARCHAR(100),  -- 'download', 'email', 'google_drive', 'google_sheets'
    destination_details JSONB,
    
    -- Security
    is_watermarked BOOLEAN DEFAULT false,
    watermark_text VARCHAR(255),
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'processing', 'completed', 'failed'
    error_message TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_export_history_restaurant ON export_history(restaurant_id);
CREATE INDEX idx_export_history_user ON export_history(user_id);
CREATE INDEX idx_export_history_created ON export_history(created_at DESC);

-- ============================================================================
-- 22. KEYBOARD_SHORTCUTS (User customizable shortcuts)
-- ============================================================================

CREATE TABLE keyboard_shortcuts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    user_id UUID NOT NULL,  -- References auth.users
    
    -- Shortcut Mapping
    action VARCHAR(100) NOT NULL,  -- 'open_inventory', 'new_order', 'search'
    key_combination VARCHAR(50) NOT NULL,  -- 'Ctrl+I', 'Cmd+N', 'Ctrl+F'
    
    -- Defaults
    is_custom BOOLEAN DEFAULT false,
    default_combination VARCHAR(50),  -- Original default
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, action)
);

CREATE INDEX idx_keyboard_shortcuts_user ON keyboard_shortcuts(user_id);

-- ============================================================================
-- 23. PROVIDER_PERFORMANCE_METRICS (Calculated metrics)
-- ============================================================================

CREATE TABLE provider_performance_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    restaurant_id UUID REFERENCES restaurants(id),  -- NULL for global metrics
    
    -- Time Period
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- Delivery Metrics
    total_orders INTEGER DEFAULT 0,
    on_time_deliveries INTEGER DEFAULT 0,
    late_deliveries INTEGER DEFAULT 0,
    on_time_percentage DECIMAL(5,2),
    avg_delivery_delay_days DECIMAL(5,2),
    
    -- Response Metrics
    total_communications INTEGER DEFAULT 0,
    avg_response_time_hours DECIMAL(8,2),
    response_rate DECIMAL(5,2),  -- % of messages responded to
    
    -- Pricing Metrics
    total_quotes INTEGER DEFAULT 0,
    quotes_within_budget INTEGER DEFAULT 0,
    avg_price_deviation_percent DECIMAL(5,2),
    price_consistency_score DECIMAL(3,2),  -- 0.00 to 1.00
    
    -- Quality Metrics
    quality_issues_count INTEGER DEFAULT 0,
    order_fulfillment_rate DECIMAL(5,2),  -- % of orders fulfilled completely
    
    -- Relationship Metrics
    avg_sentiment_score DECIMAL(3,2),  -- From sentiment analysis
    communication_quality_score DECIMAL(3,2),
    
    -- Overall Score
    overall_performance_score DECIMAL(3,2),  -- Weighted average
    reliability_score DECIMAL(3,2),  -- 1.0 to 5.0
    
    -- Calculated
    calculated_at TIMESTAMPTZ DEFAULT NOW(),
    next_calculation_date DATE,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_provider_performance_provider ON provider_performance_metrics(provider_id);
CREATE INDEX idx_provider_performance_restaurant ON provider_performance_metrics(restaurant_id);
CREATE INDEX idx_provider_performance_period ON provider_performance_metrics(period_start, period_end);

-- ============================================================================
-- 24. ANALYTICS_CACHE (Pre-calculated analytics for performance)
-- ============================================================================

CREATE TABLE analytics_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    
    -- Cache Key
    cache_key VARCHAR(255) NOT NULL,  -- 'sales_by_server_2026-01', 'hourly_trends_2026-01-07'
    cache_type VARCHAR(100) NOT NULL,  -- 'sales_by_server', 'time_trends', 'profitability'
    
    -- Time Period
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    
    -- Cached Data
    data JSONB NOT NULL,
    
    -- Metadata
    row_count INTEGER,
    calculation_time_ms INTEGER,
    
    -- Cache Management
    expires_at TIMESTAMPTZ,
    is_stale BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(restaurant_id, cache_key)
);

CREATE INDEX idx_analytics_cache_restaurant ON analytics_cache(restaurant_id);
CREATE INDEX idx_analytics_cache_key ON analytics_cache(cache_key);
CREATE INDEX idx_analytics_cache_expires ON analytics_cache(expires_at);

-- ============================================================================
-- INITIAL DATA SEEDING
-- ============================================================================

-- This will be populated from restaurant_wine_dataset.jsonl via migration script

-- Insert default message templates
INSERT INTO message_templates (id, restaurant_id, name, category, template_text, variables, is_default)
VALUES 
    (uuid_generate_v4(), NULL, 'Standard Order Request', 'order', 
     'Hi {provider_name}, I hope you''re doing well. I''d like to order {quantity} cases of {wine_name} at {last_price} per case. Please confirm availability and delivery timeline.', 
     ARRAY['provider_name', 'quantity', 'wine_name', 'last_price'], 
     true),
    (uuid_generate_v4(), NULL, 'Price Inquiry', 'inquiry', 
     'Hi {provider_name}, could you provide current pricing for {wine_name}? Our last price was {last_price}.', 
     ARRAY['provider_name', 'wine_name', 'last_price'], 
     true),
    (uuid_generate_v4(), NULL, 'Delivery Confirmation', 'confirmation', 
     'Hi {provider_name}, confirming we received the delivery of {quantity} cases of {wine_name}. Everything looks good. Thank you!', 
     ARRAY['provider_name', 'quantity', 'wine_name'], 
     true);

-- ============================================================================
-- MAINTENANCE TASKS (To be scheduled via pg_cron or external scheduler)
-- ============================================================================

-- 1. Calculate sales velocity daily
-- SELECT calculate_sales_velocity();

-- 2. Clean up old agent logs (keep 90 days)
-- DELETE FROM agent_activity_logs WHERE created_at < NOW() - INTERVAL '90 days';

-- 3. Archive old sales events (keep 2 years in hot storage)
-- Move to cold storage after 2 years

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================

-- ============================================================================
-- Enable Real-Time Subscriptions for Key Tables
-- ============================================================================
-- 
-- Real-time allows your frontend to receive instant updates when data changes.
-- Supabase uses PostgreSQL's logical replication (publication/subscription).
--
-- IMPORTANT: In Supabase, you can also enable real-time via:
-- Dashboard: Database → Replication → Toggle tables ON/OFF
--
-- ============================================================================

-- ============================================================================
-- Core Operational Tables (High Priority)
-- ============================================================================
-- These tables change frequently and need live updates in your UI

ALTER PUBLICATION supabase_realtime ADD TABLE restaurant_inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE sales_events;
ALTER PUBLICATION supabase_realtime ADD TABLE procurement_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE calendar_events;

-- ============================================================================
-- Configuration Tables (Medium Priority)
-- ============================================================================
-- Enable if you want live UI updates when restaurants/providers change

ALTER PUBLICATION supabase_realtime ADD TABLE restaurants;
ALTER PUBLICATION supabase_realtime ADD TABLE providers;
ALTER PUBLICATION supabase_realtime ADD TABLE master_wine_library;
ALTER PUBLICATION supabase_realtime ADD TABLE restaurant_providers;

-- ============================================================================
-- Optional: Additional Tables (Enable as needed)
-- ============================================================================

-- Procurement & Conversations
-- ALTER PUBLICATION supabase_realtime ADD TABLE procurement_conversations;

-- Reports & Profiles
-- ALTER PUBLICATION supabase_realtime ADD TABLE generated_reports;
-- ALTER PUBLICATION supabase_realtime ADD TABLE manager_report_profiles;

-- System Tables (usually don't need real-time)
-- ALTER PUBLICATION supabase_realtime ADD TABLE agent_activity_logs;
-- ALTER PUBLICATION supabase_realtime ADD TABLE system_audit_log;

-- ============================================================================
-- VERIFICATION: Check which tables are enabled for real-time
-- ============================================================================

SELECT 
    schemaname,
    tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- ============================================================================
-- HOW TO USE IN YOUR FRONTEND
-- ============================================================================
-- 
-- Example JavaScript/TypeScript:
--
-- import { createClient } from '@supabase/supabase-js'
-- const supabase = createClient(url, key)
--
-- // Listen to inventory changes
-- const channel = supabase
--   .channel('inventory-changes')
--   .on('postgres_changes', 
--     { 
--       event: '*',  // INSERT, UPDATE, DELETE
--       schema: 'public', 
--       table: 'restaurant_inventory',
--       filter: 'restaurant_id=eq.YOUR_RESTAURANT_ID'  // Optional filter
--     },
--     (payload) => {
--       console.log('Change received!', payload)
--       // Update your UI here
--     }
--   )
--   .subscribe()
--
-- // Listen to sales events
-- const salesChannel = supabase
--   .channel('sales-events')
--   .on('postgres_changes',
--     { event: 'INSERT', schema: 'public', table: 'sales_events' },
--     (payload) => {
--       console.log('New sale!', payload.new)
--     }
--   )
--   .subscribe()
--
-- // Clean up when done
-- // supabase.removeChannel(channel)
--
-- ============================================================================
-- TO DISABLE REAL-TIME (if needed)
-- ============================================================================
--
-- ALTER PUBLICATION supabase_realtime DROP TABLE restaurant_inventory;
-- ALTER PUBLICATION supabase_realtime DROP TABLE sales_events;
-- (etc.)
--
-- ============================================================================

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

SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('order_interactions', 'manager_preferences', 'unit_conversions', 'rfq_requests');

-- Check new columns added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'restaurant_inventory' 
AND column_name IN ('is_optional_tracking', 'target_price', 'max_price', 'current_volume_ml', 'unit_type', 'is_generic_bucket', 'velocity_weight', 'sku');

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'procurement_orders' 
AND column_name IN ('state_machine_state', 'is_recurring', 'cron_schedule', 'total_estimated_cost', 'final_confirmed_cost', 'negotiation_attempts', 'last_negotiation_at', 'is_offline_sync');