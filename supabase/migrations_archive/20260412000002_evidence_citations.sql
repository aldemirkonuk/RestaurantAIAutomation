-- ============================================================================
-- RESEARCH AGENT: evidence_citations + evidence_url_cache
-- ============================================================================
-- RSCH-02: One row per proposed field value with full provenance.
-- RSCH-03: source_url + snippet + retrieved_at REQUIRED for any auto-promoted fill.
-- RSCH-04: citation_completeness metric reads this table.
-- RSCH-05 (fetch-verify cache): evidence_url_cache stores fetched page text (7-day TTL).

CREATE TABLE IF NOT EXISTS evidence_citations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wine_id UUID NOT NULL,
    run_id UUID REFERENCES research_runs(id) ON DELETE SET NULL,
    field_name VARCHAR(100) NOT NULL,
    proposed_value TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_tier CHAR(1) NOT NULL,
    snippet TEXT NOT NULL,
    retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fetch_verified BOOLEAN NOT NULL DEFAULT FALSE,
    corroboration_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_source_tier CHECK (source_tier IN ('A','B','C'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_citations_wine ON evidence_citations(wine_id);
CREATE INDEX IF NOT EXISTS idx_evidence_citations_field ON evidence_citations(wine_id, field_name);
CREATE INDEX IF NOT EXISTS idx_evidence_citations_run ON evidence_citations(run_id);
CREATE INDEX IF NOT EXISTS idx_evidence_citations_tier ON evidence_citations(source_tier, fetch_verified);

COMMENT ON TABLE evidence_citations IS
'One row per proposed field value with full provenance. source_url + snippet + retrieved_at are
REQUIRED for any auto-promoted fill. citation_completeness metric reads this table.';

-- ---------------------------------------------------------------------------
-- URL fetch-verify cache: prevents redundant re-fetches (7-day TTL)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS evidence_url_cache (
    url TEXT PRIMARY KEY,
    page_text TEXT NOT NULL,
    cached_at TIMESTAMPTZ DEFAULT NOW(),
    fetch_method VARCHAR(20) NOT NULL DEFAULT 'httpx'
);

CREATE INDEX IF NOT EXISTS idx_url_cache_age ON evidence_url_cache(cached_at);

COMMENT ON TABLE evidence_url_cache IS
'7-day cache of fetched page text for fetch-verify. Prevents redundant re-fetches when multiple
fields from the same wine verify against the same producer/regulatory page.';
