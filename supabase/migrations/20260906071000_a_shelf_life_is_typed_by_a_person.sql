-- A shelf life comes from a person, or the house does not have one.
--
-- WHY THIS EXISTS (the founder, 2026-09-05, batch 51: shelf life comes ONLY
-- from a person-typed `shelf_life_days` on the house item -- nullable; the
-- alert fires only for items that carry one and says so; NO CATEGORY DEFAULTS)
-- ---------------------------------------------------------------------------
-- `commodity-signals-plan.md` §9c recorded the blocker in measured form:
-- `grep -rn -i "shelf_life|shelf life|expiry_date|best_before"
-- supabase/migrations/` returned ZERO shelf-life columns across every
-- migration. Condition 8 of `commodity_exposure_rising` -- "the item keeps for
-- at least the exposure's lag" -- therefore could not be evaluated, and the
-- rule carried it in `UNEVALUATED_CONDITIONS` rather than pretending it passed.
-- Without it, "stock up" on the founder's own example is advice to buy three
-- months of a perishable.
--
-- THE THREE THINGS THIS COLUMN IS NOT, AND WHY EACH MATTERS
-- ---------------------------------------------------------------------------
-- 1. NOT DEFAULTED. No `DEFAULT`, at all. The asserted block below fails the
--    migration if one is ever added. A default here would give every item in
--    the estate a shelf life nobody typed, and the rule would then fire on
--    items whose storability was invented by a column definition. This is the
--    same defect `restaurants.currency DEFAULT 'USD'` produced on fourteen
--    houses, and the same one `master_wine_library.bottle_size_ml DEFAULT 750`
--    is still producing today.
-- 2. NOT INFERRED FROM A CATEGORY. Nothing in this migration or in the code
--    reading it maps a kind, a wine type or a supplier to a number of days.
--    The founder's words were "no category defaults" and the reason is the same
--    one the exposure mapping has: a model that proposes a fact a person never
--    stated is a claim with nobody's name on it.
-- 3. NOT REQUIRED. NULL is the normal state and stays the normal state. The
--    alert simply does not fire for an item with no shelf life typed, AND IT
--    SAYS SO -- an item skipped for a missing input must never render like an
--    item that was considered and found fine.
--
-- WHO TYPED IT TRAVELS WITH IT. A number with nobody's name on it is exactly
-- what rule 1 exists to prevent, so the value, the person and the moment are
-- one fact enforced by a CHECK rather than three columns that can disagree.
--
-- Additive and nullable. No existing column is altered, no existing row is
-- rewritten, and no backfill is attempted -- a backfilled shelf life would be
-- the category default this migration exists to refuse.

ALTER TABLE public.restaurant_inventory
  -- Days. Not a date: a shelf life is a property of the ITEM the house buys,
  -- while an expiry is a property of one lot that arrived on one day. The
  -- ledger's lots are where the second belongs, and conflating them would make
  -- a single typed number age.
  ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER,
  -- NEVER auth.users: the two tables are disjoint and the JWT carries
  -- public.users.user_id. ON DELETE RESTRICT, not SET NULL -- a typed fact
  -- whose author became NULL is a fact by nobody, which is what this column
  -- exists to make impossible.
  ADD COLUMN IF NOT EXISTS shelf_life_days_set_by UUID
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS shelf_life_days_set_at TIMESTAMPTZ,
  -- Optional, and worth having: "unopened, in the walk-in" and "once the case
  -- is broken" are different numbers for the same item, and the person typing
  -- one is the only one who knows which they meant.
  ADD COLUMN IF NOT EXISTS shelf_life_basis TEXT;

COMMENT ON COLUMN public.restaurant_inventory.shelf_life_days IS
  'How many days this house can hold this item, TYPED BY A PERSON. Nullable and normally null. No default and no category inference, ever (founder, 2026-09-05): a shelf life nobody typed would let the commodity alert advise stocking up on a perishable. An alert skips an item with no shelf life and says so.';
COMMENT ON COLUMN public.restaurant_inventory.shelf_life_days_set_by IS
  'The person who typed it, from public.users(user_id) - never auth.users, which is disjoint from it. RESTRICT rather than SET NULL: a typed fact by nobody is what this column exists to prevent.';
COMMENT ON COLUMN public.restaurant_inventory.shelf_life_basis IS
  'What the person meant, in their words: "unopened, walk-in", "once the case is broken". Optional. Two different numbers for one item are both true under different bases, and only the person typing knows which they meant.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurant_inventory_shelf_life_is_positive'
       AND conrelid = to_regclass('public.restaurant_inventory')
  ) THEN
    -- Zero days is not a shelf life, it is a refusal to stock the item, and it
    -- would make the alert's ">= lag" test false for every lag including none.
    ALTER TABLE public.restaurant_inventory
      ADD CONSTRAINT restaurant_inventory_shelf_life_is_positive
      CHECK (shelf_life_days IS NULL OR shelf_life_days > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurant_inventory_shelf_life_names_its_author'
       AND conrelid = to_regclass('public.restaurant_inventory')
  ) THEN
    -- The value, the person and the moment are ONE fact. Any two without the
    -- third is a record that looks complete and is not.
    ALTER TABLE public.restaurant_inventory
      ADD CONSTRAINT restaurant_inventory_shelf_life_names_its_author
      CHECK (
        (shelf_life_days IS NULL
          AND shelf_life_days_set_by IS NULL
          AND shelf_life_days_set_at IS NULL)
        OR
        (shelf_life_days IS NOT NULL
          AND shelf_life_days_set_by IS NOT NULL
          AND shelf_life_days_set_at IS NOT NULL)
      );
  END IF;
END
$$;

-- The alert asks one question of this column: which of the items mapped to a
-- series carry a typed shelf life. Partial, because the answer is normally a
-- small minority of a large table.
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_shelf_life_typed
  ON public.restaurant_inventory (restaurant_id)
  WHERE shelf_life_days IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  admitted BOOLEAN;
  probe_restaurant UUID;
  probe_item UUID;
  typed_rows BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'restaurant_inventory'
       AND column_name = 'shelf_life_days'
  ) THEN
    RAISE EXCEPTION 'shelf_life_days was not added';
  END IF;

  -- THE LOAD-BEARING ASSERTION. A default on this column would give every item
  -- in the estate a shelf life nobody typed.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'restaurant_inventory'
       AND column_name IN ('shelf_life_days', 'shelf_life_days_set_by',
                           'shelf_life_days_set_at', 'shelf_life_basis')
       AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'a shelf-life column carries a DEFAULT; a default is the category default this migration exists to refuse';
  END IF;

  -- The actor FK points inside public. auth.users and public.users are disjoint
  -- and a fresh CI database has no rows to prove it with.
  IF EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class ref ON ref.oid = con.confrelid
      JOIN pg_namespace ns ON ns.oid = ref.relnamespace
     WHERE con.conrelid = to_regclass('public.restaurant_inventory')
       AND con.contype = 'f'
       AND ns.nspname <> 'public'
       AND con.conname LIKE '%shelf_life%'
  ) THEN
    RAISE EXCEPTION 'the shelf-life author FK points outside public';
  END IF;

  -- NOTHING WAS BACKFILLED. Measured, not asserted: if a later hand ever adds a
  -- backfill to this file, this count stops being zero and the migration fails.
  SELECT count(*) INTO typed_rows
    FROM public.restaurant_inventory WHERE shelf_life_days IS NOT NULL;
  IF typed_rows <> 0 THEN
    RAISE EXCEPTION
      'this migration wrote % shelf lives; it must write none - a backfilled shelf life is a category default with a different name',
      typed_rows;
  END IF;

  -- PROBE, against a real row, that a value without an author is refused.
  SELECT id INTO probe_restaurant FROM public.restaurants LIMIT 1;
  IF probe_restaurant IS NOT NULL THEN
    SELECT id INTO probe_item
      FROM public.restaurant_inventory
     WHERE restaurant_id = probe_restaurant
     LIMIT 1;
  END IF;

  IF probe_item IS NOT NULL THEN
    BEGIN
      UPDATE public.restaurant_inventory
         SET shelf_life_days = 21
       WHERE id = probe_item;
      admitted := true;
    EXCEPTION WHEN check_violation THEN
      admitted := false;
    END;
    IF admitted THEN
      UPDATE public.restaurant_inventory
         SET shelf_life_days = NULL, shelf_life_days_set_by = NULL,
             shelf_life_days_set_at = NULL
       WHERE id = probe_item;
      RAISE EXCEPTION 'a shelf life was typed with nobody''s name on it';
    END IF;

    BEGIN
      UPDATE public.restaurant_inventory
         SET shelf_life_days = 0,
             shelf_life_days_set_by = (SELECT user_id FROM public.users LIMIT 1),
             shelf_life_days_set_at = NOW()
       WHERE id = probe_item
         AND EXISTS (SELECT 1 FROM public.users);
      admitted := (SELECT shelf_life_days FROM public.restaurant_inventory
                    WHERE id = probe_item) = 0;
    EXCEPTION WHEN check_violation THEN
      admitted := false;
    END;
    IF admitted THEN
      UPDATE public.restaurant_inventory
         SET shelf_life_days = NULL, shelf_life_days_set_by = NULL,
             shelf_life_days_set_at = NULL
       WHERE id = probe_item;
      RAISE EXCEPTION 'a shelf life of zero days was admitted';
    END IF;
  ELSE
    -- Said out loud rather than passing quietly: on an empty database the two
    -- probes above did not run, and a migration that reports success for checks
    -- it never made is the shape this whole register is built against.
    RAISE NOTICE 'shelf life: no restaurant_inventory row exists here, so the two CHECK probes were NOT run. The constraints are declared; they are unproven on this database.';
  END IF;

  RAISE NOTICE 'shelf life: column added, nullable, no default, author FK inside public, zero rows backfilled';
END
$$;
