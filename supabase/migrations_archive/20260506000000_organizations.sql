-- Phase 26 ORG-01, ORG-02: organizations + organization_members tables
-- Per CONTEXT.md D-03: owner auto-created when first restaurant created; org is grouping only

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  owner_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'manager' CHECK (role IN ('owner', 'manager', 'staff')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invited_via UUID,
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- Organizations: owner can read/update their own org
CREATE POLICY "org_owner_access" ON organizations
  FOR ALL USING (owner_id::text = auth.uid()::text);

-- Members can read their own memberships
CREATE POLICY "org_members_read_own" ON organization_members
  FOR SELECT USING (user_id::text = auth.uid()::text);

-- Org owner can read all members of their org
CREATE POLICY "org_owner_read_members" ON organization_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM organizations
      WHERE organizations.id = organization_members.organization_id
      AND organizations.owner_id::text = auth.uid()::text
    )
  );

-- Org owner can insert members
CREATE POLICY "org_owner_insert_members" ON organization_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM organizations
      WHERE organizations.id = organization_members.organization_id
      AND organizations.owner_id::text = auth.uid()::text
    )
  );
