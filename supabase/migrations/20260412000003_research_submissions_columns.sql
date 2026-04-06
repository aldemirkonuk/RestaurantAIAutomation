-- ============================================================================
-- RESEARCH AGENT: new columns on master_wine_library_submissions
-- ============================================================================
-- RSCH-05: conflict_candidates JSONB for tracking value disagreements.
-- Eligibility gate: last_research_run_at for 7-day cooldown.

ALTER TABLE master_wine_library_submissions
ADD COLUMN IF NOT EXISTS conflict_candidates JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS last_research_run_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_submissions_last_research ON master_wine_library_submissions(last_research_run_at)
WHERE last_research_run_at IS NOT NULL;

COMMENT ON COLUMN master_wine_library_submissions.conflict_candidates IS
'Fields where >=2 evidence-backed sources disagree. Structure:
{"field_name": [{"value": ..., "source_url": ..., "source_tier": ..., "snippet": ...}]}.
Conflicted fields are NOT auto-promoted — require human resolution.';

COMMENT ON COLUMN master_wine_library_submissions.last_research_run_at IS
'Timestamp of most recent research agent run for this record.
Eligibility gate skips records researched within 7 days.';
