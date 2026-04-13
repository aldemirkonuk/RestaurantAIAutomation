-- ============================================================================
-- Enable Real-Time Subscriptions for Key Tables
-- ============================================================================
-- 
-- Real-time allows your frontend to receive instant updates when data changes.
-- Supabase uses PostgreSQL's logical replication (publication/subscription).
--
-- IMPORTANT: In Supabase, you can also enable real-time via:
-- Dashboard: Database → Replication → Toggle tables ON/OFF
--
-- ============================================================================

-- ============================================================================
-- Core Operational Tables (High Priority)
-- ============================================================================
-- These tables change frequently and need live updates in your UI

ALTER PUBLICATION supabase_realtime ADD TABLE restaurant_inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE sales_events;
ALTER PUBLICATION supabase_realtime ADD TABLE procurement_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE calendar_events;

-- ============================================================================
-- Configuration Tables (Medium Priority)
-- ============================================================================
-- Enable if you want live UI updates when restaurants/providers change

ALTER PUBLICATION supabase_realtime ADD TABLE restaurants;
ALTER PUBLICATION supabase_realtime ADD TABLE providers;
ALTER PUBLICATION supabase_realtime ADD TABLE master_wine_library;
ALTER PUBLICATION supabase_realtime ADD TABLE restaurant_providers;

-- ============================================================================
-- Optional: Additional Tables (Enable as needed)
-- ============================================================================

-- Procurement & Conversations
-- ALTER PUBLICATION supabase_realtime ADD TABLE procurement_conversations;

-- Reports & Profiles
-- ALTER PUBLICATION supabase_realtime ADD TABLE generated_reports;
-- ALTER PUBLICATION supabase_realtime ADD TABLE manager_report_profiles;

-- System Tables (usually don't need real-time)
-- ALTER PUBLICATION supabase_realtime ADD TABLE agent_activity_logs;
-- ALTER PUBLICATION supabase_realtime ADD TABLE system_audit_log;

-- ============================================================================
-- VERIFICATION: Check which tables are enabled for real-time
-- ============================================================================

SELECT 
    schemaname,
    tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- ============================================================================
-- HOW TO USE IN YOUR FRONTEND
-- ============================================================================
-- 
-- Example JavaScript/TypeScript:
--
-- import { createClient } from '@supabase/supabase-js'
-- const supabase = createClient(url, key)
--
-- // Listen to inventory changes
-- const channel = supabase
--   .channel('inventory-changes')
--   .on('postgres_changes', 
--     { 
--       event: '*',  // INSERT, UPDATE, DELETE
--       schema: 'public', 
--       table: 'restaurant_inventory',
--       filter: 'restaurant_id=eq.YOUR_RESTAURANT_ID'  // Optional filter
--     },
--     (payload) => {
--       console.log('Change received!', payload)
--       // Update your UI here
--     }
--   )
--   .subscribe()
--
-- // Listen to sales events
-- const salesChannel = supabase
--   .channel('sales-events')
--   .on('postgres_changes',
--     { event: 'INSERT', schema: 'public', table: 'sales_events' },
--     (payload) => {
--       console.log('New sale!', payload.new)
--     }
--   )
--   .subscribe()
--
-- // Clean up when done
-- // supabase.removeChannel(channel)
--
-- ============================================================================
-- TO DISABLE REAL-TIME (if needed)
-- ============================================================================
--
-- ALTER PUBLICATION supabase_realtime DROP TABLE restaurant_inventory;
-- ALTER PUBLICATION supabase_realtime DROP TABLE sales_events;
-- (etc.)
--
-- ============================================================================

