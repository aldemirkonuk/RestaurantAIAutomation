-- ============================================================================
-- WineOps AI - Events System Schema
-- Version: 2.0.0
-- Purpose: Durable event ingestion with DLQ, replay, versioning, and archival
-- Date: January 2026
-- ============================================================================
-- 
-- This migration adds the complete event ingestion system:
-- 1. events table (main event log with idempotency)
-- 2. event_dead_letters table (failed events for retry)
-- 3. event_replay_jobs table (replay job tracking)
-- 4. event_schema_registry table (schema versioning)
-- 5. Materialized views for analytics
-- 6. Archive functions for hot→cold migration
--
-- Run this AFTER your main schema (supabase_sql_file.sql) is deployed.
-- ============================================================================

-- ============================================================================
-- 1. ENUMS FOR EVENT SYSTEM
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE event_type AS ENUM (
        'inventory_change',
        'order_change', 
        'calendar_event',
        'dashboard_update',
        'wine_update',
        'report_event',
        'notification_sent',
        'user_action',
        'system_event'
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE source_page AS ENUM (
        'dashboard',
        'inventory',
        'wine_library',
        'orders',
        'calendar',
        'reports',
        'communications',
        'providers',
        'documents',
        'notifications',
        'settings',
        'system'
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE dlq_status AS ENUM (
        'pending',
        'retrying',
        'exhausted',
        'resolved',
        'ignored'
    );
EXCEPTION WHEN duplicate_object THEN null;
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
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 2. MAIN EVENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Ownership (uses existing restaurants table)
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    user_id UUID,  -- References auth.users (nullable for system events)
    
    -- Event definition
    event_type event_type NOT NULL,
    source_page source_page NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    schema_version INTEGER NOT NULL DEFAULT 1,
    
    -- Idempotency & tracing
    idempotency_key VARCHAR(255),
    trace_id VARCHAR(64),
    correlation_id UUID,  -- Links related events in a workflow
    
    -- Archive tracking
    archived_at TIMESTAMPTZ,
    archive_path TEXT,
    
    -- Time-based flags for partial indexes (maintained by trigger)
    -- These flags are set on INSERT and updated by a scheduled job
    is_recent BOOLEAN DEFAULT true,  -- Events < 7 days old
    is_archive_candidate BOOLEAN DEFAULT false,  -- Events > 90 days old, not archived
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT uq_events_idempotency UNIQUE (restaurant_id, idempotency_key)
);

-- ============================================================================
-- TRIGGER: Maintain time-based flags on INSERT/UPDATE
-- ============================================================================
-- Note: is_recent starts as true for new events. A scheduled job (cron) should
-- run periodically to UPDATE events SET is_recent = false WHERE created_at < NOW() - INTERVAL '7 days'
-- Similarly for is_archive_candidate.

CREATE OR REPLACE FUNCTION events_set_time_flags()
RETURNS TRIGGER AS $$
BEGIN
    -- On INSERT: new events are always recent, never archive candidates
    IF TG_OP = 'INSERT' THEN
        NEW.is_recent := true;
        NEW.is_archive_candidate := false;
    END IF;
    
    -- On UPDATE: recalculate flags based on current time
    -- This allows manual updates or the archive process to trigger recalculation
    IF TG_OP = 'UPDATE' THEN
        NEW.is_recent := (NEW.created_at > NOW() - INTERVAL '7 days');
        NEW.is_archive_candidate := (NEW.archived_at IS NULL AND NEW.created_at < NOW() - INTERVAL '90 days');
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_time_flags_trigger
BEFORE INSERT OR UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION events_set_time_flags();

-- Indexes for events table
CREATE INDEX IF NOT EXISTS idx_events_restaurant ON events(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source_page);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_restaurant_type ON events(restaurant_id, event_type);
CREATE INDEX IF NOT EXISTS idx_events_restaurant_created ON events(restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id) WHERE trace_id IS NOT NULL;

-- Partial index for recent events (hot queries - last 7 days)
-- Uses boolean flag maintained by trigger + scheduled job (avoids NOW() in predicate)
CREATE INDEX IF NOT EXISTS idx_events_recent ON events(restaurant_id, created_at DESC) 
    WHERE is_recent = true;

-- Partial index for archive candidates (older than 90 days, not archived)
-- Uses boolean flag maintained by trigger + scheduled job (avoids NOW() in predicate)
CREATE INDEX IF NOT EXISTS idx_events_archive_candidates ON events(created_at) 
    WHERE is_archive_candidate = true;

-- Simple partial index for non-archived events (immutable predicate)
CREATE INDEX IF NOT EXISTS idx_events_not_archived ON events(restaurant_id, created_at DESC)
    WHERE archived_at IS NULL;

COMMENT ON TABLE events IS 'Main event log for cross-page sync with versioning, idempotency, and archive support';
COMMENT ON COLUMN events.idempotency_key IS 'Client-generated key to prevent duplicate event processing';
COMMENT ON COLUMN events.trace_id IS 'Distributed tracing ID for request correlation';
COMMENT ON COLUMN events.correlation_id IS 'Links related events in a workflow (e.g., order → inventory → dashboard)';
COMMENT ON COLUMN events.schema_version IS 'Payload schema version for backward compatibility';
COMMENT ON COLUMN events.is_recent IS 'True if event is < 7 days old. Set on INSERT, updated by scheduled job.';
COMMENT ON COLUMN events.is_archive_candidate IS 'True if event is > 90 days old and not archived. Updated by scheduled job.';

-- ============================================================================
-- 3. DEAD LETTER QUEUE TABLE
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

-- Indexes for DLQ
CREATE INDEX IF NOT EXISTS idx_dlq_status_retry ON event_dead_letters(status, next_retry_at) 
    WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_dlq_restaurant ON event_dead_letters(restaurant_id, failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_dlq_error_code ON event_dead_letters(error_code);

COMMENT ON TABLE event_dead_letters IS 'Failed events awaiting retry or manual resolution';
COMMENT ON COLUMN event_dead_letters.error_code IS 'Categorized error: SCHEMA_INVALID, DB_TIMEOUT, RATE_LIMITED, INTERNAL_ERROR';

-- ============================================================================
-- 4. REPLAY JOBS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_replay_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Scope
    restaurant_id UUID REFERENCES restaurants(id),  -- NULL = all tenants (admin only)
    event_types event_type[],  -- NULL = all types
    
    -- Time range
    from_timestamp TIMESTAMPTZ NOT NULL,
    to_timestamp TIMESTAMPTZ NOT NULL,
    
    -- Source
    source VARCHAR(20) NOT NULL CHECK (source IN ('database', 'archive', 'both')),
    archive_paths TEXT[],  -- S3/GCS paths if source includes archive
    
    -- Target
    target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('realtime', 'webhook', 'internal')),
    target_endpoint TEXT,
    target_config JSONB,
    
    -- Progress tracking
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

-- Indexes for replay jobs
CREATE INDEX IF NOT EXISTS idx_replay_jobs_status ON event_replay_jobs(status) 
    WHERE status IN ('pending', 'running', 'paused');
CREATE INDEX IF NOT EXISTS idx_replay_jobs_restaurant ON event_replay_jobs(restaurant_id);

COMMENT ON TABLE event_replay_jobs IS 'Tracks event replay/reprocessing jobs for recovery and backfill';

-- ============================================================================
-- 5. SCHEMA REGISTRY TABLE
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
    
    CONSTRAINT uq_schema_version UNIQUE (event_type, schema_version)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_schema_registry_type ON event_schema_registry(event_type);
CREATE INDEX IF NOT EXISTS idx_schema_registry_active ON event_schema_registry(is_active) WHERE is_active = true;

COMMENT ON TABLE event_schema_registry IS 'JSON Schema definitions per event type and version for validation';

-- ============================================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_dead_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_replay_jobs ENABLE ROW LEVEL SECURITY;

-- Events: Users can only see events for their restaurant
-- Uses existing user_restaurant_access table
CREATE POLICY "Users can view their restaurant events"
ON events FOR SELECT
USING (
    restaurant_id IN (
        SELECT restaurant_id FROM user_restaurant_access
        WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Users can insert events for their restaurant"
ON events FOR INSERT
WITH CHECK (
    restaurant_id IN (
        SELECT restaurant_id FROM user_restaurant_access
        WHERE user_id = auth.uid()
    )
);

-- DLQ: Same tenant restriction
CREATE POLICY "Users can view their restaurant DLQ"
ON event_dead_letters FOR SELECT
USING (
    restaurant_id IN (
        SELECT restaurant_id FROM user_restaurant_access
        WHERE user_id = auth.uid()
    )
);

-- Replay Jobs: Tenant restriction + admin for cross-tenant jobs
CREATE POLICY "Users can view replay jobs"
ON event_replay_jobs FOR SELECT
USING (
    restaurant_id IS NULL OR  -- Admin jobs (requires role check in app)
    restaurant_id IN (
        SELECT restaurant_id FROM user_restaurant_access
        WHERE user_id = auth.uid()
    )
);

-- ============================================================================
-- 7. ENABLE REALTIME FOR EVENTS TABLE
-- ============================================================================

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'events'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE events;
    END IF;
EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'supabase_realtime publication not found, skipping';
END $$;

-- ============================================================================
-- 8. MATERIALIZED VIEWS FOR AGGREGATES
-- ============================================================================

-- Hourly aggregates (refreshed every 5 minutes by cron)
CREATE MATERIALIZED VIEW IF NOT EXISTS event_aggregates_hourly AS
SELECT 
    restaurant_id,
    date_trunc('hour', created_at) AS hour,
    event_type,
    source_page,
    COUNT(*) AS event_count,
    COUNT(DISTINCT user_id) AS unique_users,
    COUNT(DISTINCT idempotency_key) AS unique_events
FROM events
WHERE created_at > NOW() - INTERVAL '7 days'
  AND archived_at IS NULL
GROUP BY 1, 2, 3, 4;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agg_hourly_pk 
ON event_aggregates_hourly(restaurant_id, hour, event_type, source_page);

-- Daily aggregates (refreshed hourly by cron)
CREATE MATERIALIZED VIEW IF NOT EXISTS event_aggregates_daily AS
SELECT 
    restaurant_id,
    date_trunc('day', created_at) AS day,
    event_type,
    COUNT(*) AS event_count,
    COUNT(DISTINCT user_id) AS unique_users,
    COUNT(DISTINCT source_page) AS pages_affected
FROM events
WHERE created_at > NOW() - INTERVAL '90 days'
  AND archived_at IS NULL
GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agg_daily_pk 
ON event_aggregates_daily(restaurant_id, day, event_type);

-- ============================================================================
-- 9. FUNCTIONS FOR EVENT SYSTEM
-- ============================================================================

-- Function: Refresh event aggregates (called by cron)
CREATE OR REPLACE FUNCTION refresh_event_aggregates()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY event_aggregates_hourly;
    REFRESH MATERIALIZED VIEW CONCURRENTLY event_aggregates_daily;
END;
$$ LANGUAGE plpgsql;

-- Function: Update time-based flags for events (called by cron every hour)
-- This keeps is_recent and is_archive_candidate accurate as time passes
CREATE OR REPLACE FUNCTION update_event_time_flags(batch_size INTEGER DEFAULT 10000)
RETURNS TABLE(recent_cleared INTEGER, archive_marked INTEGER) AS $$
DECLARE
    v_recent_cleared INTEGER := 0;
    v_archive_marked INTEGER := 0;
BEGIN
    -- Clear is_recent flag for events older than 7 days
    UPDATE events
    SET is_recent = false
    WHERE id IN (
        SELECT id FROM events
        WHERE is_recent = true
          AND created_at < NOW() - INTERVAL '7 days'
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
    );
    GET DIAGNOSTICS v_recent_cleared = ROW_COUNT;
    
    -- Mark archive candidates (older than 90 days, not archived)
    UPDATE events
    SET is_archive_candidate = true
    WHERE id IN (
        SELECT id FROM events
        WHERE is_archive_candidate = false
          AND archived_at IS NULL
          AND created_at < NOW() - INTERVAL '90 days'
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
    );
    GET DIAGNOSTICS v_archive_marked = ROW_COUNT;
    
    RETURN QUERY SELECT v_recent_cleared, v_archive_marked;
END;
$$ LANGUAGE plpgsql;

-- Function: Calculate next retry time with exponential backoff
-- Note: Uses STABLE (not IMMUTABLE) because it calls NOW()
CREATE OR REPLACE FUNCTION calculate_dlq_next_retry(retry_count INTEGER)
RETURNS TIMESTAMPTZ AS $$
BEGIN
    -- Exponential backoff: 1min, 5min, 30min
    RETURN CASE 
        WHEN retry_count = 0 THEN NOW() + INTERVAL '1 minute'
        WHEN retry_count = 1 THEN NOW() + INTERVAL '5 minutes'
        WHEN retry_count = 2 THEN NOW() + INTERVAL '30 minutes'
        ELSE NULL  -- No more retries
    END;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function: Archive old events (called by nightly cron)
CREATE OR REPLACE FUNCTION archive_old_events(
    retention_days INTEGER DEFAULT 90,
    batch_size INTEGER DEFAULT 10000
)
RETURNS TABLE(archived_count INTEGER, error_message TEXT) AS $$
DECLARE
    v_archived_count INTEGER := 0;
    v_cutoff_date TIMESTAMPTZ;
BEGIN
    v_cutoff_date := NOW() - (retention_days || ' days')::INTERVAL;
    
    -- Mark events for archival (actual S3 upload done by application)
    UPDATE events
    SET archived_at = NOW()
    WHERE id IN (
        SELECT id FROM events
        WHERE created_at < v_cutoff_date
          AND archived_at IS NULL
        ORDER BY created_at
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
    );
    
    GET DIAGNOSTICS v_archived_count = ROW_COUNT;
    
    RETURN QUERY SELECT v_archived_count, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 0, SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Function: Clean up archived events (called after S3 upload confirmed)
CREATE OR REPLACE FUNCTION delete_archived_events(
    archive_path_pattern TEXT,
    batch_size INTEGER DEFAULT 5000
)
RETURNS INTEGER AS $$
DECLARE
    v_deleted_count INTEGER;
BEGIN
    DELETE FROM events
    WHERE id IN (
        SELECT id FROM events
        WHERE archived_at IS NOT NULL
          AND archive_path LIKE archive_path_pattern
          AND archived_at < NOW() - INTERVAL '7 days'  -- Safety: keep 7 days after archive
        LIMIT batch_size
    );
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 10. SEED INITIAL SCHEMA VERSIONS
-- ============================================================================

INSERT INTO event_schema_registry (event_type, schema_version, json_schema, description)
VALUES 
    ('inventory_change', 1, '{
        "type": "object",
        "required": ["wineId", "quantity", "changeType"],
        "properties": {
            "wineId": {"type": "string", "format": "uuid"},
            "wineName": {"type": "string"},
            "quantity": {"type": "integer"},
            "previousQuantity": {"type": "integer"},
            "changeType": {"type": "string", "enum": ["add", "remove", "adjust", "transfer"]},
            "reason": {"type": "string"},
            "locationId": {"type": "string", "format": "uuid"}
        }
    }', 'Inventory change event schema v1'),
    
    ('order_change', 1, '{
        "type": "object",
        "required": ["orderId", "status"],
        "properties": {
            "orderId": {"type": "string", "format": "uuid"},
            "status": {"type": "string", "enum": ["created", "approved", "ordered", "shipped", "delivered", "cancelled"]},
            "wineId": {"type": "string", "format": "uuid"},
            "quantity": {"type": "integer"},
            "providerId": {"type": "string", "format": "uuid"},
            "totalAmount": {"type": "number"}
        }
    }', 'Order change event schema v1'),
    
    ('calendar_event', 1, '{
        "type": "object",
        "required": ["eventId", "title", "action"],
        "properties": {
            "eventId": {"type": "string", "format": "uuid"},
            "title": {"type": "string"},
            "eventType": {"type": "string"},
            "action": {"type": "string", "enum": ["created", "updated", "deleted", "completed"]},
            "date": {"type": "string", "format": "date"},
            "startTime": {"type": "string"},
            "endTime": {"type": "string"},
            "allDay": {"type": "boolean"}
        }
    }', 'Calendar event schema v1'),
    
    ('dashboard_update', 1, '{
        "type": "object",
        "required": ["updateType"],
        "properties": {
            "updateType": {"type": "string", "enum": ["metric", "alert", "reminder", "widget"]},
            "metricKey": {"type": "string"},
            "value": {"type": "number"},
            "previousValue": {"type": "number"},
            "alertLevel": {"type": "string", "enum": ["info", "warning", "critical"]},
            "message": {"type": "string"}
        }
    }', 'Dashboard update event schema v1'),
    
    ('wine_update', 1, '{
        "type": "object",
        "required": ["wineId", "action"],
        "properties": {
            "wineId": {"type": "string", "format": "uuid"},
            "wineName": {"type": "string"},
            "action": {"type": "string", "enum": ["added", "updated", "removed", "archived"]},
            "changes": {"type": "object"}
        }
    }', 'Wine update event schema v1'),
    
    ('report_event', 1, '{
        "type": "object",
        "required": ["reportId", "action"],
        "properties": {
            "reportId": {"type": "string", "format": "uuid"},
            "reportType": {"type": "string"},
            "action": {"type": "string", "enum": ["generated", "scheduled", "sent", "failed"]},
            "format": {"type": "string", "enum": ["pdf", "csv", "excel"]},
            "recipients": {"type": "array", "items": {"type": "string"}},
            "fileUrl": {"type": "string"}
        }
    }', 'Report event schema v1'),
    
    ('notification_sent', 1, '{
        "type": "object",
        "required": ["notificationId", "channel", "status"],
        "properties": {
            "notificationId": {"type": "string", "format": "uuid"},
            "channel": {"type": "string", "enum": ["email", "sms", "push", "in_app"]},
            "recipientId": {"type": "string", "format": "uuid"},
            "templateId": {"type": "string"},
            "status": {"type": "string", "enum": ["sent", "delivered", "failed", "bounced"]}
        }
    }', 'Notification sent event schema v1'),
    
    ('user_action', 1, '{
        "type": "object",
        "required": ["action", "targetType", "targetId"],
        "properties": {
            "action": {"type": "string"},
            "targetType": {"type": "string"},
            "targetId": {"type": "string"},
            "metadata": {"type": "object"}
        }
    }', 'User action event schema v1'),
    
    ('system_event', 1, '{
        "type": "object",
        "required": ["eventName", "severity"],
        "properties": {
            "eventName": {"type": "string"},
            "severity": {"type": "string", "enum": ["info", "warning", "error"]},
            "details": {"type": "object"}
        }
    }', 'System event schema v1')
ON CONFLICT (event_type, schema_version) DO NOTHING;

-- ============================================================================
-- 11. SCHEDULED JOBS (pg_cron or external scheduler)
-- ============================================================================
-- 
-- These jobs should be scheduled to maintain the event system:
--
-- 1. Update time-based flags (every hour)
--    SELECT update_event_time_flags(10000);
--
-- 2. Refresh materialized views (every 5 minutes for hourly, every hour for daily)
--    SELECT refresh_event_aggregates();
--
-- 3. Archive old events (nightly at 2 AM)
--    SELECT * FROM archive_old_events(90, 10000);
--
-- If using pg_cron (Supabase Pro/Enterprise), uncomment these:
--
-- SELECT cron.schedule('update-event-flags', '0 * * * *', 'SELECT update_event_time_flags(10000)');
-- SELECT cron.schedule('refresh-event-aggregates', '*/5 * * * *', 'SELECT refresh_event_aggregates()');
-- SELECT cron.schedule('archive-old-events', '0 2 * * *', 'SELECT * FROM archive_old_events(90, 10000)');
--
-- If using external scheduler (e.g., GitHub Actions, Supabase Edge Functions):
-- Call these functions via Supabase client or direct SQL connection.
--
-- ============================================================================

-- ============================================================================
-- 12. VERIFICATION QUERIES
-- ============================================================================

-- Run these to verify the migration succeeded:

-- Check tables exist
-- SELECT table_name FROM information_schema.tables 
-- WHERE table_schema = 'public' 
-- AND table_name IN ('events', 'event_dead_letters', 'event_replay_jobs', 'event_schema_registry');

-- Check realtime is enabled
-- SELECT schemaname, tablename FROM pg_publication_tables 
-- WHERE pubname = 'supabase_realtime' AND tablename = 'events';

-- Check schema registry
-- SELECT event_type, schema_version, is_active FROM event_schema_registry;

-- Check indexes (should NOT have NOW() in predicate)
-- SELECT indexname, indexdef FROM pg_indexes 
-- WHERE tablename = 'events' AND indexname LIKE 'idx_events%';

-- Check trigger exists
-- SELECT tgname, tgtype FROM pg_trigger WHERE tgrelid = 'events'::regclass;

-- Check functions exist
-- SELECT proname FROM pg_proc 
-- WHERE proname IN ('events_set_time_flags', 'update_event_time_flags', 'refresh_event_aggregates', 'archive_old_events');

-- ============================================================================
-- END OF EVENTS SYSTEM MIGRATION
-- ============================================================================