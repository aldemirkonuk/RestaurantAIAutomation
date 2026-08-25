-- Saga state for multi-step distributed workflows (INFRA-DB-04)
CREATE TABLE IF NOT EXISTS saga_state (
    saga_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    saga_type TEXT NOT NULL,
    current_step TEXT NOT NULL DEFAULT 'INIT',
    status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    context JSONB NOT NULL DEFAULT '{}',
    compensations JSONB NOT NULL DEFAULT '[]',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deadline_at TIMESTAMPTZ,
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_saga_state_status_type ON saga_state (status, saga_type);
