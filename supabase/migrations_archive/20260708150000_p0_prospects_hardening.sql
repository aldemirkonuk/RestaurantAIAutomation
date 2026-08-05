-- Phase 0 — Prospects attribution hardening (correctness + safety + UX enablement).
-- See .planning/PROSPECTS_ATTRIBUTION_ARCHITECTURE.md. No attribution-infra dependency.
--
-- 1) Interim safety: allow an "unattributed / triage" prospect (restaurant_id IS NULL) so a
--    genuinely ambiguous cold email (multi-restaurant, no default) is PERSISTED + recoverable
--    instead of silently dropped OR leaked into a tenant's view. Tenant-scoped reads filter by
--    restaurant_id and therefore never return these rows.
-- 2) Provenance + source enablement: capture_reason, attachments, gmail ids, body_preview.
-- 3) Idempotency: index on gmail_message_id (cold path had no replay guard).
-- 4) Promote correctness: a partial UNIQUE(restaurant_id, lower(contact_email)) on providers so a
--    (mis)repeated promote can't manufacture duplicate provider rows.

-- ── email_prospects ────────────────────────────────────────────────────────────
ALTER TABLE public.email_prospects
  ALTER COLUMN restaurant_id DROP NOT NULL;

ALTER TABLE public.email_prospects
  ADD COLUMN IF NOT EXISTS capture_reason   TEXT,
  ADD COLUMN IF NOT EXISTS attachments      JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS gmail_message_id TEXT,
  ADD COLUMN IF NOT EXISTS gmail_thread_id  TEXT,
  ADD COLUMN IF NOT EXISTS body_preview     TEXT;

-- Dedup the triage bucket by domain (the composite uq_prospect_domain doesn't dedup NULLs).
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_triage_domain
  ON public.email_prospects(domain)
  WHERE restaurant_id IS NULL;

-- Cheap replay guard / lookup for the cold path.
CREATE INDEX IF NOT EXISTS idx_prospect_gmail_msg
  ON public.email_prospects(gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;

-- ── providers: prevent duplicate vendors from repeated promotes ──────────────────
-- Partial + case-insensitive on live (non-deleted) rows with a real email. Wrapped so a
-- pre-existing duplicate (none found at authoring time) degrades to a NOTICE instead of
-- failing the whole migration.
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_providers_restaurant_email
    ON public.providers(restaurant_id, lower(contact_email))
    WHERE contact_email IS NOT NULL AND contact_email <> '' AND deleted_at IS NULL;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'uq_providers_restaurant_email not created: duplicate (restaurant_id, contact_email) rows exist — dedupe them, then re-run.';
END $$;
