-- ============================================================================
-- FCONF-09, FCONF-10: field_calibration + confidence_thresholds tables
-- ============================================================================

-- Tracks measured accuracy per field per confidence bin after human review
CREATE TABLE IF NOT EXISTS field_calibration (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_name VARCHAR(100) NOT NULL,
    confidence_bin VARCHAR(10) NOT NULL,   -- e.g. "0.5-0.6", "0.7-0.8", "0.9-1.0"
    total_reviewed INTEGER NOT NULL DEFAULT 0,
    total_correct INTEGER NOT NULL DEFAULT 0,
    actual_accuracy DECIMAL(5,4),
    measured_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(field_name, confidence_bin)
);

COMMENT ON TABLE field_calibration IS 'Per-field, per-confidence-bin accuracy stats. Populated by daily calibration Celery task after 500+ reviewed wines.';

-- Per-field configurable thresholds — auto-adjusted by calibration loop
CREATE TABLE IF NOT EXISTS confidence_thresholds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_name VARCHAR(100) NOT NULL UNIQUE,
    review_threshold DECIMAL(3,2) NOT NULL DEFAULT 0.50,
    accept_threshold DECIMAL(3,2) NOT NULL DEFAULT 0.80,
    last_calibrated_at TIMESTAMPTZ
);

COMMENT ON TABLE confidence_thresholds IS 'Per-field 3-tier thresholds: < review_threshold = reject (NULL), review_threshold–accept_threshold = queue for review, > accept_threshold = auto-accept. Defaults 0.5/0.8.';

-- Seed default thresholds for all 18 Vision fields + key enrichment fields
INSERT INTO confidence_thresholds (field_name, review_threshold, accept_threshold)
VALUES
    ('wine_name',       0.50, 0.80),
    ('producer',        0.50, 0.80),
    ('vintage',         0.50, 0.80),
    ('primary_type',    0.50, 0.80),
    ('color',           0.50, 0.80),
    ('country',         0.50, 0.80),
    ('region',          0.50, 0.80),
    ('sub_region',      0.50, 0.80),
    ('appellation',     0.50, 0.80),
    ('grape_variety',   0.50, 0.80),
    ('alcohol_pct',     0.50, 0.80),
    ('price_bottle',    0.50, 0.80),
    ('price_glass',     0.50, 0.80),
    ('tasting_notes',   0.50, 0.80),
    ('description',     0.50, 0.80),
    ('section_name',    0.50, 0.80),
    ('bin_number',      0.50, 0.80),
    ('sweetness_level', 0.50, 0.80),
    ('food_pairing',    0.50, 0.80),
    ('producer_bio',    0.50, 0.80)
ON CONFLICT (field_name) DO NOTHING;
