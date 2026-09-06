-- ADR 0044 p4 wave — seven more per-page Mudavym design flags.
--
-- Same shape as 20260831090000_mudavym_design_flags.sql: booleans on the
-- reserved 'restaurant_settings' row, NOT NULL DEFAULT false. That migration is
-- already applied in production, so it is NOT widened in place (a version
-- mismatch makes a file look ownerless — see the schema-parity memory); the
-- seven new columns get their own file. settings.service.ts joins every ACTIVE
-- registry key into its .select(), so a key promoted to ACTIVE without a
-- column 42703s the whole Settings read — the registry and this file land in
-- the same PR for that reason.
--
-- OFF is the founder-reviewed default for every page (ADR 0044 §2); a
-- restaurant gets a redesigned page only by deliberately opting in.

ALTER TABLE public.restaurant_feature_flags
  ADD COLUMN IF NOT EXISTS mudavym_design_reports boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mudavym_design_notifications boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mudavym_design_recommendations boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mudavym_design_calendar boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mudavym_design_settings boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mudavym_design_profile boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mudavym_design_cellar boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_reports IS
  'On the ''restaurant_settings'' row only. TRUE renders the Mudavym redesign of `/reports` (ADR 0044 p4 wave, MERGE verdict — today''s drag-to-rearrange canvas back, more graphs, insights + reports focus). FALSE (default) renders the legacy page.';
COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_notifications IS
  'On the ''restaurant_settings'' row only. TRUE renders the Mudavym redesign of `/notifications` (ADR 0044 p4 wave, REWORK verdict — density of what is happening, handled items subdued). FALSE (default) renders the legacy page.';
COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_recommendations IS
  'On the ''restaurant_settings'' row only. TRUE renders the Mudavym redesign of `/recommendations` (ADR 0044 p4 wave, REWORK verdict — "more structure and uniqueness"; also the first authenticated build of the page). FALSE (default) renders the legacy page.';
COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_calendar IS
  'On the ''restaurant_settings'' row only. TRUE renders the Mudavym redesign of `/calendar` (ADR 0044 p4 wave, KEEP verdict — the one page the founder named as unreservedly liked). FALSE (default) renders the legacy page.';
COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_settings IS
  'On the ''restaurant_settings'' row only. TRUE renders the Mudavym redesign of `/settings` (ADR 0044 p4 wave, KEEP Editorial + "there should be more"). FALSE (default) renders the legacy page.';
COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_profile IS
  'On the ''restaurant_settings'' row only. TRUE renders the Mudavym redesign of `/profile` (ADR 0044 p4 wave, KEEP+ — MCPs, linked accounts and payments as first-class sections, honest about what is not yet connected). FALSE (default) renders the legacy page.';
COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_cellar IS
  'On the ''restaurant_settings'' row only. TRUE renders the Mudavym `/cellar` parent surface and its `/wines` `/beer` `/whiskey` `/cocktails` children (ADR 0044 p4 wave; IA decided 2026-08-30, the crowded redesign rejected — "more character", keep "see everything"). FALSE (default) renders the legacy page.';
