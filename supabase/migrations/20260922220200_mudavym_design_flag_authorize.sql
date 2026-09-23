-- Both presentations use the same sealed gateway protocol. This flag changes
-- the page presentation, never permission enforcement or callback protection.
ALTER TABLE public.restaurant_feature_flags
  ADD COLUMN IF NOT EXISTS mudavym_design_authorize_integration boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_authorize_integration IS
  'ADR 0144. Consent ceremony with verbatim server words and retention facts. The server seal and browser binding also protect the legacy page.';
