-- ============================================================================
-- MIGRATION 010: Add provider_change and template_change event types
-- 
-- Adds new event types to support:
-- - Provider sync across pages (providers page -> orders dropdown)
-- - Template sync for communications templates
-- ============================================================================

-- Add new event types to the enum
-- Note: PostgreSQL enums require ALTER TYPE to add new values

-- Add provider_change event type
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'provider_change' 
        AND enumtypid = 'event_type'::regtype
    ) THEN
        ALTER TYPE event_type ADD VALUE 'provider_change';
    END IF;
EXCEPTION
    WHEN duplicate_object THEN
        RAISE NOTICE 'event_type provider_change already exists, skipping';
END $$;

-- Add template_change event type  
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'template_change' 
        AND enumtypid = 'event_type'::regtype
    ) THEN
        ALTER TYPE event_type ADD VALUE 'template_change';
    END IF;
EXCEPTION
    WHEN duplicate_object THEN
        RAISE NOTICE 'event_type template_change already exists, skipping';
END $$;

-- Add comments for documentation
COMMENT ON TYPE event_type IS 'Event types for cross-page sync: inventory_change, order_change, calendar_event, dashboard_update, wine_update, report_event, notification_sent, user_action, system_event, provider_change, template_change';

-- ============================================================================
-- VERIFICATION QUERY (run manually to verify)
-- ============================================================================
-- SELECT enumlabel FROM pg_enum WHERE enumtypid = 'event_type'::regtype ORDER BY enumsortorder;
