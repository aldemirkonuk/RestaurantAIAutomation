-- =============================================================================
-- Phase 24: Column Additions — providers + procurement tables
-- =============================================================================
-- All statements use ADD COLUMN IF NOT EXISTS / CREATE TYPE IF NOT EXISTS
-- guards for idempotency (safe to re-run).
-- =============================================================================

-- =============================================================================
-- 1. providers: add close_relationship + auto_reply_enabled
-- =============================================================================

ALTER TABLE providers
    ADD COLUMN IF NOT EXISTS close_relationship BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS auto_reply_enabled BOOLEAN DEFAULT false;

-- SECURITY: auto_reply_enabled MUST default to false (premortem R-10).
-- Verify: SELECT column_default FROM information_schema.columns
--   WHERE table_name='providers' AND column_name='auto_reply_enabled';
-- Expected: 'false'

-- =============================================================================
-- 2. procurement_conversations: add gmail_thread_id + conversation_context
-- =============================================================================

ALTER TABLE procurement_conversations
    ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT,
    ADD COLUMN IF NOT EXISTS conversation_context JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS procurement_conversations_thread_idx
    ON procurement_conversations(gmail_thread_id)
    WHERE gmail_thread_id IS NOT NULL;

-- =============================================================================
-- 3. negotiation_facts: create table if absent, add commitment_type enum
-- =============================================================================
-- NOTE: negotiation_facts is not present in any prior migration.
-- Creating it here ensures the commitment_type column and downstream Plan 24-05
-- queries (fact_field ILIKE '%payment%', commitment_type='AGREEMENT') will work.
-- [Deviation Rule 2: table missing from existing migrations; created to unblock
--  downstream plans that query it with providers.notes as fallback]

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'commitment_type_enum'
    ) THEN
        CREATE TYPE commitment_type_enum AS ENUM ('INDICATIVE','OFFER','COUNTER','AGREEMENT');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS negotiation_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID REFERENCES providers(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    conversation_id UUID,
    fact_field TEXT NOT NULL,
    fact_value TEXT,
    commitment_type commitment_type_enum,
    confidence FLOAT DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
    source_message_id UUID,
    valid_from TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS negotiation_facts_provider_idx ON negotiation_facts(provider_id);
CREATE INDEX IF NOT EXISTS negotiation_facts_restaurant_idx ON negotiation_facts(restaurant_id);
CREATE INDEX IF NOT EXISTS negotiation_facts_commitment_idx ON negotiation_facts(commitment_type);

-- Also ALTER in case the table existed already without commitment_type
ALTER TABLE negotiation_facts
    ADD COLUMN IF NOT EXISTS commitment_type commitment_type_enum;
