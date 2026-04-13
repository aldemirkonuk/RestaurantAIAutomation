-- ============================================================================
-- FCONF-03: field_confidence JSONB column on master_wine_library_submissions
-- ============================================================================
-- Per-field confidence map stored per submission.
-- Format: {"field_name": {"value": ..., "confidence": 0.0-1.0, "source": "visible"|"inferred"|"knowledge"}}

ALTER TABLE master_wine_library_submissions
ADD COLUMN IF NOT EXISTS field_confidence JSONB DEFAULT '{}';

COMMENT ON COLUMN master_wine_library_submissions.field_confidence IS
'Per-field confidence map: {"field_name": {"value": ..., "confidence": 0.0-1.0, "source": "visible"|"inferred"|"knowledge"}}. Built from Vision extraction (source=visible/inferred) and merged with Haiku enrichment (source=knowledge).';

CREATE INDEX IF NOT EXISTS idx_submissions_field_confidence
    ON master_wine_library_submissions USING gin(field_confidence);
