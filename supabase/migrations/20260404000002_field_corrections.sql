-- ============================================================================
-- QUAL-02: field_corrections table for per-field acceptance rate tracking
-- ============================================================================
-- Logged by PATCH /api/v1/quality/review-queue/{submission_id}
-- One row per changed field per correction event

CREATE TABLE IF NOT EXISTS field_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL,           -- FK to master_wine_library_submissions.id
    field_name VARCHAR(100) NOT NULL,      -- e.g. "wine_name", "vintage", "region"
    original_value TEXT,                   -- value as extracted by Claude Vision / Haiku
    corrected_value TEXT,                  -- value as supplied by human reviewer
    corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    corrected_by TEXT                      -- reviewer identifier (email or user_id string)
);

CREATE INDEX IF NOT EXISTS idx_field_corrections_submission
    ON field_corrections (submission_id);

CREATE INDEX IF NOT EXISTS idx_field_corrections_field_name
    ON field_corrections (field_name);

COMMENT ON TABLE field_corrections IS 'Per-field correction log. One row per changed field per human review action. Used to compute per-field acceptance rates (QUAL-02): fields never corrected = accepted; corrected = rejected for that extraction.';
COMMENT ON COLUMN field_corrections.original_value IS 'Extracted value at time of review — may differ from current submission row if multiple corrections applied';
