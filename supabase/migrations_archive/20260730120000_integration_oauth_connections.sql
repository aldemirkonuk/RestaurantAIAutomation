-- Third-party integration authorization (Google Drive, Microsoft Excel/OneDrive).
--
-- Distinct from user_oauth_accounts, which only proves identity for sign-in.
-- These rows carry *delegated API access*: scoped grants plus refresh tokens
-- used to call Drive/Graph on the user's behalf long after they close the tab.
-- Tokens are stored encrypted by the app (AES-256-GCM); the column names say
-- so to make an unencrypted write obvious in review.

CREATE TABLE IF NOT EXISTS integration_oauth_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL CHECK (provider IN ('google', 'microsoft')),
  -- Which product the grant is for; a user may connect Drive but not Excel.
  integration_id VARCHAR(64) NOT NULL,
  account_email TEXT,
  -- Exactly what the user consented to, so the UI can show it back to them
  -- and we can detect when a required scope was declined.
  scopes TEXT[] NOT NULL DEFAULT '{}',
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Soft revoke: keeps an audit trail of grants that once existed.
  revoked_at TIMESTAMPTZ,
  UNIQUE (user_id, integration_id)
);

CREATE INDEX IF NOT EXISTS idx_integration_oauth_conn_user
  ON integration_oauth_connections (user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_integration_oauth_conn_restaurant
  ON integration_oauth_connections (restaurant_id)
  WHERE revoked_at IS NULL;

-- Short-lived CSRF state for the authorization redirect.
--
-- Deliberately a table rather than the Redis cache: a dropped cache would
-- silently turn into "every callback fails state validation", and the volume
-- here is a few rows per user per month.
CREATE TABLE IF NOT EXISTS integration_oauth_states (
  state TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  restaurant_id UUID,
  provider VARCHAR(50) NOT NULL CHECK (provider IN ('google', 'microsoft')),
  integration_id VARCHAR(64) NOT NULL,
  -- Where to send the browser once the handshake finishes.
  return_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_integration_oauth_states_expiry
  ON integration_oauth_states (expires_at);

COMMENT ON TABLE integration_oauth_connections IS
  'Delegated third-party API grants (Drive, Excel). Tokens are AES-256-GCM encrypted by the API gateway.';
COMMENT ON TABLE integration_oauth_states IS
  'Single-use CSRF state for integration OAuth redirects; rows expire after 10 minutes.';
