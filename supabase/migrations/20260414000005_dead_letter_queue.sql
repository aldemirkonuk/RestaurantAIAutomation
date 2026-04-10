-- Dead letter queue for failed messages after retry exhaustion (INFRA-DB-06)
CREATE TABLE IF NOT EXISTS dead_letter_queue (
    id BIGSERIAL PRIMARY KEY,
    agent_name TEXT NOT NULL,
    original_exchange TEXT NOT NULL,
    original_routing_key TEXT NOT NULL,
    message JSONB NOT NULL,
    error TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_dlq_agent_created ON dead_letter_queue (agent_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dlq_unresolved ON dead_letter_queue (created_at ASC) WHERE resolved_at IS NULL;
