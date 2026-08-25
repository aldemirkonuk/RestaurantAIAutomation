-- ============================================================================
-- EVENTS TABLE
-- Stores cross-page sync events for durable event-driven architecture
-- ============================================================================

-- Create enum for event types
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
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create enum for source pages
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
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create the events table
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Ownership
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- Event definition
    event_type event_type NOT NULL,
    source_page source_page NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    schema_version INTEGER NOT NULL DEFAULT 1,
    
    -- Idempotency & tracing
    idempotency_key VARCHAR(255),
    trace_id VARCHAR(64),
    correlation_id UUID,

    -- Archive tracking
    archived_at TIMESTAMPTZ,
    archive_path TEXT,

    -- Time-based flags for partial indexes (maintained by trigger + scheduler)
    is_recent BOOLEAN DEFAULT true,
    is_archive_candidate BOOLEAN DEFAULT false,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint for idempotency
    CONSTRAINT uq_events_idempotency UNIQUE (restaurant_id, idempotency_key)
);

-- Maintain time-based flags on INSERT/UPDATE
CREATE OR REPLACE FUNCTION events_set_time_flags()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.is_recent := true;
        NEW.is_archive_candidate := false;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        NEW.is_recent := (NEW.created_at > NOW() - INTERVAL '7 days');
        NEW.is_archive_candidate := (NEW.archived_at IS NULL AND NEW.created_at < NOW() - INTERVAL '90 days');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'events_time_flags_trigger'
    ) THEN
        CREATE TRIGGER events_time_flags_trigger
        BEFORE INSERT OR UPDATE ON events
        FOR EACH ROW EXECUTE FUNCTION events_set_time_flags();
    END IF;
END $$;

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_events_restaurant ON events(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source_page);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_restaurant_type ON events(restaurant_id, event_type);
CREATE INDEX IF NOT EXISTS idx_events_restaurant_created ON events(restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id) WHERE trace_id IS NOT NULL;

-- Partial index for recent events (last 7 days) - commonly queried
CREATE INDEX IF NOT EXISTS idx_events_recent ON events(restaurant_id, created_at DESC) 
    WHERE is_recent = true;

-- Partial index for archive candidates (older than 90 days, not archived)
CREATE INDEX IF NOT EXISTS idx_events_archive_candidates ON events(created_at) 
    WHERE is_archive_candidate = true;

-- Partial index for non-archived events (immutable predicate)
CREATE INDEX IF NOT EXISTS idx_events_not_archived ON events(restaurant_id, created_at DESC)
    WHERE archived_at IS NULL;

-- Enable Row Level Security
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see events for their restaurant
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_restaurant_access'
    ) THEN
        DROP POLICY IF EXISTS events_restaurant_policy ON events;
        CREATE POLICY events_restaurant_policy ON events
            FOR ALL
            USING (
                restaurant_id IN (
                    SELECT restaurant_id FROM user_restaurant_access 
                    WHERE user_id = auth.uid()
                )
            );
    ELSE
        RAISE NOTICE 'Skipping events_restaurant_policy: user_restaurant_access table not found';
    END IF;
END $$;

-- Grant permissions
GRANT ALL ON events TO authenticated;

-- Enable Realtime for this table
-- Note: Run this in Supabase dashboard or via supabase CLI if not in publication
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'events'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE events;
    END IF;
EXCEPTION
    WHEN undefined_object THEN
        -- Publication doesn't exist, skip
        RAISE NOTICE 'supabase_realtime publication not found, skipping';
END $$;

-- Add comment
COMMENT ON TABLE events IS 'Stores cross-page sync events for durable event-driven architecture with idempotency support';
COMMENT ON COLUMN events.idempotency_key IS 'Client-generated key to prevent duplicate event processing';
COMMENT ON COLUMN events.trace_id IS 'Distributed tracing ID for request correlation';
COMMENT ON COLUMN events.schema_version IS 'Payload schema version for backward compatibility';
COMMENT ON COLUMN events.is_recent IS 'True if event is < 7 days old. Set on INSERT, updated by scheduled job.';
COMMENT ON COLUMN events.is_archive_candidate IS 'True if event is > 90 days old and not archived. Updated by scheduled job.';
