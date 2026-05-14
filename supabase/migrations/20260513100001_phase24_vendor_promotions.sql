-- =============================================================================
-- Phase 24: Vendor Promotions + Conversation Infrastructure
-- =============================================================================
-- Creates three tables needed by Phase 24 email intelligence pipeline:
--   1. vendor_promotions — AI-detected wine promotions with urgency scoring
--   2. conversation_embeddings — vector store for conversation semantic search
--   3. provider_conversation_sessions — Phase 24 draft approval columns (added
--      via ALTER TABLE since the base table already exists from migration
--      20260304010000_missing_tables_consolidation.sql)
-- =============================================================================

-- =============================================================================
-- 1. VENDOR PROMOTIONS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS vendor_promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID REFERENCES providers(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    detected_from_conversation_id UUID,
    detected_from_email_subject TEXT,
    product_name VARCHAR(255) NOT NULL,
    grape_variety VARCHAR(100),
    region VARCHAR(100),
    discount_pct DECIMAL(5,2),
    discount_fixed DECIMAL(10,2),
    valid_from DATE,
    valid_until DATE,
    promo_description TEXT,
    conditions TEXT,
    min_quantity INTEGER,
    menu_fit VARCHAR(20) DEFAULT 'PENDING' CHECK (menu_fit IN ('STRONG_FIT','PARTIAL_FIT','NO_FIT','PENDING')),
    menu_fit_detail TEXT,
    dedup_hash VARCHAR(64) UNIQUE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','actioned','suppressed','expired')),
    urgency_score DECIMAL(4,2) DEFAULT NULL,
    linked_event_ids UUID[] DEFAULT '{}',
    last_comparison_price DECIMAL(10,2) DEFAULT NULL,
    price_source_inventory_id UUID,
    snoozed_until TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vendor_promotions_restaurant_id_idx ON vendor_promotions(restaurant_id);
CREATE INDEX IF NOT EXISTS vendor_promotions_provider_id_idx ON vendor_promotions(provider_id);
CREATE INDEX IF NOT EXISTS vendor_promotions_status_idx ON vendor_promotions(status);
CREATE INDEX IF NOT EXISTS vendor_promotions_urgency_idx ON vendor_promotions(urgency_score DESC NULLS LAST);

ALTER TABLE vendor_promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_promotions_restaurant_isolation ON vendor_promotions;
CREATE POLICY vendor_promotions_restaurant_isolation ON vendor_promotions
    USING (restaurant_id = (SELECT restaurant_id FROM users WHERE id = auth.uid()));

-- =============================================================================
-- 2. CONVERSATION EMBEDDINGS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS conversation_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id) ON DELETE CASCADE,
    content_snippet TEXT NOT NULL,
    embedding vector(768),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversation_embeddings_restaurant_idx ON conversation_embeddings(restaurant_id);

ALTER TABLE conversation_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_embeddings_restaurant_isolation ON conversation_embeddings;
CREATE POLICY conversation_embeddings_restaurant_isolation ON conversation_embeddings
    USING (restaurant_id = (SELECT restaurant_id FROM users WHERE id = auth.uid()));

-- =============================================================================
-- 3. PROVIDER_CONVERSATION_SESSIONS — Phase 24 columns
-- =============================================================================
-- The base table already exists (20260304010000_missing_tables_consolidation.sql).
-- CREATE TABLE IF NOT EXISTS is a no-op; we extend via ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS provider_conversation_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id) ON DELETE CASCADE,
    gmail_thread_id TEXT,
    session_status VARCHAR(20) DEFAULT 'active' CHECK (session_status IN ('active','pending_approval','closed')),
    draft_content TEXT,
    draft_created_at TIMESTAMPTZ,
    draft_approved_at TIMESTAMPTZ,
    draft_discarded_at TIMESTAMPTZ,
    reminder_sent_at TIMESTAMPTZ,
    conversation_context JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add Phase 24 columns to existing table (idempotent — IF NOT EXISTS guards)
ALTER TABLE provider_conversation_sessions
    ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT,
    ADD COLUMN IF NOT EXISTS session_status VARCHAR(20) DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS draft_content TEXT,
    ADD COLUMN IF NOT EXISTS draft_created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS draft_approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS draft_discarded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS conversation_context JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS provider_conversation_sessions_restaurant_idx ON provider_conversation_sessions(restaurant_id);
CREATE INDEX IF NOT EXISTS provider_conversation_sessions_thread_idx ON provider_conversation_sessions(gmail_thread_id);

ALTER TABLE provider_conversation_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_conversation_sessions_restaurant_isolation ON provider_conversation_sessions;
CREATE POLICY provider_conversation_sessions_restaurant_isolation ON provider_conversation_sessions
    USING (restaurant_id = (SELECT restaurant_id FROM users WHERE id = auth.uid()));
