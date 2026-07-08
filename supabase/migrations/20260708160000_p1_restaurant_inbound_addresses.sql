-- Phase 1 — dedicated-domain inbound foundation.
-- See .planning/PROSPECTS_ATTRIBUTION_ARCHITECTURE.md §5 (Phase 1) / §2.
--
-- Each restaurant gets a unique, opaque inbound address (r-<token>@INBOUND_EMAIL_DOMAIN).
-- A provider-agnostic inbound-parse webhook resolves the recipient address -> restaurant_id,
-- so cold-email attribution is DERIVED from transport (the address the vendor emailed) instead
-- of guessed. Entirely additive + config-gated: with no INBOUND_EMAIL_DOMAIN set the app never
-- touches this table and the legacy shared-Gmail path is unaffected (dual-run).

CREATE TABLE IF NOT EXISTS public.restaurant_inbound_addresses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  address       TEXT NOT NULL,               -- full inbound address, stored lowercased
  token         TEXT NOT NULL,               -- opaque local-part token (e.g. r-7f3a9c)
  provider      TEXT,                         -- postmark | ses | mailgun | cloudflare | ...
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- One address maps to exactly one restaurant (case-insensitive); tokens are globally unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound_address ON public.restaurant_inbound_addresses(lower(address));
CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound_token   ON public.restaurant_inbound_addresses(token);
-- Fast "the active address for this restaurant" lookup.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound_active_restaurant
  ON public.restaurant_inbound_addresses(restaurant_id)
  WHERE is_active;

-- Server-only (service-role bypasses RLS); resolution happens in the webhook, never client-side.
ALTER TABLE public.restaurant_inbound_addresses ENABLE ROW LEVEL SECURITY;
