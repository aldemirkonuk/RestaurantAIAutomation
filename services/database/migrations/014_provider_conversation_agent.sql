-- Migration 014: Provider Conversation Agent tables
-- Supports the Gateway Pattern: ProviderConversationAgent as single communication gateway
-- Tables: provider_knowledge, provider_promotions, conversation_embeddings,
--         provider_conversation_sessions, provider_sentiment_history

BEGIN;

-- =============================================================================
-- 1. provider_knowledge — Provider Digital Twin
-- =============================================================================
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
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pk_provider ON provider_knowledge(provider_id);
CREATE INDEX IF NOT EXISTS idx_pk_category ON provider_knowledge(provider_id, category);
CREATE INDEX IF NOT EXISTS idx_pk_active ON provider_knowledge(provider_id, is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_pk_expires ON provider_knowledge(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pk_restaurant ON provider_knowledge(restaurant_id);

-- =============================================================================
-- 2. provider_promotions — Dedicated Promo Tracking
-- =============================================================================
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
    is_recurring BOOLEAN DEFAULT FALSE,
    recurrence_pattern TEXT,
    recurrence_history JSONB DEFAULT '[]',
    status TEXT DEFAULT 'active' CHECK (status IN (
        'active', 'expired', 'upcoming', 'used', 'cancelled'
    )),
    times_used INTEGER DEFAULT 0,
    savings_realized NUMERIC(10,2) DEFAULT 0,
    comparable_promos JSONB DEFAULT '[]',
    source_conversation_id UUID,
    source_message_text TEXT,
    extracted_at TIMESTAMPTZ DEFAULT NOW(),
    alerted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pp_provider ON provider_promotions(provider_id);
CREATE INDEX IF NOT EXISTS idx_pp_status ON provider_promotions(status);
CREATE INDEX IF NOT EXISTS idx_pp_end_date ON provider_promotions(end_date) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_pp_type ON provider_promotions(promo_type);
CREATE INDEX IF NOT EXISTS idx_pp_restaurant ON provider_promotions(restaurant_id);

-- =============================================================================
-- 3. conversation_embeddings — Vector Memory (pgvector)
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS conversation_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL,
    conversation_id UUID,
    session_id UUID,
    message_text TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('provider', 'restaurant', 'system')),
    channel TEXT CHECK (channel IN ('email', 'sms', 'whatsapp', 'voice')),
    embedding VECTOR(384) NOT NULL,
    extracted_entities JSONB DEFAULT '{}',
    extracted_intents TEXT[],
    importance_score FLOAT DEFAULT 0.5 CHECK (importance_score >= 0 AND importance_score <= 1),
    language TEXT DEFAULT 'en',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ce_provider ON conversation_embeddings(provider_id);
CREATE INDEX IF NOT EXISTS idx_ce_provider_time ON conversation_embeddings(provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ce_importance ON conversation_embeddings(provider_id, importance_score DESC);
CREATE INDEX IF NOT EXISTS idx_ce_restaurant ON conversation_embeddings(restaurant_id);

-- IVFFlat index for vector similarity search (create after data is loaded for best performance)
-- Run manually after initial data load: CREATE INDEX idx_ce_vector ON conversation_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- =============================================================================
-- 4. provider_conversation_sessions — Active Session State
-- =============================================================================
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
    turn_count INTEGER DEFAULT 0,
    last_provider_message TEXT,
    last_provider_message_at TIMESTAMPTZ,
    last_agent_message TEXT,
    last_agent_message_at TIMESTAMPTZ,
    provider_response_expected_by TIMESTAMPTZ,
    follow_up_scheduled_at TIMESTAMPTZ,
    follow_up_reason TEXT,
    summary TEXT,
    intelligence_extracted JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pcs_provider ON provider_conversation_sessions(provider_id);
CREATE INDEX IF NOT EXISTS idx_pcs_status ON provider_conversation_sessions(status);
CREATE INDEX IF NOT EXISTS idx_pcs_followup ON provider_conversation_sessions(follow_up_scheduled_at)
    WHERE status = 'follow_up_scheduled';
CREATE INDEX IF NOT EXISTS idx_pcs_restaurant ON provider_conversation_sessions(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_pcs_active ON provider_conversation_sessions(provider_id, status)
    WHERE status IN ('active', 'paused_for_approval', 'waiting_response');

-- =============================================================================
-- 5. provider_sentiment_history — Sentiment Trend Tracking
-- =============================================================================
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

-- =============================================================================
-- 6. Add conversation_embeddings FK back-reference on sessions
-- =============================================================================
ALTER TABLE conversation_embeddings
    ADD CONSTRAINT fk_ce_session
    FOREIGN KEY (session_id) REFERENCES provider_conversation_sessions(id)
    ON DELETE SET NULL;

-- =============================================================================
-- 7. updated_at triggers
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pk_updated_at') THEN
        CREATE TRIGGER trg_pk_updated_at BEFORE UPDATE ON provider_knowledge
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pp_updated_at') THEN
        CREATE TRIGGER trg_pp_updated_at BEFORE UPDATE ON provider_promotions
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pcs_updated_at') THEN
        CREATE TRIGGER trg_pcs_updated_at BEFORE UPDATE ON provider_conversation_sessions
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- =============================================================================
-- 8. RLS policies (match existing pattern)
-- =============================================================================
ALTER TABLE provider_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_conversation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_sentiment_history ENABLE ROW LEVEL SECURITY;

COMMIT;
