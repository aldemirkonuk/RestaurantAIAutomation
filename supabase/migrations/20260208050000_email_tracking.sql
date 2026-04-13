-- ============================================================================
-- Email Tracking & Conversation Threading
-- Adds email threading, conversation summarization, and Gmail watch state
-- ============================================================================

-- Add threading and email tracking columns to procurement_conversations
ALTER TABLE procurement_conversations
    ADD COLUMN IF NOT EXISTS thread_id UUID,
    ADD COLUMN IF NOT EXISTS message_id VARCHAR(500),
    ADD COLUMN IF NOT EXISTS parent_message_id UUID REFERENCES procurement_conversations(id),
    ADD COLUMN IF NOT EXISTS email_headers JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(4,3),
    ADD COLUMN IF NOT EXISTS conversation_summary TEXT,
    ADD COLUMN IF NOT EXISTS summary_updated_at TIMESTAMPTZ;

-- Indexes for efficient thread and email lookups
CREATE INDEX IF NOT EXISTS idx_conversations_thread_id
    ON procurement_conversations(thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_conversations_message_id
    ON procurement_conversations(message_id);

CREATE INDEX IF NOT EXISTS idx_conversations_provider_date
    ON procurement_conversations(provider_id, created_at);

CREATE INDEX IF NOT EXISTS idx_conversations_restaurant_date
    ON procurement_conversations(restaurant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_conversations_order_id
    ON procurement_conversations(order_id, created_at);

CREATE INDEX IF NOT EXISTS idx_conversations_channel
    ON procurement_conversations(channel);

CREATE INDEX IF NOT EXISTS idx_conversations_direction
    ON procurement_conversations(direction);

-- Email watch state: tracks Gmail watch subscription and history ID per restaurant
CREATE TABLE IF NOT EXISTS email_watch_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    gmail_history_id BIGINT,
    watch_expiration TIMESTAMPTZ,
    watch_resource_id VARCHAR(255),
    last_sync_at TIMESTAMPTZ,
    error_count INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(restaurant_id)
);

-- Full-text search index on message content for conversation search
CREATE INDEX IF NOT EXISTS idx_conversations_message_text_search
    ON procurement_conversations USING gin(to_tsvector('english', COALESCE(message_text, '')));
