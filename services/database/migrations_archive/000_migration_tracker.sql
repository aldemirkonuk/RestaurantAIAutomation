-- ============================================================================
-- MIGRATION TRACKER TABLE
-- Tracks which migrations have been applied to the database
-- ============================================================================

CREATE TABLE IF NOT EXISTS _migrations (
    id SERIAL PRIMARY KEY,
    version VARCHAR(10) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    checksum VARCHAR(64),
    execution_time_ms INTEGER,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_migrations_version ON _migrations(version);
CREATE INDEX IF NOT EXISTS idx_migrations_applied_at ON _migrations(applied_at);

-- Add comment
COMMENT ON TABLE _migrations IS 'Tracks database migration history';
