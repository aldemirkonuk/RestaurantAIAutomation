-- Idempotency keys for BaseAgent duplicate message detection (INFRA-DB-01)
CREATE TABLE IF NOT EXISTS idempotency_keys (
    message_id TEXT PRIMARY KEY,
    agent_name TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    result JSONB,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at ON idempotency_keys (expires_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_agent_name ON idempotency_keys (agent_name, processed_at DESC);
