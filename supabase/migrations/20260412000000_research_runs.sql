-- ============================================================================
-- RESEARCH AGENT: research_runs — batch-level run accounting
-- ============================================================================
-- RSCH-01: One row per research agent batch run. Aggregated cost + coverage metrics.

CREATE TABLE IF NOT EXISTS research_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    records_eligible INTEGER NOT NULL DEFAULT 0,
    records_processed INTEGER NOT NULL DEFAULT 0,
    fields_filled INTEGER NOT NULL DEFAULT 0,
    cost_usd DECIMAL(10,6) NOT NULL DEFAULT 0,
    pii_policy_flags INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    CONSTRAINT valid_run_status CHECK (status IN ('running','completed','partial','failed'))
);

CREATE INDEX IF NOT EXISTS idx_research_runs_started ON research_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_runs_status ON research_runs(status) WHERE status = 'running';

COMMENT ON TABLE research_runs IS
'One row per research agent batch run. Aggregated cost + coverage metrics per run.';
