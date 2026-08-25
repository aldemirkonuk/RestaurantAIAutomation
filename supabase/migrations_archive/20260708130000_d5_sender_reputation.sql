-- D5: per-domain sender reputation — manager trust (bypasses the SPF/DKIM quarantine),
-- spam/injection signals, auto-suspend, and a score that feeds D4 priority.
-- Applied live via the Supabase MCP on 2026-07-08; committed here for parity.
CREATE TABLE IF NOT EXISTS public.sender_reputation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL,
  domain TEXT NOT NULL,
  provider_id UUID,
  trusted BOOLEAN NOT NULL DEFAULT FALSE,
  trusted_at TIMESTAMPTZ,
  suspended BOOLEAN NOT NULL DEFAULT FALSE,
  suspended_reason TEXT,
  suspended_at TIMESTAMPTZ,
  injection_signals INT NOT NULL DEFAULT 0,
  spam_signals INT NOT NULL DEFAULT 0,
  bounce_signals INT NOT NULL DEFAULT 0,
  completed_orders INT NOT NULL DEFAULT 0,
  last_signal_at TIMESTAMPTZ,
  score REAL NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sender_rep_domain ON public.sender_reputation(restaurant_id, domain);
CREATE INDEX IF NOT EXISTS idx_sender_rep_restaurant ON public.sender_reputation(restaurant_id);

-- Server-only (service-role bypasses RLS).
ALTER TABLE public.sender_reputation ENABLE ROW LEVEL SECURITY;
