-- ============================================================================
-- NOTIFICATIONS CRUD TABLE
-- ============================================================================
-- Adds the `notifications` table for user-facing notification CRUD,
-- and extends `notification_preferences` with columns the frontend expects.

-- Main notifications table (user-facing inbox)
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    type VARCHAR(100) NOT NULL DEFAULT 'system',
    title VARCHAR(500) NOT NULL,
    message TEXT NOT NULL,
    priority VARCHAR(20) DEFAULT 'medium',
    status VARCHAR(20) DEFAULT 'unread',
    action_url TEXT,
    action_label VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    read_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure columns exist on pre-existing notifications table
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS restaurant_id UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type VARCHAR(100) NOT NULL DEFAULT 'system';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title VARCHAR(500) NOT NULL DEFAULT '';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'medium';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'unread';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_label VARCHAR(255);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_restaurant ON notifications(restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(user_id, status);

-- Extend notification_preferences with frontend-expected columns
ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS categories JSONB DEFAULT '{"inventory": true, "orders": true, "calendar": true, "system": true, "ai": true}',
    ADD COLUMN IF NOT EXISTS push_subscription JSONB;
