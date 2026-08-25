-- ============================================================================
-- RESEARCH AGENT: research_run_stats — per-record metrics
-- ============================================================================
-- RSCH-07, RSCH-08: Per-wine metrics for each research run.
-- Source of null_rate, promotion_rate, cost_per_field, attempts_per_filled_field.

CREATE TABLE IF NOT EXISTS research_run_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    wine_id UUID NOT NULL,
    fields_targeted INTEGER NOT NULL DEFAULT 0,
    fields_filled INTEGER NOT NULL DEFAULT 0,
    fields_conflicted INTEGER NOT NULL DEFAULT 0,
    fields_unchanged INTEGER NOT NULL DEFAULT 0,
    cost_usd DECIMAL(10,6) NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    null_rate_before DECIMAL(5,4),
    null_rate_after DECIMAL(5,4),
    time_to_fill_hours DECIMAL(10,4),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_research_run_stats_run ON research_run_stats(run_id);
CREATE INDEX IF NOT EXISTS idx_research_run_stats_wine ON research_run_stats(wine_id);

COMMENT ON TABLE research_run_stats IS
'Per-wine metrics for each research run. Source of null_rate, promotion_rate, cost_per_field,
attempts_per_filled_field. Each row = one wine processed in one batch.';
