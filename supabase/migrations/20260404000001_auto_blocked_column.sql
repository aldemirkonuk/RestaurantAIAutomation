-- ============================================================================
-- QUAL-01: Add auto_blocked column to master_wine_library_submissions
-- ============================================================================
-- Wines with completeness_score < 0.3 are blocked from promoting to
-- master_wine_library until a human approves via PATCH /quality/review-queue/{id}

ALTER TABLE master_wine_library_submissions
    ADD COLUMN IF NOT EXISTS auto_blocked BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_submissions_auto_blocked
    ON master_wine_library_submissions (auto_blocked)
    WHERE auto_blocked = TRUE;

COMMENT ON COLUMN master_wine_library_submissions.auto_blocked IS 'TRUE when completeness_score < 0.3 — wine is held in submissions and NOT promoted to master_wine_library until human corrects and approves';
