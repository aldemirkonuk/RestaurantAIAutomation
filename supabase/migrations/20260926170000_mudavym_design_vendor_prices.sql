-- ADR 0160 §112 (vendor-prices direction A) + the founder's 2026-09-19
-- ~09:20Z lane-blocking answer (memory founder-sketch-decisions-106-115.md,
-- "19-lane blocking answers (AskUserQuestion, 2026-09-19 ~09:20Z)"):
-- "vendor-prices = behind a flag (vendor_prices mudavym_design_* column
-- migration, he flips it; NOT live on merge)".
--
-- [Repair pass, wt-pg-vprices, 2026-09-19] This SUPERSEDES a same-day, less
-- specific 2026-09-18 brief that had told this lane to route `/vendor-prices`
-- straight to the Mudavym rebuild for every house with no PageGate (App.tsx's
-- route comment and this page's own dossier said so, and the route shipped
-- that way in this lane's first round). The founder's later, more specific
-- 2026-09-19 answer overrides that: like every other Mudavym page,
-- `/vendor-prices` gets its own per-house flag, OFF by default, and the
-- founder flips it himself — it is not live for every house on merge.
--
-- Same shape as 20260831090000_mudavym_design_flags.sql and its siblings
-- (20260902230000, 20260903150000, 20260904121000, 20260912080000): one
-- boolean on the reserved 'restaurant_settings' row, NOT NULL DEFAULT false.
-- A new file rather than widening an applied one in place, per the
-- schema-parity rule (an applied migration is never edited — a version
-- mismatch makes a file look ownerless). settings.service.ts joins every
-- ACTIVE registry key into its .select(), so a key promoted to ACTIVE
-- without a column 42703s the whole Settings read — the registry entry
-- (apps/api-gateway/src/settings/feature-flag-registry.ts) lands in the same
-- change as this file for that reason.

ALTER TABLE public.restaurant_feature_flags
  ADD COLUMN IF NOT EXISTS mudavym_design_vendor_prices boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_vendor_prices IS
  'On the ''restaurant_settings'' row only. TRUE renders the Mudavym redesign of `/vendor-prices` (ADR 0160 §112, direction A) for this restaurant; the founder flips it per house, it is not live for every house on merge. FALSE (default) renders the legacy VendorPriceCompare page.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurant_feature_flags'
      AND column_name = 'mudavym_design_vendor_prices'
  ) THEN
    RAISE EXCEPTION 'mudavym_design_vendor_prices was not added — the Settings read would 42703 on the registry key';
  END IF;
  RAISE NOTICE 'mudavym_design_vendor_prices present on restaurant_feature_flags.';
END
$$;
