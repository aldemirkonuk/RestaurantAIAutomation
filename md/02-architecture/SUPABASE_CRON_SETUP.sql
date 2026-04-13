-- ============================================================================
-- Supabase pg_cron Setup for Calendar-Based Reports
-- ============================================================================
-- This file sets up database-level scheduling for automated report generation
-- using Supabase's built-in pg_cron extension.
--
-- Benefits over APScheduler:
-- - Distributed (runs in database, not app)
-- - Persistent (survives app restarts)
-- - Timezone-aware
-- - Integrated with manager preferences
-- - No additional infrastructure needed
-- ============================================================================

-- Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================================
-- 1. DAILY REPORTS (Every day at configured time per manager)
-- ============================================================================

-- Schedule: Check every 5 minutes for managers who want daily reports
SELECT cron.schedule(
    'daily-reports-check',
    '*/5 * * * *',  -- Every 5 minutes
    $$
    SELECT
      net.http_post(
        url := 'https://your-agent-orchestrator-url.com/api/v1/reports/generate',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := json_build_object(
          'type', 'generate_scheduled_report',
          'restaurant_id', r.id,
          'manager_id', mp.manager_id,
          'report_type', 'comprehensive',
          'frequency', 'DAILY'
        )::text
      )
    FROM manager_preferences mp
    JOIN restaurants r ON r.id = mp.restaurant_id
    WHERE mp.report_frequency = 'DAILY'
      AND mp.low_stock_alert_enabled = true
      AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE mp.report_timezone)) = EXTRACT(HOUR FROM mp.report_delivery_time)
      AND EXTRACT(MINUTE FROM (NOW() AT TIME ZONE mp.report_timezone)) BETWEEN 
          EXTRACT(MINUTE FROM mp.report_delivery_time) - 2 AND 
          EXTRACT(MINUTE FROM mp.report_delivery_time) + 2;
    $$
);

-- ============================================================================
-- 2. WEEKLY REPORTS (Every Monday at 9 AM by default)
-- ============================================================================

-- Schedule: Check every hour on Mondays for weekly reports
SELECT cron.schedule(
    'weekly-reports-monday',
    '0 9 * * 1',  -- Every Monday at 9 AM UTC
    $$
    SELECT
      net.http_post(
        url := 'https://your-agent-orchestrator-url.com/api/v1/reports/generate',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := json_build_object(
          'type', 'generate_scheduled_report',
          'restaurant_id', r.id,
          'manager_id', mp.manager_id,
          'report_type', 'comprehensive',
          'frequency', 'WEEKLY'
        )::text
      )
    FROM manager_preferences mp
    JOIN restaurants r ON r.id = mp.restaurant_id
    WHERE mp.report_frequency = 'WEEKLY'
      AND mp.low_stock_alert_enabled = true;
    $$
);

-- ============================================================================
-- 3. MONTHLY REPORTS (First day of month at 9 AM)
-- ============================================================================

-- Schedule: First day of every month at 9 AM UTC
SELECT cron.schedule(
    'monthly-reports-first-day',
    '0 9 1 * *',  -- 1st of every month at 9 AM UTC
    $$
    SELECT
      net.http_post(
        url := 'https://your-agent-orchestrator-url.com/api/v1/reports/generate',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := json_build_object(
          'type', 'generate_scheduled_report',
          'restaurant_id', r.id,
          'manager_id', mp.manager_id,
          'report_type', 'comprehensive',
          'frequency', 'MONTHLY'
        )::text
      )
    FROM manager_preferences mp
    JOIN restaurants r ON r.id = mp.restaurant_id
    WHERE mp.report_frequency = 'MONTHLY'
      AND mp.low_stock_alert_enabled = true;
    $$
);

-- ============================================================================
-- 4. CALENDAR EVENT-BASED REPORTS (Check upcoming events)
-- ============================================================================

-- Schedule: Check every hour for upcoming calendar events that need reports
SELECT cron.schedule(
    'calendar-event-reports',
    '0 * * * *',  -- Every hour
    $$
    SELECT
      net.http_post(
        url := 'https://your-agent-orchestrator-url.com/api/v1/reports/generate',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := json_build_object(
          'type', 'generate_event_report',
          'restaurant_id', ce.restaurant_id,
          'event_id', ce.id,
          'event_title', ce.title
        )::text
      )
    FROM calendar_events ce
    WHERE ce.event_type IN ('inventory_audit', 'financial_review', 'sales_review')
      AND ce.start_date BETWEEN NOW() AND NOW() + INTERVAL '1 hour'
      AND ce.report_generated = false;
    $$
);

-- ============================================================================
-- 5. LOW STOCK ALERTS (Every 30 minutes)
-- ============================================================================

-- Schedule: Check for low stock every 30 minutes
SELECT cron.schedule(
    'low-stock-alerts',
    '*/30 * * * *',  -- Every 30 minutes
    $$
    SELECT
      net.http_post(
        url := 'https://your-agent-orchestrator-url.com/api/v1/alerts/low-stock',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := json_build_object(
          'type', 'low_stock_alert',
          'restaurant_id', ri.restaurant_id,
          'inventory_items', json_agg(
            json_build_object(
              'id', ri.id,
              'wine_name', mw.name,
              'current_stock', ri.stock_live,
              'threshold', ri.threshold_min
            )
          )
        )::text
      )
    FROM restaurant_inventory ri
    JOIN master_wine_library mw ON mw.id = ri.master_wine_id
    WHERE ri.stock_live <= ri.threshold_min
      AND ri.inventory_state = 'LIVE'
    GROUP BY ri.restaurant_id;
    $$
);

-- ============================================================================
-- 6. INVENTORY AUDIT REMINDERS (Weekly on Sundays at 6 PM)
-- ============================================================================

-- Schedule: Every Sunday at 6 PM UTC
SELECT cron.schedule(
    'inventory-audit-reminders',
    '0 18 * * 0',  -- Every Sunday at 6 PM UTC
    $$
    SELECT
      net.http_post(
        url := 'https://your-agent-orchestrator-url.com/api/v1/notifications/audit-reminder',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := json_build_object(
          'type', 'audit_reminder',
          'restaurant_id', r.id,
          'manager_id', r.owner_id,
          'last_audit', (
            SELECT MAX(created_at) 
            FROM inventory_audit_snapshots 
            WHERE restaurant_id = r.id
          )
        )::text
      )
    FROM restaurants r
    WHERE r.is_active = true;
    $$
);

-- ============================================================================
-- 7. PROVIDER PERFORMANCE REPORTS (Monthly on 15th at 10 AM)
-- ============================================================================

-- Schedule: 15th of every month at 10 AM UTC
SELECT cron.schedule(
    'provider-performance-reports',
    '0 10 15 * *',  -- 15th of every month at 10 AM UTC
    $$
    SELECT
      net.http_post(
        url := 'https://your-agent-orchestrator-url.com/api/v1/reports/provider-performance',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := json_build_object(
          'type', 'provider_performance_report',
          'restaurant_id', r.id,
          'month', EXTRACT(MONTH FROM NOW()),
          'year', EXTRACT(YEAR FROM NOW())
        )::text
      )
    FROM restaurants r
    WHERE r.is_active = true;
    $$
);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to manually trigger a report for testing
CREATE OR REPLACE FUNCTION trigger_report_generation(
    p_restaurant_id UUID,
    p_manager_id UUID,
    p_report_type TEXT DEFAULT 'comprehensive'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT net.http_post(
        url := 'https://your-agent-orchestrator-url.com/api/v1/reports/generate',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := json_build_object(
          'type', 'generate_on_demand_report',
          'restaurant_id', p_restaurant_id,
          'manager_id', p_manager_id,
          'report_type', p_report_type
        )::text
    ) INTO v_result;
    
    RETURN v_result;
END;
$$;

-- Function to check current cron jobs
CREATE OR REPLACE FUNCTION list_cron_jobs()
RETURNS TABLE (
    jobid BIGINT,
    schedule TEXT,
    command TEXT,
    nodename TEXT,
    nodeport INTEGER,
    database TEXT,
    username TEXT,
    active BOOLEAN
)
LANGUAGE SQL
AS $$
    SELECT * FROM cron.job;
$$;

-- Function to unschedule a cron job
CREATE OR REPLACE FUNCTION unschedule_cron_job(job_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM cron.unschedule(job_name);
    RETURN TRUE;
EXCEPTION
    WHEN OTHERS THEN
        RETURN FALSE;
END;
$$;

-- ============================================================================
-- USAGE EXAMPLES
-- ============================================================================

-- List all scheduled cron jobs
-- SELECT * FROM list_cron_jobs();

-- Manually trigger a report
-- SELECT trigger_report_generation(
--     'restaurant-uuid-here',
--     'manager-uuid-here',
--     'comprehensive'
-- );

-- Unschedule a job
-- SELECT unschedule_cron_job('daily-reports-check');

-- ============================================================================
-- MONITORING QUERIES
-- ============================================================================

-- Check last run times for all cron jobs
-- SELECT 
--     jobid,
--     jobname,
--     last_run_status,
--     last_run_start_time,
--     last_run_end_time
-- FROM cron.job_run_details
-- ORDER BY last_run_start_time DESC
-- LIMIT 20;

-- Check failed cron jobs
-- SELECT *
-- FROM cron.job_run_details
-- WHERE last_run_status = 'failed'
-- ORDER BY last_run_start_time DESC;

-- ============================================================================
-- NOTES
-- ============================================================================
-- 1. Replace 'https://your-agent-orchestrator-url.com' with your actual URL
-- 2. Ensure your Agent Orchestrator has the /api/v1/reports/generate endpoint
-- 3. Configure manager_preferences table with correct timezones
-- 4. Test with trigger_report_generation() before relying on cron
-- 5. Monitor cron.job_run_details for failures
-- 6. Adjust schedules based on your restaurant's needs
-- ============================================================================

