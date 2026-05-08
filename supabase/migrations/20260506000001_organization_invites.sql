-- Phase 26 ORG-03: organization_invites table
-- Per D-04: 8-char alphanumeric code, single-use (marked used_at), expires 7 days
-- Atomic consumption: UPDATE WHERE used_at IS NULL — no TOCTOU race condition

CREATE TABLE IF NOT EXISTS organization_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  code CHAR(8) NOT NULL,
  invited_by UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'manager' CHECK (role IN ('owner', 'manager', 'staff')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  used_at TIMESTAMPTZ,
  used_by_email VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Critical: code must be globally unique (prevents collisions across orgs)
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_invites_code ON organization_invites(code);
CREATE INDEX IF NOT EXISTS idx_org_invites_org ON organization_invites(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_restaurant ON organization_invites(restaurant_id);

ALTER TABLE organization_invites ENABLE ROW LEVEL SECURITY;

-- Anyone can read invite records (needed for GET /auth/invite/:code validation — public endpoint)
CREATE POLICY "org_invites_public_read" ON organization_invites
  FOR SELECT USING (true);

-- Only the invite creator can insert
CREATE POLICY "org_invites_owner_insert" ON organization_invites
  FOR INSERT WITH CHECK (invited_by::text = auth.uid()::text);

-- No client-side UPDATE policy: used_at updates happen via NestJS service role (bypasses RLS)
-- This prevents any client from self-marking an invite as used
