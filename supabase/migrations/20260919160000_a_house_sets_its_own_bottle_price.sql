-- A house's own bottle price, alongside its own glass price.
--
-- THE FOUNDER, 2026-09-19 (19-lane blocking round, batch 4), verbatim:
-- "Our library price will be just the average price that will be updating
-- daily ... However, we're going to add a per house bottle price. That's a
-- huge thing ... gotta be dynamic."
-- ---------------------------------------------------------------------------
-- Two things follow, and this migration is only the first of them:
--
-- 1. THIS COLUMN. `restaurant_inventory.menu_price_glass` has been a real,
--    manager-typed, per-house column since the baseline
--    (20260805000000_baseline_from_production.sql:3315) — the wine LIBRARY
--    holds no house-specific price, only a shared reference figure
--    (`price_reference`, read as `listPrice` on the wire). A house's glass
--    price was never expected to equal another house's, or the library's
--    own figure, and the schema already agreed. Its bottle price has had no
--    such column: `BottleLeaf.tsx` (the cellar page's per-bottle record) has
--    had to reuse the library's own reference price in its place, which is
--    the library's figure wearing this house's clothes. `menu_price_bottle`
--    closes that gap the same way `menu_price_glass` already did — additive,
--    nullable, no default, set by a manager, read fresh, never assumed.
--
-- 2. WHAT THIS MIGRATION DOES NOT DO. "Gotta be dynamic" describes a
--    MECHANISM this migration does not build: cost-plus markup, tracking the
--    library's own average as it moves, or a manual figure a manager types
--    and revisits. Which of those "dynamic" means is not decided — the
--    founder's own words describe an intent, not a chosen design, and
--    CLAUDE.md §0.1 governs an undecided fork exactly like this one ("do not
--    assume, do not pick a sensible default ... ask"). This migration adds
--    only the MANUAL field: a plain nullable numeric a manager types, exactly
--    `menu_price_glass`'s own shape, with no formula, no schedule and no
--    second column implying one. The "dynamic" mechanism is returned as an
--    open question (options + a recommendation) in this pass's own report,
--    not decided here and not guessed at in the schema.
--
-- THE LIBRARY FIGURE IS RELABELLED, NOT MOVED. The founder's other clause —
-- "our library price will be just the average price" — is a UI labelling
-- fix, not a schema change: `BottleLeaf.tsx`'s existing "List price" facts
-- (bound to `price_reference` already) are relabelled "Market average" in
-- this same pass, so the one column that has always been a market-wide
-- figure finally reads as one. No column here carries that change.
--
-- Additive and nullable, same as `menu_price_glass` beside it: no existing
-- column altered, no existing row rewritten, no backfill attempted, no
-- author/timestamp columns (this house's manager-set price has never
-- recorded who set it or when — `menu_price_glass` does not either, and a
-- half-parity column here would be a new, undiscussed decision, not a
-- mirror of one already made).

ALTER TABLE public.restaurant_inventory
  ADD COLUMN IF NOT EXISTS menu_price_bottle NUMERIC(10,2);

COMMENT ON COLUMN public.restaurant_inventory.menu_price_bottle IS
  'This house''s own price for a whole bottle, typed by a manager — never '
  'the wine library''s reference price. Nullable, no default, no backfill '
  '(founder, 2026-09-19: "we''re going to add a per house bottle price"). '
  'Same shape as the sibling column menu_price_glass; "dynamic" pricing '
  '(cost-plus / following the market average / manual) is an open founder '
  'question — this column is the MANUAL figure only.';

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  written_rows BIGINT;
  probe_row_id UUID;
  before_value NUMERIC;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'restaurant_inventory'
       AND column_name = 'menu_price_bottle'
  ) THEN
    RAISE EXCEPTION 'menu_price_bottle was not added';
  END IF;

  -- Same numeric shape as menu_price_glass — a house typing $1,234.56 for one
  -- bottle is implausible but not this migration's business to refuse; the
  -- scale/precision match is what matters (a mismatch would silently round
  -- one of the two sibling columns differently from the other).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'restaurant_inventory'
       AND column_name = 'menu_price_bottle'
       AND data_type = 'numeric' AND numeric_precision = 10 AND numeric_scale = 2
  ) THEN
    RAISE EXCEPTION 'menu_price_bottle is not numeric(10,2), unlike its sibling menu_price_glass';
  END IF;

  -- NOT DEFAULTED. A default here would put a number nobody chose underneath
  -- a per-bottle price on a manager's screen — the exact defect class
  -- `carrying_cost_percent_per_month` (20260906140000) was built to refuse.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'restaurant_inventory'
       AND column_name = 'menu_price_bottle'
       AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'menu_price_bottle carries a DEFAULT; a default is the invented price this migration exists to refuse';
  END IF;

  -- NOTHING WAS BACKFILLED. Measured, not asserted.
  SELECT count(*) INTO written_rows
    FROM public.restaurant_inventory WHERE menu_price_bottle IS NOT NULL;
  IF written_rows <> 0 THEN
    RAISE EXCEPTION
      'this migration wrote % menu_price_bottle values; it must write none',
      written_rows;
  END IF;

  -- The column actually holds a value once one is written, and is silent
  -- (not a CHECK failure) for the ordinary case: nullable, no floor beyond
  -- what NUMERIC(10,2) itself enforces, matching menu_price_glass exactly.
  SELECT id INTO probe_row_id FROM public.restaurant_inventory LIMIT 1;
  IF probe_row_id IS NOT NULL THEN
    SELECT menu_price_bottle INTO before_value
      FROM public.restaurant_inventory WHERE id = probe_row_id;

    UPDATE public.restaurant_inventory
       SET menu_price_bottle = 62.00
     WHERE id = probe_row_id;
    IF (SELECT menu_price_bottle FROM public.restaurant_inventory
         WHERE id = probe_row_id) IS DISTINCT FROM 62.00 THEN
      RAISE EXCEPTION 'a plain bottle price of 62.00 was not admitted';
    END IF;

    -- Restore exactly what was there before the probe (usually NULL) —
    -- leaving no trace, same discipline the count check above already
    -- established for the migration as a whole.
    UPDATE public.restaurant_inventory
       SET menu_price_bottle = before_value
     WHERE id = probe_row_id;
  ELSE
    RAISE NOTICE 'menu_price_bottle: no restaurant_inventory row exists here, so the write probe was NOT run. The column is declared; it is unproven on this database.';
  END IF;

  RAISE NOTICE 'menu_price_bottle: column added, nullable, no default, numeric(10,2) matching menu_price_glass, zero rows backfilled';
END
$$;
