-- ============================================================================
-- Email Tracking & Conversation Threading
-- Adds email threading, conversation summarization, and Gmail watch state
-- ============================================================================

-- Add threading and email tracking columns to procurement_conversations
--
-- `restaurant_id` is a GHOST COLUMN captured here (see supabase/SCHEMA_DRIFT.md).
-- It exists in the production database because DDL was once applied by hand, and
-- in no migration at all — while THREE migrations index it (this one at
-- idx_conversations_restaurant_date, 20260514000000_phase32_schema.sql:34, and
-- 20260514120000_phase_32_workflow_status.sql:10). A fresh environment therefore
-- died here with `column "restaurant_id" does not exist`, which is why local
-- bootstrap was impossible and why a hand-rolled parallel schema looked like the
-- only option. It is not: capturing the column is the fix.
--
-- `IF NOT EXISTS` makes this a no-op against the cloud database, where the column
-- is already present, and the thing that makes a fresh bootstrap reach the same
-- schema the cloud has.
ALTER TABLE procurement_conversations
    ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    -- Second ghost column, same story: the full-text index below builds on
    -- `message_text` and nothing ever creates it. The baseline table has
    -- `content` for the body, so this is the later name for the same idea; both
    -- are kept because production has both and dropping either is a separate,
    -- riskier decision than making a fresh database match production.
    ADD COLUMN IF NOT EXISTS message_text TEXT,
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
