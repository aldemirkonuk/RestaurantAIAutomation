-- ============================================================================
-- Migration 015: Governance Tiers, Wine Aliases, Enrichment Queue
-- ============================================================================
-- Adds 5-tier governance system to master_wine_library
-- Creates wine_aliases table for deduplication
-- Creates enrichment_queue table for background web enrichment
-- ============================================================================

-- ── 1. Add governance columns to master_wine_library ──────────────────────

ALTER TABLE master_wine_library
ADD COLUMN IF NOT EXISTS library_tier INTEGER DEFAULT 4
    CHECK (library_tier >= 0 AND library_tier <= 4);

ALTER TABLE master_wine_library
ADD COLUMN IF NOT EXISTS canonical_name_verified BOOLEAN DEFAULT FALSE;

ALTER TABLE master_wine_library
ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected', 'needs_review'));

ALTER TABLE master_wine_library
ADD COLUMN IF NOT EXISTS field_confidences JSONB DEFAULT '{}';

ALTER TABLE master_wine_library
ADD COLUMN IF NOT EXISTS library_tier_updated_at TIMESTAMPTZ;

-- Add expanded schema fields (Layer 2 + Layer 3) if missing
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS appellation_tier TEXT;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS acidity TEXT;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS tannins TEXT;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS texture TEXT;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS finish TEXT;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS primary_aromas JSONB;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS secondary_aromas JSONB;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS tertiary_aromas JSONB;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS quality_level TEXT;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS classification_name TEXT;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS classification_system TEXT;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS reserve_status TEXT;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS vintage_quality TEXT;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS farming TEXT;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS aging_vessel TEXT;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS aging_duration TEXT;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS serving_temp_celsius INTEGER;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS glass_type TEXT;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS decanting_recommended BOOLEAN;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS aging_potential_years INTEGER;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS rating_ws TEXT;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS rating_rp TEXT;
ALTER TABLE master_wine_library ADD COLUMN IF NOT EXISTS rating_jr TEXT;

COMMENT ON COLUMN master_wine_library.library_tier IS
    '0=Canonical (human-verified), 1=Auto-Validated, 2=Web-Enriched, 3=Provisional, 4=Unresolved';

-- ── 2. Indexes for governance queries ─────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_master_wine_library_tier
    ON master_wine_library (library_tier);

CREATE INDEX IF NOT EXISTS idx_master_wine_library_review_status
    ON master_wine_library (review_status)
    WHERE review_status IN ('pending', 'needs_review');

CREATE INDEX IF NOT EXISTS idx_master_wine_library_canonical
    ON master_wine_library (canonical_name_verified)
    WHERE canonical_name_verified = TRUE;

-- Composite index for review queue (most common query)
CREATE INDEX IF NOT EXISTS idx_master_wine_library_review_queue
    ON master_wine_library (library_tier, created_at DESC)
    WHERE library_tier >= 3;


-- ── 3. Wine aliases table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wine_aliases (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    canonical_id UUID NOT NULL REFERENCES master_wine_library(id) ON DELETE CASCADE,
    alias_name TEXT NOT NULL,
    alias_name_normalized TEXT, -- lowercase, stripped diacritics
    alias_source TEXT NOT NULL DEFAULT 'human_review',
        -- human_review | ocr_correction | web_discovery | auto_dedup
    language TEXT, -- ISO 639-1 (e.g., 'tr', 'en', 'fr')
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (canonical_id, alias_name_normalized)
);

CREATE INDEX IF NOT EXISTS idx_wine_aliases_normalized
    ON wine_aliases (alias_name_normalized);

CREATE INDEX IF NOT EXISTS idx_wine_aliases_canonical
    ON wine_aliases (canonical_id);

COMMENT ON TABLE wine_aliases IS
    'Maps variant names, OCR corruptions, and regional spellings back to canonical wine entries';


-- ── 4. Enrichment queue table ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS enrichment_queue (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    wine_id UUID NOT NULL REFERENCES master_wine_library(id) ON DELETE CASCADE,
    fields_targeted JSONB NOT NULL DEFAULT '[]',
        -- List of field names that need enrichment
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'in_progress', 'complete', 'failed', 'skipped')),
    enriched_fields JSONB DEFAULT '{}',
        -- Dict of field_name: enriched_value
    web_sources JSONB DEFAULT '[]',
        -- List of {url, trust_score, field_enriched}
    error_message TEXT,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    queued_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Prevent duplicate enrichment jobs for same wine
    UNIQUE (wine_id, status) -- Only one active job per wine per status
);

CREATE INDEX IF NOT EXISTS idx_enrichment_queue_status
    ON enrichment_queue (status, queued_at ASC)
    WHERE status IN ('queued', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_enrichment_queue_wine
    ON enrichment_queue (wine_id);

COMMENT ON TABLE enrichment_queue IS
    'Background web enrichment jobs for Tier 2/3 wines. Processed by Celery workers.';


-- ── 5. Update master_wine_library_submissions for onboarding ──────────────

ALTER TABLE master_wine_library_submissions
ADD COLUMN IF NOT EXISTS submitted_by TEXT DEFAULT 'unknown';
    -- onboarding | gemini_research | crawler | manual

ALTER TABLE master_wine_library_submissions
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;


-- ── 6. Trigger: auto-update library_tier_updated_at ───────────────────────

CREATE OR REPLACE FUNCTION update_library_tier_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.library_tier IS DISTINCT FROM OLD.library_tier THEN
        NEW.library_tier_updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_library_tier_updated ON master_wine_library;
CREATE TRIGGER trg_library_tier_updated
    BEFORE UPDATE ON master_wine_library
    FOR EACH ROW
    EXECUTE FUNCTION update_library_tier_timestamp();


-- ── 7. Function: normalize alias name (strip diacritics, lowercase) ───────

CREATE OR REPLACE FUNCTION normalize_wine_alias()
RETURNS TRIGGER AS $$
BEGIN
    NEW.alias_name_normalized = LOWER(
        TRANSLATE(
            NEW.alias_name,
            'àáâãäåèéêëìíîïòóôõöùúûüýÿñçšžÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝŸÑÇŠŽüöçşğı',
            'aaaaaaeeeeiiiioooooouuuuyyncsxAAAAAAEEEEIIIIIOOOOOUUUUYYNCSZuocsgı'
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalize_alias ON wine_aliases;
CREATE TRIGGER trg_normalize_alias
    BEFORE INSERT OR UPDATE ON wine_aliases
    FOR EACH ROW
    EXECUTE FUNCTION normalize_wine_alias();
