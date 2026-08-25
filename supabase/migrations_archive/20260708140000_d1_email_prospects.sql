-- D1: cold-email "Prospects" lane — a content-gated capture of genuine unknown-sender
-- vendor outreach (intros, catalogues, wine offers) that the provider lookup used to drop.
-- Digest-only, deduped by domain, never auto-replied; one-tap "Promote to vendor" creates
-- a real provider. Pure marketing-list blasts (bulk/list transport) are NOT leaded.
CREATE TABLE IF NOT EXISTS public.email_prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL,
  domain TEXT NOT NULL,
  sender_email TEXT,
  sender_name TEXT,
  subject TEXT,
  snippet TEXT,
  has_attachments BOOLEAN NOT NULL DEFAULT FALSE,
  message_count INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'new',        -- new | promoted | dismissed
  promoted_provider_id UUID,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_domain ON public.email_prospects(restaurant_id, domain);
CREATE INDEX IF NOT EXISTS idx_prospect_restaurant_status ON public.email_prospects(restaurant_id, status);

-- Server-only (service-role bypasses RLS).
ALTER TABLE public.email_prospects ENABLE ROW LEVEL SECURITY;
