-- Decision log for agent decision auditing (INFRA-DB-02)
CREATE TABLE IF NOT EXISTS decision_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name TEXT NOT NULL,
    decision_type TEXT NOT NULL,
    inputs JSONB NOT NULL DEFAULT '{}',
    reasoning JSONB NOT NULL DEFAULT '{}',
    output JSONB NOT NULL DEFAULT '{}',
    confidence FLOAT,
    correlation_id TEXT,
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decision_log_agent_created ON decision_log (agent_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decision_log_correlation ON decision_log (correlation_id);
