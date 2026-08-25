-- ============================================================================
-- Phase 4: Claude Haiku Enrichment — add producer_bio to master_wine_library
-- ============================================================================
-- HAIKU-02 requires Haiku to return producer_bio as part of enrichment.
-- This column does not exist in the baseline migration (20260208024921).
-- Uses IF NOT EXISTS — safe to run against live DB whether or not column exists.
-- ============================================================================

ALTER TABLE master_wine_library
    ADD COLUMN IF NOT EXISTS producer_bio TEXT;

COMMENT ON COLUMN master_wine_library.producer_bio IS
    'Short producer biography returned by Claude Haiku enrichment. enrichment_source = haiku.';
