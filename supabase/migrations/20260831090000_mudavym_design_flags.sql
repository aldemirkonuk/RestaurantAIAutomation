-- ADR 0045 §5 / ADR 0044 — make the Mudavym per-page design flags storable.
--
-- The registry (feature-flag-registry.ts) promoted nine mudavym_design_*
-- flags to ACTIVE, and settings.service.ts joins every ACTIVE key into its
-- .select() — but no migration ever added the columns (found by the Opus
-- correctness review, 2026-08-31). PostgREST answers a missing column with
-- 42703, so getFeatureFlags() threw for every restaurant: the Settings read
-- 500s and no flag can be flipped ON. Flag-off safety held only through the
-- web gate's catch-to-false. Pre-existing since ADR 0044 P1 (four columns),
-- widened to nine by the P3 wave; fixed once here for all nine.
--
-- Same shape as OD-86's columns: booleans on the reserved
-- 'restaurant_settings' row, NOT NULL DEFAULT false — OFF is the founder-
-- reviewed default for every page (ADR 0044 §2), and a restaurant gets a
-- redesigned page only by deliberately opting in.

ALTER TABLE public.restaurant_feature_flags
  ADD COLUMN IF NOT EXISTS mudavym_design_dashboard boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mudavym_design_orders boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mudavym_design_receiving boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mudavym_design_receiving_door boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mudavym_design_providers boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mudavym_design_communications boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mudavym_design_team boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mudavym_design_inventory boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mudavym_design_receipts boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_dashboard IS
  'On the ''restaurant_settings'' row only. TRUE renders the Mudavym redesign of / for this restaurant (ADR 0044); FALSE (default) renders the legacy page.';
COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_orders IS
  'On the ''restaurant_settings'' row only. Mudavym redesign of /orders (ADR 0044).';
COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_receiving IS
  'On the ''restaurant_settings'' row only. Mudavym redesign of /receiving (ADR 0044 P2).';
COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_receiving_door IS
  'On the ''restaurant_settings'' row only. Mudavym redesign of the door flow (ADR 0044 P2).';
COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_providers IS
  'On the ''restaurant_settings'' row only. Mudavym redesign of /providers (ADR 0045 §5).';
COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_communications IS
  'On the ''restaurant_settings'' row only. Mudavym redesign of /communications (ADR 0045 §5).';
COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_team IS
  'On the ''restaurant_settings'' row only. Mudavym redesign of /team (ADR 0045 §5).';
COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_inventory IS
  'On the ''restaurant_settings'' row only. NOT a page swap: gates the ReceiptDepth card inside the kept /inventory dropdown (ADR 0045 §5).';
COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_receipts IS
  'On the ''restaurant_settings'' row only. Mudavym redesign of /receipts (ADR 0045 §5).';
