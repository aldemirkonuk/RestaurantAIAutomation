-- ============================================================================
-- RESEARCH AGENT: resolution_challenges — conflict lifecycle
-- ============================================================================
-- Decision 3 (12-CONTEXT.md): Provenance-based consensus with staleness decay.
-- Locked human resolutions can be challenged by tier-A evidence only.
-- Challenges do NOT overwrite the field — they surface for human re-review.

CREATE TABLE IF NOT EXISTS resolution_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL,
    field_name VARCHAR(100) NOT NULL,
    existing_value TEXT NOT NULL,
    challenging_value TEXT NOT NULL,
    challenging_source_url TEXT NOT NULL,
    challenging_source_tier CHAR(1) NOT NULL DEFAULT 'A',
    snippet TEXT,
    challenged_at TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    resolved_by TEXT,
    resolved_at TIMESTAMPTZ,
    CONSTRAINT valid_challenge_status CHECK (status IN ('open', 'accepted', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_challenges_submission ON resolution_challenges(submission_id);
CREATE INDEX IF NOT EXISTS idx_challenges_open ON resolution_challenges(status) WHERE status = 'open';

COMMENT ON TABLE resolution_challenges IS
'Tier-A evidence that contradicts a human_resolved field. Does NOT update field_confidence.
Surfaces for human re-review only. Tier-B/C contradictions to human resolutions are discarded.';
