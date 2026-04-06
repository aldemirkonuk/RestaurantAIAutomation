-- Phase 8: Web Search Verification & Deep Enrichment
-- producers knowledge graph table (WSRCH-04, WSRCH-05)
-- UNIQUE INDEX on normalized_name is REQUIRED for supabase-py upsert(on_conflict="normalized_name")
-- Without it, upsert silently inserts duplicates (Pitfall 4 — RESEARCH.md)

CREATE TABLE IF NOT EXISTS producers (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name                   TEXT        NOT NULL,
    normalized_name        TEXT        NOT NULL,
    country                TEXT,
    region                 TEXT,
    sub_region             TEXT,
    appellation            TEXT,
    founding_year          INTEGER,
    winemaker_name         TEXT,
    production_volume_cases INTEGER,
    certifications         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    website_url            TEXT,
    portfolio              JSONB       NOT NULL DEFAULT '[]'::jsonb,
    verified_at            TIMESTAMPTZ,
    verification_sources   TEXT[]      NOT NULL DEFAULT '{}',
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- REQUIRED: enables supabase-py upsert(on_conflict="normalized_name")
-- supabase-py only supports single-column ON CONFLICT; multi-column is not reliable
CREATE UNIQUE INDEX IF NOT EXISTS producers_normalized_name_key
    ON producers(normalized_name);

-- Performance indexes for common lookup patterns
CREATE INDEX IF NOT EXISTS producers_country_idx  ON producers(country);
CREATE INDEX IF NOT EXISTS producers_region_idx   ON producers(region);

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION update_producers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_producers_updated_at ON producers;
CREATE TRIGGER trg_producers_updated_at
    BEFORE UPDATE ON producers
    FOR EACH ROW
    EXECUTE FUNCTION update_producers_updated_at();

-- Add web_verified_at to master_wine_library_submissions (WSRCH-06)
-- Required by Plan 04 update payload — missing column causes Supabase 400 error
-- and silently discards all web verification results (field_confidence never written back)
ALTER TABLE master_wine_library_submissions
    ADD COLUMN IF NOT EXISTS web_verified_at TIMESTAMPTZ;

-- Sparse index (only indexed when non-NULL) for efficient "find unverified wines" queries
CREATE INDEX IF NOT EXISTS mwls_web_verified_at_idx
    ON master_wine_library_submissions(web_verified_at)
    WHERE web_verified_at IS NOT NULL;
