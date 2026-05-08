-- Phase 26: Extend restaurants table for branch switcher (D-06) + Path B form
-- Add city (required for branch switcher display per D-06)
-- Add phone (required for Path B restaurant form per CONTEXT.md specifics)
-- Add organization_id FK (required for GET /organizations/branches JOIN)
-- Add email_verified to users (required for Path B email verification gating per RESEARCH Pitfall 6)

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_restaurants_org ON restaurants(organization_id);

-- email_verified on users: Path B users start as false; set to true after email verification
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
