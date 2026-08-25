-- Phase 20: notification_deliveries table for NotificationAgent delivery tracking
-- HARD-03: delivery tracking + idempotency for NotificationAgent

CREATE TABLE IF NOT EXISTS notification_deliveries (
    notification_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id    UUID,
    event_id         TEXT        NOT NULL,
    channel          TEXT        NOT NULL CHECK (channel IN ('sms', 'email', 'slack')),
    status           TEXT        NOT NULL CHECK (status IN ('sent', 'failed', 'pending')) DEFAULT 'pending',
    delivered_at     TIMESTAMPTZ,
    error            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for idempotency lookups: check if (event_id, channel) already delivered
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_event_channel
    ON notification_deliveries (event_id, channel);

-- Index for querying deliveries by restaurant
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_restaurant
    ON notification_deliveries (restaurant_id, created_at DESC);

COMMENT ON TABLE notification_deliveries IS
    'Tracks every notification delivery attempt per event_id and channel. Used for idempotency and audit.';
