-- ============================================================================
-- QUAL-01: Add auto_blocked column to master_wine_library_submissions
-- ============================================================================
-- Wines with completeness_score < 0.3 are blocked from promoting to
-- master_wine_library until a human approves via PATCH /quality/review-queue/{id}

-- GHOST TABLE captured (supabase/SCHEMA_DRIFT.md). This repo has two migration
-- systems: `services/database/migrations/` (16 numbered files) and
-- `supabase/migrations/` (this one). `master_wine_library_submissions` is created
-- ONLY in the former, at 013_master_wine_library_dedup_and_events.sql, while this
-- chain merely alters it — and only this chain is what `supabase db reset` and the
-- cloud project apply. So a fresh database died here with
-- `relation "master_wine_library_submissions" does not exist`.
--
-- Definition copied verbatim from 013 so the two systems agree. IF NOT EXISTS
-- makes it a no-op wherever the table is already present, including cloud.
CREATE TABLE IF NOT EXISTS master_wine_library_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID,
  submitted_by UUID,
  payload JSONB NOT NULL,
  normalized_fields JSONB,
  signature_hash TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  decision_reason TEXT,
  matched_master_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_mwls_master
    FOREIGN KEY (matched_master_id)
    REFERENCES master_wine_library(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_mwls_status
  ON master_wine_library_submissions(status);

CREATE INDEX IF NOT EXISTS idx_mwls_signature_hash
  ON master_wine_library_submissions(signature_hash)
  WHERE signature_hash IS NOT NULL;

ALTER TABLE master_wine_library_submissions
    ADD COLUMN IF NOT EXISTS auto_blocked BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_submissions_auto_blocked
    ON master_wine_library_submissions (auto_blocked)
    WHERE auto_blocked = TRUE;

COMMENT ON COLUMN master_wine_library_submissions.auto_blocked IS 'TRUE when completeness_score < 0.3 — wine is held in submissions and NOT promoted to master_wine_library until human corrects and approves';
