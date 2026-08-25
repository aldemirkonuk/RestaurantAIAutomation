-- ============================================================================
-- EVENTS DLQ + REPLAY SYSTEM
-- Adds: event_dead_letters, event_replay_jobs, event_schema_registry
-- Depends on: 003_add_events_table.sql (events table + enums)
-- ============================================================================

-- Enums for DLQ and replay jobs
DO $$ BEGIN
    CREATE TYPE dlq_status AS ENUM (
        'pending',
        'retrying',
        'exhausted',
        'resolved',
        'ignored'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE replay_job_status AS ENUM (
        'pending',
        'running',
        'paused',
        'completed',
        'failed',
        'cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- DEAD LETTER QUEUE TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_dead_letters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Original event data
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    user_id UUID,
    event_type event_type NOT NULL,
    source_page source_page NOT NULL,
    payload JSONB NOT NULL,
    schema_version INTEGER,
    idempotency_key VARCHAR(255),
    trace_id VARCHAR(64),

    -- Failure context
    error_code VARCHAR(50) NOT NULL,
    error_message TEXT NOT NULL,
    error_details JSONB,
    error_stack TEXT,

    -- Retry tracking
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    next_retry_at TIMESTAMPTZ,
    status dlq_status DEFAULT 'pending',

    -- Resolution
    resolved_by UUID,
    resolution_notes TEXT,
    resolved_event_id UUID REFERENCES events(id),

    -- Timestamps
    failed_at TIMESTAMPTZ DEFAULT NOW(),
    last_retry_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_event_dlq_status_retry ON event_dead_letters(status, next_retry_at)
    WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_event_dlq_restaurant ON event_dead_letters(restaurant_id, failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_dlq_error_code ON event_dead_letters(error_code);

COMMENT ON TABLE event_dead_letters IS 'Failed events awaiting retry or manual resolution';
COMMENT ON COLUMN event_dead_letters.error_code IS 'Categorized error (SCHEMA_INVALID, DB_TIMEOUT, RATE_LIMITED, INTERNAL_ERROR)';

-- ============================================================================
-- REPLAY JOBS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_replay_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Scope
    restaurant_id UUID REFERENCES restaurants(id),  -- NULL = all tenants (admin-only)
    event_types event_type[],  -- NULL = all types

    -- Time range
    from_timestamp TIMESTAMPTZ NOT NULL,
    to_timestamp TIMESTAMPTZ NOT NULL,

    -- Source
    source VARCHAR(20) NOT NULL CHECK (source IN ('database', 'archive', 'both')),
    archive_paths TEXT[],

    -- Target
    target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('realtime', 'webhook', 'internal')),
    target_endpoint TEXT,
    target_config JSONB,

    -- Progress
    status replay_job_status DEFAULT 'pending',
    total_events INTEGER,
    processed_events INTEGER DEFAULT 0,
    failed_events INTEGER DEFAULT 0,
    skipped_events INTEGER DEFAULT 0,
    last_processed_id UUID,
    last_processed_at TIMESTAMPTZ,

    -- Rate limiting
    events_per_second INTEGER DEFAULT 100,
    batch_size INTEGER DEFAULT 1000,

    -- Metadata
    created_by UUID NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_event_replay_jobs_status ON event_replay_jobs(status)
    WHERE status IN ('pending', 'running', 'paused');
CREATE INDEX IF NOT EXISTS idx_event_replay_jobs_restaurant ON event_replay_jobs(restaurant_id);

COMMENT ON TABLE event_replay_jobs IS 'Tracks event replay/reprocessing jobs for recovery and backfill';

-- ============================================================================
-- EVENT SCHEMA REGISTRY
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_schema_registry (
    id SERIAL PRIMARY KEY,
    event_type event_type NOT NULL,
    schema_version INTEGER NOT NULL,
    json_schema JSONB NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    deprecated_at TIMESTAMPTZ,

    CONSTRAINT uq_event_schema_version UNIQUE (event_type, schema_version)
);

CREATE INDEX IF NOT EXISTS idx_event_schema_registry_type ON event_schema_registry(event_type);
CREATE INDEX IF NOT EXISTS idx_event_schema_registry_active ON event_schema_registry(is_active)
    WHERE is_active = true;

COMMENT ON TABLE event_schema_registry IS 'JSON Schema definitions per event type and version for validation';

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE event_dead_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_replay_jobs ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_restaurant_access'
    ) THEN
        DROP POLICY IF EXISTS "Users can view their restaurant DLQ" ON event_dead_letters;
        CREATE POLICY "Users can view their restaurant DLQ"
        ON event_dead_letters FOR SELECT
        USING (
            restaurant_id IN (
                SELECT restaurant_id FROM user_restaurant_access
                WHERE user_id = auth.uid()
            )
        );

        DROP POLICY IF EXISTS "Users can view replay jobs" ON event_replay_jobs;
        CREATE POLICY "Users can view replay jobs"
        ON event_replay_jobs FOR SELECT
        USING (
            restaurant_id IS NULL OR
            restaurant_id IN (
                SELECT restaurant_id FROM user_restaurant_access
                WHERE user_id = auth.uid()
            )
        );
    ELSE
        RAISE NOTICE 'Skipping DLQ/replay policies: user_restaurant_access table not found';
    END IF;
END $$;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
