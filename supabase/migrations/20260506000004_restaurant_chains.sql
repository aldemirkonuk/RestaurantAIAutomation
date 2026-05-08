-- Phase 26 CHAIN-01, CHAIN-02: restaurant_chains table + restaurants.chain_id FK
-- Per CONTEXT.md D-10: chains are OPTIONAL groupings within an organization
-- A restaurant owner can have:
--   - Multiple chains (e.g., "Joe's Pizza" chain with 3 locations)
--   - Standalone restaurants (chain_id IS NULL, e.g., "Maria's Tacos" standalone)
--   - Or both mixed within one organization

CREATE TABLE IF NOT EXISTS restaurant_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  cuisine_type VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_chains_org ON restaurant_chains(organization_id);

ALTER TABLE restaurant_chains ENABLE ROW LEVEL SECURITY;

-- Org members can read chains belonging to their organization
CREATE POLICY "chains_org_member_read" ON restaurant_chains
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = restaurant_chains.organization_id
      AND organization_members.user_id::text = auth.uid()::text
    )
  );

-- Only org owners can insert/update chains
CREATE POLICY "chains_org_owner_insert" ON restaurant_chains
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM organizations
      WHERE organizations.id = restaurant_chains.organization_id
      AND organizations.owner_id::text = auth.uid()::text
    )
  );

CREATE POLICY "chains_org_owner_update" ON restaurant_chains
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM organizations
      WHERE organizations.id = restaurant_chains.organization_id
      AND organizations.owner_id::text = auth.uid()::text
    )
  );

-- chain_id on restaurants is nullable: NULL = standalone restaurant, set = belongs to a chain
-- Must run AFTER 20260506000004 since restaurant_chains table is created here
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS chain_id UUID REFERENCES restaurant_chains(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_restaurants_chain ON restaurants(chain_id);
