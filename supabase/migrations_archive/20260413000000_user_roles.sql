-- Phase 13 DEVUI-01: user_roles junction table for developer/certified_contributor/review_admin
-- Uses Supabase JWT app_metadata.roles claims for stateless role checks (no DB round-trip per request)
-- Trust tracking columns enable D-12: N=5 consecutive approved overrides → auto-promote policy

CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('developer', 'certified_contributor', 'review_admin')),
    granted_by UUID,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    consecutive_approved_overrides INT NOT NULL DEFAULT 0,
    promotion_policy TEXT NOT NULL DEFAULT 'queue'
        CHECK (promotion_policy IN ('queue', 'auto_promote')),
    auto_promote_earned_at TIMESTAMPTZ,
    UNIQUE (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);
CREATE INDEX IF NOT EXISTS idx_user_roles_active ON user_roles(user_id, role) WHERE revoked_at IS NULL;

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Users can read their own active roles
CREATE POLICY "users_read_own_roles" ON user_roles
    FOR SELECT USING (auth.uid() = user_id AND revoked_at IS NULL);

-- Only review_admins (via JWT claim) can insert/update/delete roles
-- Uses JWT claim instead of table self-reference to avoid RLS infinite recursion (Pitfall 1)
CREATE POLICY "review_admin_manage_roles" ON user_roles
    FOR ALL USING (
        (auth.jwt() -> 'app_metadata' -> 'roles') ? 'review_admin'
    );

-- Atomic increment for trust counter — prevents race conditions under concurrent approvals
CREATE OR REPLACE FUNCTION increment_trust_counter(p_user_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE user_roles
    SET consecutive_approved_overrides = consecutive_approved_overrides + 1
    WHERE user_id = p_user_id
      AND role = 'certified_contributor'
      AND revoked_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE user_roles IS 'Phase 13: Multi-role junction table. Supports developer, certified_contributor, review_admin roles with trust-level tracking for certified contributors (D-01, D-02, D-12).';
COMMENT ON COLUMN user_roles.consecutive_approved_overrides IS 'Consecutive approved overrides with no rejections. Resets to 0 on any rejection. At N=5 (configurable), promotion_policy flips to auto_promote (D-12).';
COMMENT ON COLUMN user_roles.promotion_policy IS 'queue = new certified_contributor goes through approval; auto_promote = overrides bypass queue after earning threshold (D-12, D-13).';
