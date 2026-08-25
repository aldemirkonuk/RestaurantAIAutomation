-- ============================================================================
-- NOTIFICATIONS: BATCHING + CROSS-PAGE SYNC
-- ============================================================================
-- Activates the dormant notification-preference intent (grouping / digest /
-- quiet hours) and adds the two pieces of state the batching + sync engine
-- needs:
--   1. Per-preference columns that control instant-vs-batched behaviour.
--   2. `inventory_alert_state` — the edge-detection ledger. A reconciliation
--      sweep diffs the current low-stock set (v_low_stock_items) against this
--      table to tell a NEW threshold crossing (instant alert) apart from a wine
--      that is merely still-low (batched digest), and to throttle re-alerts.
--   3. `notifications.group_key` — lets a batched digest collapse into ONE
--      grouped inbox row instead of N, and lets producers de-duplicate.
--
-- Idempotent: safe to re-run. No destructive changes.

-- ----------------------------------------------------------------------------
-- 1. notification_preferences — instant / grouping / digest controls
-- ----------------------------------------------------------------------------
ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS low_stock_enabled            BOOLEAN     DEFAULT true,
    -- Edge-triggered: alert the moment a wine FIRST crosses below par.
    ADD COLUMN IF NOT EXISTS instant_first_alert          BOOLEAN     DEFAULT true,
    -- Coalesce a burst of simultaneous crossings into one email.
    ADD COLUMN IF NOT EXISTS alert_grouping_enabled       BOOLEAN     DEFAULT true,
    ADD COLUMN IF NOT EXISTS alert_grouping_window_minutes INTEGER    DEFAULT 15,
    -- Level-triggered reminder for wines that REMAIN low.
    ADD COLUMN IF NOT EXISTS digest_enabled               BOOLEAN     DEFAULT true,
    -- 'off' | 'rolling' | 'daily'  (rolling = every grouping window; daily = digest_time)
    ADD COLUMN IF NOT EXISTS digest_frequency             VARCHAR(20) DEFAULT 'daily',
    ADD COLUMN IF NOT EXISTS digest_time                  VARCHAR(10) DEFAULT '12:00',
    -- Critical (<=50% of par) bypasses the digest wait but is still grouped.
    ADD COLUMN IF NOT EXISTS critical_immediate           BOOLEAN     DEFAULT true,
    -- Orders / reports delivery mode: 'both' (in-app + email) | 'in_app' | 'off'.
    -- Default 'both' preserves today's behaviour (email + in-app both fire).
    ADD COLUMN IF NOT EXISTS orders_mode                  VARCHAR(20) DEFAULT 'both',
    ADD COLUMN IF NOT EXISTS reports_mode                 VARCHAR(20) DEFAULT 'both';

-- ----------------------------------------------------------------------------
-- 2. notifications.group_key — collapse batched alerts into one inbox row
-- ----------------------------------------------------------------------------
ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS group_key VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_notifications_group
    ON notifications(user_id, group_key, created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. inventory_alert_state — edge-detection ledger (per inventory row)
-- ----------------------------------------------------------------------------
-- Grain matches v_low_stock_items: one row per restaurant_inventory item.
-- last_alert_level tracks the tier the manager was last told about, so the
-- sweep only fires on OK->low, low->critical (escalation), etc. — never on a
-- steady-state "still low".
CREATE TABLE IF NOT EXISTS inventory_alert_state (
    restaurant_id   UUID        NOT NULL,
    inventory_id    UUID        NOT NULL,
    wine_name       TEXT,
    -- 'ok' | 'low' | 'critical'
    last_alert_level VARCHAR(20) NOT NULL DEFAULT 'ok',
    last_alerted_at TIMESTAMPTZ,
    -- last time this item was rolled into a digest (throttles the reminder)
    last_digest_at  TIMESTAMPTZ,
    alert_count     INTEGER     NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (restaurant_id, inventory_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_alert_state_restaurant
    ON inventory_alert_state(restaurant_id, last_alert_level);
