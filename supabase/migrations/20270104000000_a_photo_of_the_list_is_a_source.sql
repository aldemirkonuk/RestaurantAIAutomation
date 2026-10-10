-- A photo of a wine list is a studio source of its own (F-755).
--
-- The studio bar has always accepted images (apps/web/src/lib/uploadAccept.ts
-- SCAN_ACCEPT) and opened their session with source_type 'image_upload'
-- (apps/web/src/pages/studio/CommandBar.tsx). This CHECK, from the production
-- baseline (20260805000000), allowed only pdf_upload / url_crawl / manual_seed,
-- so every dropped photo failed before extraction ran. Recording a photo as
-- 'pdf_upload' instead would make the session say something untrue about its
-- source, so the vocabulary grows by one value.
--
-- Widening only: every existing row already satisfies the new list.

ALTER TABLE public.onboarding_sessions
  DROP CONSTRAINT IF EXISTS onboarding_sessions_source_type_check;

ALTER TABLE public.onboarding_sessions
  ADD CONSTRAINT onboarding_sessions_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'pdf_upload'::text, 'image_upload'::text, 'url_crawl'::text, 'manual_seed'::text
  ]));
