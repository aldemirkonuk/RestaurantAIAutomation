-- =============================================================================
-- Phase 24: notification_preferences — digest toggle columns (D-05)
-- =============================================================================
-- Adds 5 columns that control the daily digest email feature:
--   digest_enabled        — master on/off switch (default: true)
--   digest_promos_enabled — include vendor promotion highlights
--   digest_stalled_threads_enabled — include stalled conversation alerts
--   digest_procurement_gaps_enabled — include procurement gap warnings
--   digest_send_hour      — hour of day (0–23) to send digest (default: 8am)
-- =============================================================================

ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS digest_enabled BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS digest_promos_enabled BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS digest_stalled_threads_enabled BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS digest_procurement_gaps_enabled BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS digest_send_hour INTEGER DEFAULT 8 CHECK (digest_send_hour BETWEEN 0 AND 23);

-- Verify defaults: SELECT digest_enabled, digest_send_hour FROM notification_preferences LIMIT 1;
-- Expected: digest_enabled=true, digest_send_hour=8
