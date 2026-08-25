-- Phase 35: multi-provider OAuth linking for Profile
CREATE TABLE IF NOT EXISTS user_oauth_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL CHECK (provider IN ('google', 'microsoft')),
  provider_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_oauth_accounts_user
  ON user_oauth_accounts(user_id);

-- Backfill from legacy users.oauth_provider / oauth_id when present
INSERT INTO user_oauth_accounts (user_id, provider, provider_user_id)
SELECT user_id, oauth_provider, oauth_id
FROM users
WHERE oauth_provider IN ('google', 'microsoft')
  AND oauth_id IS NOT NULL
  AND oauth_id <> ''
ON CONFLICT DO NOTHING;
