-- Phase 9: Wine Ontology, Taxonomy & Cross-Validation
-- Tables: wine_regions, grape_varieties, appellation_rules, vintage_rules
-- Adds: ontology_validation JSONB to master_wine_library_submissions
-- Extends: field_review_queue source constraint to include 'ontology'
-- D-02: ltree extension attempted; adjacency-list parent_id always present as fallback
-- Requirements: ONTO-01, ONTO-02, ONTO-03, ONTO-04, ONTO-06

-- ============================================================================
-- Section 1: ltree extension probe (D-02)
-- D-02: attempt ltree extension; adjacency-list parent_id is always present as fallback
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS ltree;

-- ============================================================================
-- Section 2: wine_regions table (ONTO-01)
-- Hierarchical region taxonomy with ltree path + adjacency-list parent_id (D-02)
-- ============================================================================
CREATE TABLE IF NOT EXISTS wine_regions (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  TEXT        NOT NULL,
    level                 VARCHAR(20) NOT NULL,
    parent_id             UUID        REFERENCES wine_regions(id) ON DELETE SET NULL,
    country_code          CHAR(2),
    classification_system VARCHAR(20),
    path                  ltree,
    canonical_name        TEXT        NOT NULL DEFAULT '',
    aliases               TEXT[]      NOT NULL DEFAULT '{}',
    effective_from        DATE,
    source_ref            TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT valid_level CHECK (level IN ('country', 'region', 'sub_region', 'appellation', 'commune', 'vineyard'))
);

CREATE INDEX IF NOT EXISTS wine_regions_parent_id_idx ON wine_regions(parent_id);
CREATE INDEX IF NOT EXISTS wine_regions_level_idx ON wine_regions(level);
CREATE INDEX IF NOT EXISTS wine_regions_country_code_idx ON wine_regions(country_code);
CREATE INDEX IF NOT EXISTS wine_regions_canonical_name_idx ON wine_regions(canonical_name);
-- ltree GiST index (only effective if ltree extension loaded above)
CREATE INDEX IF NOT EXISTS wine_regions_path_gist_idx ON wine_regions USING GIST (path);
CREATE INDEX IF NOT EXISTS wine_regions_path_btree_idx ON wine_regions USING BTREE (path);

COMMENT ON TABLE wine_regions IS 'Hierarchical wine region taxonomy. Uses both ltree path (D-02: dot-separated, e.g. france.bordeaux.margaux) and adjacency-list parent_id for portability.';
COMMENT ON COLUMN wine_regions.path IS 'ltree path: dot-separated canonical names, lowercase, no spaces (e.g. france.bordeaux.margaux). NULL if ltree extension unavailable.';
COMMENT ON COLUMN wine_regions.parent_id IS 'D-02 adjacency-list fallback: always populated regardless of ltree availability.';

-- ============================================================================
-- Section 3: grape_varieties table (ONTO-02)
-- Canonical grape registry with alias lookup support
-- ============================================================================
CREATE TABLE IF NOT EXISTS grape_varieties (
    id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name                      TEXT        NOT NULL,
    canonical_name            TEXT        NOT NULL,
    color                     VARCHAR(10) NOT NULL DEFAULT 'unknown',
    family                    TEXT,
    aliases                   TEXT[]      NOT NULL DEFAULT '{}',
    typical_regions           TEXT[]      NOT NULL DEFAULT '{}',
    typical_blending_partners TEXT[]      NOT NULL DEFAULT '{}',
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT valid_color CHECK (color IN ('red', 'white', 'rosé', 'orange', 'unknown'))
);

CREATE UNIQUE INDEX IF NOT EXISTS grape_varieties_canonical_name_key ON grape_varieties(canonical_name);
CREATE INDEX IF NOT EXISTS grape_varieties_name_idx ON grape_varieties(name);
-- GIN index on aliases for fast alias lookups (e.g., find grape where 'shiraz' = ANY(aliases))
CREATE INDEX IF NOT EXISTS grape_varieties_aliases_gin_idx ON grape_varieties USING GIN (aliases);

COMMENT ON TABLE grape_varieties IS 'Canonical grape variety registry. aliases TEXT[] enables matching regional synonyms (e.g., Shiraz → Syrah) before cross-validation.';
COMMENT ON COLUMN grape_varieties.aliases IS 'Regional synonyms and alternate spellings (e.g., ["Shiraz", "Hermitage"] for Syrah).';

-- ============================================================================
-- Section 4: appellation_rules table (ONTO-03)
-- Regulatory rules per appellation: grape requirements, aging, yield, color
-- required_grapes JSONB format: [{"grape": "Nebbiolo", "min_pct": 100}]
-- allowed_grapes  JSONB format: [{"grape": "Sangiovese", "min_pct": 80}]
-- ============================================================================
CREATE TABLE IF NOT EXISTS appellation_rules (
    id                               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    appellation_id                   UUID    REFERENCES wine_regions(id) ON DELETE SET NULL,
    appellation_name                 TEXT    NOT NULL,
    required_grapes                  JSONB   NOT NULL DEFAULT '[]'::jsonb,
    allowed_grapes                   JSONB   NOT NULL DEFAULT '[]'::jsonb,
    min_aging_months                 INTEGER,
    min_vintage_release_delay_months INTEGER,
    allowed_colors                   TEXT[]  NOT NULL DEFAULT '{}',
    max_yield_hl_ha                  DECIMAL(6,2),
    classification_levels            TEXT[]  NOT NULL DEFAULT '{}',
    effective_from                   DATE,
    effective_to                     DATE,
    source_ref                       TEXT,
    updated_by                       TEXT,
    created_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS appellation_rules_appellation_name_idx ON appellation_rules(appellation_name);
CREATE INDEX IF NOT EXISTS appellation_rules_appellation_id_idx ON appellation_rules(appellation_id);
-- GIN indexes for JSONB grape checks
CREATE INDEX IF NOT EXISTS appellation_rules_required_grapes_idx ON appellation_rules USING GIN (required_grapes);
CREATE INDEX IF NOT EXISTS appellation_rules_allowed_grapes_idx ON appellation_rules USING GIN (allowed_grapes);

COMMENT ON TABLE appellation_rules IS 'Regulatory rules per appellation. required_grapes JSONB: [{"grape": "Nebbiolo", "min_pct": 100}]. Validated on read with Pydantic in service layer (T-09-01).';

-- ============================================================================
-- Section 5: vintage_rules table (ONTO-04)
-- Release delay and NV rules per region/appellation
-- ============================================================================
CREATE TABLE IF NOT EXISTS vintage_rules (
    id                           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    region_id                    UUID        REFERENCES wine_regions(id) ON DELETE SET NULL,
    appellation_name             TEXT        NOT NULL,
    rule_type                    VARCHAR(20) NOT NULL DEFAULT 'standard',
    min_release_delay_months     INTEGER     NOT NULL,
    allows_nv                    BOOLEAN     NOT NULL DEFAULT FALSE,
    notes                        TEXT,
    source_ref                   TEXT,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT valid_rule_type CHECK (rule_type IN ('standard', 'riserva', 'gran_reserva', 'nouveau', 'special'))
);

CREATE INDEX IF NOT EXISTS vintage_rules_appellation_name_idx ON vintage_rules(appellation_name);
CREATE INDEX IF NOT EXISTS vintage_rules_region_id_idx ON vintage_rules(region_id);

COMMENT ON TABLE vintage_rules IS 'Vintage release delay rules per appellation. allows_nv=TRUE means non-vintage wines skip year plausibility checks.';

-- ============================================================================
-- Section 6: Add ontology_validation columns to master_wine_library_submissions (ONTO-06)
-- ontology_validation JSONB structure:
-- {"checks_passed": 4, "checks_failed": 1, "checks_total": 5,
--  "failures": [{"check": "grape_appellation", "severity": "critical",
--                "expected": "Nebbiolo", "found": "Cabernet Sauvignon",
--                "message": "Barolo requires Nebbiolo"}]}
-- ============================================================================
ALTER TABLE master_wine_library_submissions
    ADD COLUMN IF NOT EXISTS ontology_validation JSONB;
ALTER TABLE master_wine_library_submissions
    ADD COLUMN IF NOT EXISTS ontology_validated_at TIMESTAMPTZ;

-- GIN index: used by queries filtering on failures array (e.g., checks_failed > 0)
CREATE INDEX IF NOT EXISTS idx_mwls_ontology_validation
    ON master_wine_library_submissions USING GIN (ontology_validation);

-- Sparse index on ontology_validated_at: efficient "find un-validated wines" queries
CREATE INDEX IF NOT EXISTS idx_mwls_ontology_validated_at
    ON master_wine_library_submissions(ontology_validated_at)
    WHERE ontology_validated_at IS NOT NULL;

COMMENT ON COLUMN master_wine_library_submissions.ontology_validation IS
'Cross-validation result: {"checks_passed": N, "checks_failed": N, "checks_total": N, "failures": [{"check": "...", "severity": "critical"|"warning", "expected": "...", "found": "...", "message": "..."}]}';
COMMENT ON COLUMN master_wine_library_submissions.ontology_validated_at IS
'Timestamp of last ontology cross-validation run. NULL = not yet validated.';

-- ============================================================================
-- Section 7: Extend field_review_queue source constraint to allow 'ontology'
-- T-09-03: constraint still allowlists specific strings; 'ontology' is service-internal
-- Previous constraint: CHECK (source IN ('visible', 'inferred', 'knowledge'))
-- ============================================================================
ALTER TABLE field_review_queue DROP CONSTRAINT IF EXISTS valid_source;
ALTER TABLE field_review_queue
    ADD CONSTRAINT valid_source
    CHECK (source IN ('visible', 'inferred', 'knowledge', 'ontology'));

COMMENT ON COLUMN field_review_queue.source IS 'visible = printed on menu; inferred = Claude best-guess; knowledge = Haiku enrichment; ontology = Phase 9 cross-validation engine';
