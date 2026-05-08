-- Phase 26 ONBOARD-04: custom email verification (NOT Supabase Auth SDK)
-- Per RESEARCH.md Finding 1: project uses custom auth, supabase.auth.signUp() not used
-- Path B only: invite path (Path A) skips verification
-- resend_count + last_resent_at enforce 1/min rate limit per D-05

CREATE TABLE IF NOT EXISTS email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  verified_at TIMESTAMPTZ,
  resend_count INTEGER NOT NULL DEFAULT 0,
  last_resent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verifications_token ON email_verifications(token);

ALTER TABLE email_verifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own verification record
CREATE POLICY "email_verif_read_own" ON email_verifications
  FOR SELECT USING (user_id::text = auth.uid()::text);

-- No client-side insert/update policy — all mutations via NestJS service role
