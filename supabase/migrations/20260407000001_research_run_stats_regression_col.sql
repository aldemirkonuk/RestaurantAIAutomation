-- Phase 12.1 UAT fix: add regression_blocked_count column missing from research_run_stats
-- Bug #6 from 12.1-CONTEXT.md — tracks how many field fills were blocked by regression guard

ALTER TABLE research_run_stats
ADD COLUMN IF NOT EXISTS regression_blocked_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN research_run_stats.regression_blocked_count IS
'Number of candidate fills blocked by the regression guard during this run (Bug #6 fix, Phase 12.1).';
