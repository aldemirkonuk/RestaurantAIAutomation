-- ============================================================================
-- FCONF-05: field_review_queue table
-- ============================================================================
-- One row per field-per-wine that falls in the review tier (0.5–0.8 confidence).
-- Reviewed by human via GET/PATCH /api/v1/quality/review-queue.

CREATE TABLE IF NOT EXISTS field_review_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES master_wine_library_submissions(id) ON DELETE CASCADE,
    field_name VARCHAR(100) NOT NULL,
    current_value TEXT,
    confidence DECIMAL(3,2) NOT NULL,
    source VARCHAR(20) NOT NULL DEFAULT 'visible',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    reviewer VARCHAR(255),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_status CHECK (status IN ('pending', 'approved', 'corrected', 'rejected')),
    CONSTRAINT valid_source CHECK (source IN ('visible', 'inferred', 'knowledge'))
);

CREATE INDEX IF NOT EXISTS idx_field_review_queue_submission
    ON field_review_queue(submission_id);

CREATE INDEX IF NOT EXISTS idx_field_review_queue_status
    ON field_review_queue(status) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_field_review_queue_field
    ON field_review_queue(field_name, status);

COMMENT ON TABLE field_review_queue IS 'Surgical field-level review queue. One row per field per wine with confidence in [0.5, 0.8]. Replaces whole-record review with per-field targeting.';
COMMENT ON COLUMN field_review_queue.source IS 'visible = printed on menu; inferred = Claude best-guess; knowledge = Haiku enrichment';
