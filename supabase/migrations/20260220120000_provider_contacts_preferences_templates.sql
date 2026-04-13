-- =============================================================================
-- Migration: Provider Contacts, User Preferences, Communication Templates
-- Date: 2026-02-20
-- Description:
--   1. provider_contacts table for direct provider contact management
--   2. user_preferences table for JSONB user preference storage
--   3. communication_templates table for reusable email/SMS templates
--   4. Add last_contact_date/notes columns to providers
-- =============================================================================

-- =============================================================================
-- 1. PROVIDER CONTACTS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS provider_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    role VARCHAR(100),
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_contacts_provider ON provider_contacts(provider_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_contacts_primary
    ON provider_contacts(provider_id)
    WHERE is_primary = TRUE;

-- =============================================================================
-- 2. USER PREFERENCES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    preferences JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id);

-- =============================================================================
-- 3. COMMUNICATION TEMPLATES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS communication_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    subject VARCHAR(500),
    body TEXT NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'email',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comm_templates_restaurant ON communication_templates(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_comm_templates_type ON communication_templates(type);

-- =============================================================================
-- 4. ADD LAST CONTACT DATE COLUMNS TO PROVIDERS
-- =============================================================================

ALTER TABLE providers
    ADD COLUMN IF NOT EXISTS last_contact_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_contact_notes TEXT;

-- =============================================================================
-- 5. AUTO-UPDATE TRIGGERS
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'provider_contacts_updated_at') THEN
        CREATE TRIGGER provider_contacts_updated_at
            BEFORE UPDATE ON provider_contacts
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'user_preferences_updated_at') THEN
        CREATE TRIGGER user_preferences_updated_at
            BEFORE UPDATE ON user_preferences
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'communication_templates_updated_at') THEN
        CREATE TRIGGER communication_templates_updated_at
            BEFORE UPDATE ON communication_templates
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END$$;
