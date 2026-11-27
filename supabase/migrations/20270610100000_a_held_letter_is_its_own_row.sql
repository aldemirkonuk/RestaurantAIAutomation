-- A held letter is its own row (QA round 24, items 2 and 3).
--
-- Two kinds of inbound letter are now kept for a person and filed under no
-- vendor, in the receiving house's "Who is writing" list (the operator's when
-- no house is known):
--   * sender_unreadable: the From names no single unambiguous address, so the
--     bridge cannot say who wrote it. It used to be dropped with a log line.
--   * sender_unconfirmed: the receiving mail server said the letter did not
--     come from the domain in its From (dmarc=fail, or an aligned spf=fail
--     with no aligned dkim=pass). It used to be filed as that vendor's.
--
-- They live in email_prospects, the list the house already reads for mail
-- from senders it has not added, marked by held_reason. Prospect rows are one
-- per sender domain: a repeat folds into the row and overwrites its subject
-- and words. A held letter must not vanish under the next one, so held rows
-- are left out of both one-per-domain indexes and each letter is its own row
-- (idempotent on gmail_message_id in ProspectsService.holdLetter).
--
-- Additive: existing rows keep held_reason NULL and the indexes keep exactly
-- the rows they held before.

ALTER TABLE public.email_prospects
  ADD COLUMN IF NOT EXISTS held_reason text;

ALTER TABLE public.email_prospects
  DROP CONSTRAINT IF EXISTS email_prospects_held_reason_check;
ALTER TABLE public.email_prospects
  ADD CONSTRAINT email_prospects_held_reason_check
  CHECK (held_reason IS NULL OR held_reason IN ('sender_unreadable', 'sender_unconfirmed'));

COMMENT ON COLUMN public.email_prospects.held_reason IS
  'Set on a letter kept for a person and filed under no vendor: sender_unreadable (the From '
  'names no single address) or sender_unconfirmed (the receiving server said it did not come '
  'from its From''s domain). One row per letter; never promoted to a vendor. NULL for a '
  'prospect (one row per sender domain).';

DROP INDEX IF EXISTS public.uq_prospect_domain;
CREATE UNIQUE INDEX uq_prospect_domain
  ON public.email_prospects USING btree (restaurant_id, domain)
  WHERE (held_reason IS NULL);

DROP INDEX IF EXISTS public.uq_prospect_triage_domain;
CREATE UNIQUE INDEX uq_prospect_triage_domain
  ON public.email_prospects USING btree (domain)
  WHERE (restaurant_id IS NULL AND held_reason IS NULL);
