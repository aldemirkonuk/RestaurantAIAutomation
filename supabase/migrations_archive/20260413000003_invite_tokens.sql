-- Phase 13 DEVUI-07, D-03: single-use invite tokens for role granting
-- Token is a UUID (128-bit random) — computationally infeasible to brute-force
-- Partial index on unused tokens keeps lookups fast as used tokens accumulate
-- Invite link uses path param /studio/invite/{token}, NOT query string (Pitfall 2)

CREATE TABLE IF NOT EXISTS invite_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    role TEXT NOT NULL CHECK (role IN ('developer', 'certified_contributor', 'review_admin')),
    created_by UUID NOT NULL,
    target_email TEXT,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    used_at TIMESTAMPTZ,
    used_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index: only index unused tokens for fast redemption lookups
CREATE INDEX IF NOT EXISTS idx_invite_tokens_token ON invite_tokens(token) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invite_tokens_created_by ON invite_tokens(created_by);

ALTER TABLE invite_tokens ENABLE ROW LEVEL SECURITY;

-- review_admins can read all tokens they created and any new ones
CREATE POLICY "invite_tokens_admin_all" ON invite_tokens
    FOR ALL USING (
        (auth.jwt() -> 'app_metadata' -> 'roles') ? 'review_admin'
    );

-- Any authenticated user can read a token by its token value (for redemption page)
-- Filtered to unused tokens only — once used, becomes invisible
CREATE POLICY "invite_tokens_read_for_redemption" ON invite_tokens
    FOR SELECT USING (
        used_at IS NULL
        AND expires_at > NOW()
    );

COMMENT ON TABLE invite_tokens IS 'Phase 13 DEVUI-07 D-03: Single-use role grant tokens. UUID token, 7-day expiry, used_at marks consumption. Redemption sets used_at and inserts into user_roles (D-03, D-04).';
