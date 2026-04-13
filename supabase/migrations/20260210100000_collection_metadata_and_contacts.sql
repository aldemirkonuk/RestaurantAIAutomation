-- =============================================================================
-- Migration: Collection Metadata + Contacts/Contact Addresses
-- Date: 2026-02-10
-- Description: 
--   1. collection_metadata table for training image dataset tracking
--   2. contacts + contact_addresses tables for scalable contact directory
--   3. Data migration for existing provider/user contacts
-- =============================================================================

-- Enable pg_trgm for fuzzy/trigram search on contact names
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================================================
-- 1. COLLECTION METADATA TABLE (Stream 1: Image Collection Pipeline)
-- =============================================================================

CREATE TABLE IF NOT EXISTS collection_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(50) NOT NULL,                -- 'manual', 'google_places', 'opentable', 'yelp', 'vivino', 'web'
    category VARCHAR(50) NOT NULL,              -- 'menu', 'label', 'invoice'
    image_url TEXT,                             -- Original source URL (nullable for uploads)
    storage_path TEXT NOT NULL,                 -- Supabase Storage path
    perceptual_hash VARCHAR(64),               -- dHash for deduplication
    dimensions JSONB,                          -- {width, height}
    file_size_bytes INTEGER,
    restaurant_name VARCHAR(255),
    collected_at TIMESTAMPTZ DEFAULT NOW(),
    annotated BOOLEAN DEFAULT FALSE,
    annotation_path TEXT                        -- Path to YOLO annotation file
);

CREATE INDEX IF NOT EXISTS idx_collection_hash ON collection_metadata(perceptual_hash);
CREATE INDEX IF NOT EXISTS idx_collection_source ON collection_metadata(source);
CREATE INDEX IF NOT EXISTS idx_collection_category ON collection_metadata(category);
CREATE INDEX IF NOT EXISTS idx_collection_annotated ON collection_metadata(annotated) WHERE annotated = FALSE;


-- =============================================================================
-- 2. CONTACTS TABLE (Stream 3: Scalable Contact Directory)
-- =============================================================================

CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50) NOT NULL,                  -- 'provider', 'staff', 'manager', 'customer', 'sommelier'
    display_name VARCHAR(255) NOT NULL,
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE SET NULL,  -- NULL = global/shared contact
    linked_user_id UUID,                        -- FK to users if this contact is an internal user
    linked_provider_id UUID,                    -- FK to providers if this contact is a supplier
    is_active BOOLEAN DEFAULT TRUE,
    metadata JSONB DEFAULT '{}',                -- role, title, department, notes, etc.
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance indexes for millions of records
CREATE INDEX IF NOT EXISTS idx_contacts_restaurant ON contacts(restaurant_id) WHERE restaurant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_type ON contacts(type);
CREATE INDEX IF NOT EXISTS idx_contacts_name_trgm ON contacts USING gin(display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_linked_provider ON contacts(linked_provider_id) WHERE linked_provider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_linked_user ON contacts(linked_user_id) WHERE linked_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_active ON contacts(is_active) WHERE is_active = TRUE;

-- Composite index for common query pattern: type + restaurant
CREATE INDEX IF NOT EXISTS idx_contacts_type_restaurant ON contacts(type, restaurant_id);


-- =============================================================================
-- 3. CONTACT ADDRESSES TABLE (N-channel flexible addresses)
-- =============================================================================

CREATE TABLE IF NOT EXISTS contact_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    channel VARCHAR(50) NOT NULL,               -- 'email', 'phone', 'whatsapp', 'fax', 'linkedin', 'custom'
    address_value TEXT NOT NULL,                 -- The actual email address, phone number, etc.
    label VARCHAR(50) DEFAULT 'work',           -- 'work', 'personal', 'main', 'billing'
    is_primary BOOLEAN DEFAULT FALSE,
    is_verified BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}',                -- country_code, extension, custom channel name
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_addresses_contact ON contact_addresses(contact_id);
CREATE INDEX IF NOT EXISTS idx_addresses_channel ON contact_addresses(channel);
CREATE INDEX IF NOT EXISTS idx_addresses_value ON contact_addresses(address_value);
CREATE INDEX IF NOT EXISTS idx_addresses_primary ON contact_addresses(contact_id, is_primary) WHERE is_primary = TRUE;

-- Ensure only one primary address per channel per contact
CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_unique_primary
    ON contact_addresses(contact_id, channel)
    WHERE is_primary = TRUE;


-- =============================================================================
-- 4. RESTAURANT BRANDING TABLE (Stream 2: Hybrid Template Branding)
-- =============================================================================

CREATE TABLE IF NOT EXISTS restaurant_branding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    logo_url TEXT,
    primary_color VARCHAR(7) DEFAULT '#7c2d12',   -- Hex color
    secondary_color VARCHAR(7),
    display_name VARCHAR(255),                      -- Override for email templates
    tagline VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(restaurant_id)
);


-- =============================================================================
-- 5. CUSTOM REMINDERS TABLE (Stream 2: Ad-hoc reminders)
-- =============================================================================

CREATE TABLE IF NOT EXISTS custom_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    created_by UUID,                               -- User who created the reminder
    title VARCHAR(255) NOT NULL,
    description TEXT,
    reminder_type VARCHAR(50) DEFAULT 'custom',    -- 'custom', 'wine_tasting', 'license_renewal', etc.
    schedule_cron VARCHAR(100),                    -- Cron expression for recurring
    next_fire_at TIMESTAMPTZ,                      -- Next time this reminder should fire
    last_fired_at TIMESTAMPTZ,
    recipient_roles TEXT[] DEFAULT ARRAY['manager'],
    recipient_emails TEXT[],                       -- Override: send to these emails directly
    is_recurring BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_restaurant ON custom_reminders(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_reminders_next_fire ON custom_reminders(next_fire_at) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_reminders_type ON custom_reminders(reminder_type);


-- =============================================================================
-- 6. DATA MIGRATION: Existing provider contacts -> contacts + contact_addresses
-- =============================================================================

-- Ensure providers has the columns this migration reads
ALTER TABLE providers ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50);

-- Ensure users has the columns this migration reads
ALTER TABLE users ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);

-- Migrate providers with contact_email or contact_phone to the new contacts system
INSERT INTO contacts (type, display_name, restaurant_id, linked_provider_id, is_active, metadata)
SELECT
    'provider',
    p.name,
    p.restaurant_id,
    p.id,
    p.is_active,
    jsonb_build_object('migrated_from', 'providers', 'migrated_at', NOW()::text)
FROM providers p
WHERE (p.contact_email IS NOT NULL OR p.contact_phone IS NOT NULL)
  AND NOT EXISTS (
      SELECT 1 FROM contacts c WHERE c.linked_provider_id = p.id
  )
ON CONFLICT DO NOTHING;

-- Migrate provider email addresses
INSERT INTO contact_addresses (contact_id, channel, address_value, label, is_primary)
SELECT
    c.id,
    'email',
    p.contact_email,
    'work',
    TRUE
FROM providers p
JOIN contacts c ON c.linked_provider_id = p.id
WHERE p.contact_email IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM contact_addresses ca
      WHERE ca.contact_id = c.id AND ca.channel = 'email' AND ca.address_value = p.contact_email
  )
ON CONFLICT DO NOTHING;

-- Migrate provider phone numbers
INSERT INTO contact_addresses (contact_id, channel, address_value, label, is_primary)
SELECT
    c.id,
    'phone',
    p.contact_phone,
    'work',
    TRUE
FROM providers p
JOIN contacts c ON c.linked_provider_id = p.id
WHERE p.contact_phone IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM contact_addresses ca
      WHERE ca.contact_id = c.id AND ca.channel = 'phone' AND ca.address_value = p.contact_phone
  )
ON CONFLICT DO NOTHING;

-- Migrate users to contacts
INSERT INTO contacts (type, display_name, restaurant_id, linked_user_id, is_active, metadata)
SELECT
    COALESCE(u.role, 'manager'),
    COALESCE(u.name, u.email),
    u.restaurant_id,
    u.user_id,
    TRUE,
    jsonb_build_object('migrated_from', 'users', 'role', u.role, 'migrated_at', NOW()::text)
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM contacts c WHERE c.linked_user_id = u.user_id
)
ON CONFLICT DO NOTHING;

-- Migrate user emails
INSERT INTO contact_addresses (contact_id, channel, address_value, label, is_primary)
SELECT
    c.id,
    'email',
    u.email,
    'work',
    TRUE
FROM users u
JOIN contacts c ON c.linked_user_id = u.user_id
WHERE u.email IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM contact_addresses ca
      WHERE ca.contact_id = c.id AND ca.channel = 'email' AND ca.address_value = u.email
  )
ON CONFLICT DO NOTHING;

-- Migrate user phones
INSERT INTO contact_addresses (contact_id, channel, address_value, label, is_primary)
SELECT
    c.id,
    'phone',
    u.phone,
    'work',
    TRUE
FROM users u
JOIN contacts c ON c.linked_user_id = u.user_id
WHERE u.phone IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM contact_addresses ca
      WHERE ca.contact_id = c.id AND ca.channel = 'phone' AND ca.address_value = u.phone
  )
ON CONFLICT DO NOTHING;


-- =============================================================================
-- 7. AUTO-UPDATE updated_at TRIGGERS
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'contacts_updated_at') THEN
        CREATE TRIGGER contacts_updated_at
            BEFORE UPDATE ON contacts
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'restaurant_branding_updated_at') THEN
        CREATE TRIGGER restaurant_branding_updated_at
            BEFORE UPDATE ON restaurant_branding
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'custom_reminders_updated_at') THEN
        CREATE TRIGGER custom_reminders_updated_at
            BEFORE UPDATE ON custom_reminders
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END$$;
