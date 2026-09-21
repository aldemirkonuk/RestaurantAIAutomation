-- An accepted price advice is kept with the target it was computed against.
--
-- THE FOUNDER, 2026-09-21 (ADR 0193), verbatim: "... advise the manager or
-- owner to increase decrease the prices so that the profit margin is where
-- it's needed. We don't want market average because that will be already
-- shown in another column" - and he picked "Advise to target margin".
-- ---------------------------------------------------------------------------
-- The advice is "raise to X" / "lower to Y" = cost / (1 - target), and it is
-- applied only when a manager accepts it. At that moment the gateway writes
-- ONE `pricing_analyses` row (20260805123951) saying what was advised and why
-- (the target in `margin_floor_pct`, `elasticity_method` NULL because no
-- demand estimate is used, `engine_version` naming the margin-to-target rule)
-- and the price change's version row points at it through the existing
-- `menu_price_versions.pricing_analysis_id`.
--
-- Two gaps in the 2026-08-05 schema stop that record from being complete:
--   1. `pricing_analyses` cannot say WHICH price it advised on. The table was
--      built for one price per wine; a house has a bottle price and a glass
--      price, each with its own target. `price_kind` says which.
--   2. `pricing_analyses` does not keep the band ("close enough") the advice
--      was judged against, so an accepted advice could not explain later why
--      a wine 1.5 percent off its advised price was or was not advised.
--      `band_pct` keeps it (a PERCENT of the advised price, founder
--      2026-09-21; written before merge in margin points, changed in place),
--      stored per row for the same reason `margin_floor_pct` is: the house may
--      change its setting next week and last week's advice must still explain
--      itself.
-- And `menu_price_versions.pricing_analysis_id` has never had its FK. Every
-- existing row is a backfill row with a NULL there, so it validates against
-- nothing.
--
-- Additive and idempotent. Writes no row.

ALTER TABLE public.pricing_analyses
  ADD COLUMN IF NOT EXISTS price_kind TEXT,
  ADD COLUMN IF NOT EXISTS band_pct NUMERIC(4,2);

COMMENT ON COLUMN public.pricing_analyses.price_kind IS
  'Which of the house''s two prices this analysis advised on: bottle (restaurant_inventory.menu_price_current) or glass (menu_price_glass). NULL on rows written before ADR 0193.';
COMMENT ON COLUMN public.pricing_analyses.band_pct IS
  'The house''s "close enough" band, a PERCENT of the advised price, at the moment of the advice (restaurants.target_margin_band_pct). Kept per row so an old advice explains itself after the setting changes.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pricing_analyses_price_kind_check'
       AND conrelid = to_regclass('public.pricing_analyses')
  ) THEN
    ALTER TABLE public.pricing_analyses
      ADD CONSTRAINT pricing_analyses_price_kind_check
      CHECK (price_kind IS NULL OR price_kind IN ('bottle', 'glass'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'menu_price_versions_pricing_analysis_fkey'
       AND conrelid = to_regclass('public.menu_price_versions')
  ) THEN
    ALTER TABLE public.menu_price_versions
      ADD CONSTRAINT menu_price_versions_pricing_analysis_fkey
      FOREIGN KEY (pricing_analysis_id) REFERENCES public.pricing_analyses(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Assert the outcome. Catalog reads only.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'pricing_analyses'
         AND column_name IN ('price_kind', 'band_pct')
         AND column_default IS NULL) <> 2 THEN
    RAISE EXCEPTION 'pricing_analyses.price_kind / band_pct missing, or carrying a default';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'menu_price_versions_pricing_analysis_fkey'
       AND confrelid = to_regclass('public.pricing_analyses')
  ) THEN
    RAISE EXCEPTION 'menu_price_versions.pricing_analysis_id has no FK to pricing_analyses';
  END IF;

  RAISE NOTICE 'pricing_analyses: price_kind + band_pct added (no default); version rows now point at the advice they accepted';
END
$$;
