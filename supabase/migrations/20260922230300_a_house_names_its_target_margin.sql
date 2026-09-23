-- A house names the margin it needs on a bottle and on a glass, or it has none.
--
-- THE FOUNDER, 2026-09-21, verbatim:
-- "check if the code has changed before touching those areas, must have been
-- already built. Dynamic means two things 1. it could be changed every time a
-- menu is updated and secondly it should be changed whenever the manager wants
-- and also ... recommendations ... make sure that endpoint exists that we will
-- ask or recommend or advise the manager or owner to increase decrease the
-- prices so that the profit margin is where it's needed. We don't want market
-- average because that will be already shown in another column"
-- and, after research, he picked "Advise to target margin" (ADR 0193).
-- ---------------------------------------------------------------------------
-- "Where it's needed" is a number only the house knows. Nothing in this schema
-- has ever held it: `restaurant_inventory.margin_percentage` (baseline :3282)
-- is per wine and has no reader or writer in the app, and the 0.65 in
-- `pricing-agility.spec.ts` is a test fixture, not a house's answer. So the
-- advice (raise to X / lower to Y) is gated on this answer. A house that has
-- not typed one gets "no target set" on every wine, never advice computed
-- against a figure nobody chose.
--
-- WHAT THESE COLUMNS ARE NOT
--   1. NOT DEFAULTED. No DEFAULT on any of the five; the assert block below
--      fails the migration if one is ever added (the same rule
--      `carrying_cost_percent_per_month`, 20260906140000, was built under).
--   2. NOT BACKFILLED. Every house starts with no target. Measured below.
--   3. NOT A FRACTION. A target is PERCENT of the selling price: 65 means a
--      65 percent gross margin, cost is 35 percent of the price. The bounds
--      (5 to 95) are a UNITS check as much as a range: 0.65, the fraction
--      spelling, is refused rather than stored as a 0.65 percent target that
--      would tell a manager to cut every price to almost cost.
--
-- THE BAND ("close enough"), a PERCENT OF THE ADVISED PRICE. A wine whose
-- price is within this many percent of the advised price is on target and
-- gets no advice. The founder, 2026-09-21, relayed: "close enough" is a
-- percent of the advised price (within N% gets no advice), required with the
-- target, no default -- in his words, "percent is always shown everywhere".
-- (Written before merge as margin POINTS; changed in place, since no copy of
-- this migration has ever been applied outside a proof build.) 0 is allowed
-- and means "advise on any difference". It has no default either, and a
-- target cannot be stored without it (CHECK below), so there is never a
-- target whose "close enough" somebody else chose.
--
-- WHO TYPED IT TRAVELS WITH IT. The targets, the band, the person and the
-- moment are ONE fact, enforced by a CHECK. The author FK is
-- public.users(user_id) - never auth.users, which is disjoint from it - and
-- RESTRICT, not SET NULL: a target by nobody is what this column exists to
-- prevent.
--
-- Additive and idempotent: ADD COLUMN IF NOT EXISTS, constraints added only
-- when absent. Writes no row.

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS target_margin_bottle_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS target_margin_glass_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS target_margin_band_pct NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS target_margin_set_by UUID
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS target_margin_set_at TIMESTAMPTZ;

COMMENT ON COLUMN public.restaurants.target_margin_bottle_pct IS
  'The gross margin this house needs on a BOTTLE, PERCENT of the selling price (65 = cost is 35 percent of the price). Typed by an owner or manager; no default, no backfill (founder, 2026-09-21, ADR 0193). NULL = not set: price advice says "no target set" instead of advising.';
COMMENT ON COLUMN public.restaurants.target_margin_glass_pct IS
  'The gross margin this house needs on a GLASS, PERCENT of the glass price. Glass cost = bottle cost x pour ml / bottle ml. Same rules as target_margin_bottle_pct; independent of it (a house may set one and not the other).';
COMMENT ON COLUMN public.restaurants.target_margin_band_pct IS
  '"Close enough", a PERCENT of the advised price: a wine whose price is within this many percent of the advised price gets no advice (founder, 2026-09-21: "percent is always shown everywhere"). 0 = advise on any difference. No default; required whenever a target is set.';
COMMENT ON COLUMN public.restaurants.target_margin_set_by IS
  'Who typed the targets, public.users(user_id) - never auth.users. RESTRICT: a target by nobody is what this prevents.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurants_target_margin_is_a_plausible_percent'
       AND conrelid = to_regclass('public.restaurants')
  ) THEN
    -- 5..95 percent. Below 5 is where the FRACTION spelling (0.65) lands;
    -- above 95 means cost is under a twentieth of the price, which is a typo
    -- for a markup, not a margin.
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_target_margin_is_a_plausible_percent
      CHECK (
        (target_margin_bottle_pct IS NULL
          OR (target_margin_bottle_pct >= 5 AND target_margin_bottle_pct <= 95))
        AND
        (target_margin_glass_pct IS NULL
          OR (target_margin_glass_pct >= 5 AND target_margin_glass_pct <= 95))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurants_target_margin_band_is_plausible'
       AND conrelid = to_regclass('public.restaurants')
  ) THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_target_margin_band_is_plausible
      CHECK (
        target_margin_band_pct IS NULL
        OR (target_margin_band_pct >= 0 AND target_margin_band_pct <= 20)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurants_target_margin_names_its_author'
       AND conrelid = to_regclass('public.restaurants')
  ) THEN
    -- Either nothing is set, or at least one target AND the band AND the
    -- person AND the moment are. A target without a band would force the
    -- advice to invent what "close enough" means.
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_target_margin_names_its_author
      CHECK (
        (target_margin_bottle_pct IS NULL
          AND target_margin_glass_pct IS NULL
          AND target_margin_band_pct IS NULL
          AND target_margin_set_by IS NULL
          AND target_margin_set_at IS NULL)
        OR
        ((target_margin_bottle_pct IS NOT NULL OR target_margin_glass_pct IS NOT NULL)
          AND target_margin_band_pct IS NOT NULL
          AND target_margin_set_by IS NOT NULL
          AND target_margin_set_at IS NOT NULL)
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Assert the outcome. Catalog reads only: this migration touches no row.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  typed_rows BIGINT;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'restaurants'
         AND column_name IN ('target_margin_bottle_pct', 'target_margin_glass_pct',
                             'target_margin_band_pct', 'target_margin_set_by',
                             'target_margin_set_at')) <> 5 THEN
    RAISE EXCEPTION 'the five target-margin columns were not all added';
  END IF;

  -- THE LOAD-BEARING ASSERTION. A default would put a margin nobody chose
  -- underneath every "raise to" and "lower to" a manager reads.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'restaurants'
       AND column_name IN ('target_margin_bottle_pct', 'target_margin_glass_pct',
                           'target_margin_band_pct', 'target_margin_set_by',
                           'target_margin_set_at')
       AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'a target-margin column carries a DEFAULT; a default is the invented target this migration exists to refuse';
  END IF;

  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = to_regclass('public.restaurants')
         AND conname IN ('restaurants_target_margin_is_a_plausible_percent',
                         'restaurants_target_margin_band_is_plausible',
                         'restaurants_target_margin_names_its_author')) <> 3 THEN
    RAISE EXCEPTION 'the three target-margin CHECKs are not all present';
  END IF;

  -- The author FK points at public.users(user_id), not auth.users.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = to_regclass('public.restaurants')
       AND con.contype = 'f'
       AND att.attname = 'target_margin_set_by'
       AND con.confrelid = to_regclass('public.users')
  ) THEN
    RAISE EXCEPTION 'target_margin_set_by does not reference public.users';
  END IF;

  -- NOTHING WAS BACKFILLED. Measured, not asserted.
  SELECT count(*) INTO typed_rows
    FROM public.restaurants
   WHERE target_margin_bottle_pct IS NOT NULL
      OR target_margin_glass_pct IS NOT NULL
      OR target_margin_band_pct IS NOT NULL;
  IF typed_rows <> 0 THEN
    RAISE EXCEPTION
      'this migration wrote % target margins; it must write none - a backfilled target is a default with a different name',
      typed_rows;
  END IF;

  RAISE NOTICE 'target margin: five columns, no default, three CHECKs, author FK to public.users, zero rows written';
END
$$;
