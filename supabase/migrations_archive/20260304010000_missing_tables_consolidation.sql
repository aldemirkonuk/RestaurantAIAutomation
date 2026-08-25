-- ============================================================================
-- MISSING TABLES CONSOLIDATION
-- ============================================================================
-- Tables referenced by frontend/backend code that existed only in legacy
-- migrations (services/database/migrations/) but NOT in Supabase migrations.
-- ============================================================================

-- 1. Order Items
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id VARCHAR(100) NOT NULL,
    wine_id VARCHAR(50) NOT NULL,
    wine_name VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_type VARCHAR(10) NOT NULL CHECK (unit_type IN ('case', 'bottle')),
    bottles_per_case INTEGER DEFAULT 12,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    bottle_size_ml INTEGER DEFAULT 750,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_wine ON order_items(wine_id);

-- 2. Wine Unit Defaults
CREATE TABLE IF NOT EXISTS wine_unit_defaults (
    wine_id VARCHAR(50) PRIMARY KEY,
    default_unit_type VARCHAR(10) NOT NULL CHECK (default_unit_type IN ('case', 'bottle')),
    bottles_per_case INTEGER DEFAULT 12 CHECK (bottles_per_case > 0),
    notes TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Check Scans
CREATE TABLE IF NOT EXISTS check_scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    scan_date DATE NOT NULL,
    total_amount DECIMAL(10,2),
    wine_sales DECIMAL(10,2),
    wine_cost DECIMAL(10,2),
    profit_margin DECIMAL(5,2),
    extracted_data JSONB,
    file_url TEXT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_check_scans_restaurant ON check_scans(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_check_scans_date ON check_scans(scan_date);

-- 4. Wine Acquisition Details
CREATE TABLE IF NOT EXISTS wine_acquisition_details (
    wine_id VARCHAR(50) PRIMARY KEY,
    acquisition_type VARCHAR(50) DEFAULT 'standard'
        CHECK (acquisition_type IN ('standard', 'auction', 'direct_import', 'special_allocation')),
    auction_details JSONB,
    acquisition_date DATE,
    acquisition_price DECIMAL(10,2),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Provider Conversation Sessions
CREATE TABLE IF NOT EXISTS provider_conversation_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL,
    session_type TEXT NOT NULL CHECK (session_type IN (
        'negotiation', 'general_inquiry', 'promo_discovery', 'price_check',
        'order_followup', 'relationship_building', 'onboarding', 'complaint'
    )),
    status TEXT DEFAULT 'active' CHECK (status IN (
        'active', 'paused_for_approval', 'waiting_response',
        'follow_up_scheduled', 'completed', 'abandoned'
    )),
    initiated_by TEXT NOT NULL,
    intent JSONB DEFAULT '{}',
    context JSONB DEFAULT '{}',
    topic_stack TEXT[] DEFAULT '{}',
    approval_pending BOOLEAN DEFAULT FALSE,
    approval_type TEXT,
    pending_message TEXT,
    messages_count INTEGER DEFAULT 0,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pcs_provider ON provider_conversation_sessions(provider_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pcs_restaurant ON provider_conversation_sessions(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_pcs_status ON provider_conversation_sessions(status) WHERE status IN ('active', 'paused_for_approval');

-- 6. Provider Knowledge
CREATE TABLE IF NOT EXISTS provider_knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
        'company', 'people', 'wine_portfolio', 'promotion', 'pricing',
        'logistics', 'financial', 'relationship', 'compliance'
    )),
    subcategory TEXT,
    label TEXT NOT NULL,
    attributes JSONB NOT NULL DEFAULT '{}',
    confidence FLOAT DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
    source_conversation_id UUID,
    source_message_text TEXT,
    previous_value JSONB,
    verified BOOLEAN DEFAULT FALSE,
    verified_by UUID,
    verified_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pk_provider ON provider_knowledge(provider_id, category);
CREATE INDEX IF NOT EXISTS idx_pk_restaurant ON provider_knowledge(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_pk_verified ON provider_knowledge(verified) WHERE verified = FALSE;

-- 7. Provider Promotions
CREATE TABLE IF NOT EXISTS provider_promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL,
    name TEXT NOT NULL,
    promo_type TEXT NOT NULL CHECK (promo_type IN (
        'volume_discount', 'seasonal', 'bundle', 'loyalty', 'closeout',
        'new_vintage', 'free_shipping', 'sample', 'early_payment', 'referral'
    )),
    description TEXT,
    conditions JSONB DEFAULT '{}',
    discount_value JSONB DEFAULT '{}',
    applicable_wines JSONB DEFAULT '[]',
    applicable_categories TEXT[],
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN DEFAULT TRUE,
    source_conversation_id UUID,
    confidence FLOAT DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pp_provider ON provider_promotions(provider_id);
CREATE INDEX IF NOT EXISTS idx_pp_restaurant ON provider_promotions(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_pp_active ON provider_promotions(is_active, end_date) WHERE is_active = TRUE;

-- 8. Provider Sentiment History
CREATE TABLE IF NOT EXISTS provider_sentiment_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL,
    conversation_id UUID,
    session_id UUID REFERENCES provider_conversation_sessions(id),
    sentiment TEXT NOT NULL CHECK (sentiment IN ('positive', 'neutral', 'negative')),
    sentiment_score FLOAT CHECK (sentiment_score >= -1 AND sentiment_score <= 1),
    detected_emotions TEXT[],
    trigger_context TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_psh_provider ON provider_sentiment_history(provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_psh_restaurant ON provider_sentiment_history(restaurant_id);

-- ============================================================================
-- FIX: Broken indexes from 20260208050000_email_tracking.sql
-- ============================================================================
-- The original migration created indexes on non-existent columns.
-- Drop them if they exist (they likely failed to create), then create correct ones.

DROP INDEX IF EXISTS idx_conversations_restaurant_date;
DROP INDEX IF EXISTS idx_conversations_message_text_search;

-- procurement_conversations doesn't have restaurant_id directly, but we can
-- join via order_id -> procurement_orders.restaurant_id. Instead, index on order_id.
CREATE INDEX IF NOT EXISTS idx_conversations_order_date
    ON procurement_conversations(order_id, created_at DESC);

-- Ensure content column exists before creating text search index
ALTER TABLE procurement_conversations ADD COLUMN IF NOT EXISTS content TEXT;

-- Text search on the actual column name (content, not message_text)
CREATE INDEX IF NOT EXISTS idx_conversations_content_text_search
    ON procurement_conversations USING GIN(to_tsvector('english', COALESCE(content, '')));
