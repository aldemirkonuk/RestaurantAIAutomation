-- Phase 33 URA-01: Activate user_restaurant_access as authoritative membership table
-- Per CONTEXT.md D-01: user_restaurant_access is the canonical restaurant membership source.
-- Per RESEARCH.md §5.1: add is_active, valid_from, valid_until, invited_via, deactivated_at, deactivated_by.
-- Backfill from users.restaurant_id (RESEARCH.md §6 Wave 2).
-- RLS: users read own rows; org owners read all rows for their restaurants.

-- ============================================================
-- 1. Extend schema
-- ============================================================

ALTER TABLE user_restaurant_access
  ADD COLUMN IF NOT EXISTS is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS valid_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS valid_until     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invited_via     UUID REFERENCES organization_invites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deactivated_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_by  UUID REFERENCES users(user_id) ON DELETE SET NULL;

-- ============================================================
-- 2. Indexes for hot-path queries
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_ura_restaurant_active
  ON user_restaurant_access(restaurant_id, is_active)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_ura_user_active
  ON user_restaurant_access(user_id, is_active)
  WHERE is_active = TRUE;

-- ============================================================
-- 3. Backfill existing users (idempotent — ON CONFLICT DO NOTHING)
-- ============================================================

INSERT INTO user_restaurant_access (user_id, restaurant_id, role, is_active)
SELECT
  user_id,
  restaurant_id,
  COALESCE(role, 'manager'),
  TRUE
FROM users
WHERE restaurant_id IS NOT NULL
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

-- ============================================================
-- 4. RLS
-- ============================================================

ALTER TABLE user_restaurant_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ura_read_own" ON user_restaurant_access;
CREATE POLICY "ura_read_own" ON user_restaurant_access
  FOR SELECT USING (user_id::text = auth.uid()::text);

DROP POLICY IF EXISTS "ura_org_owner_read" ON user_restaurant_access;
CREATE POLICY "ura_org_owner_read" ON user_restaurant_access
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM restaurants r
      JOIN organizations o ON o.id = r.organization_id
      WHERE r.id = user_restaurant_access.restaurant_id
        AND o.owner_id::text = auth.uid()::text
    )
  );
