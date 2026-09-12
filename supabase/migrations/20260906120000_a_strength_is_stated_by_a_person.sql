-- A bottle's strength is stated by a person, or the library does not have one.
--
-- WHY THIS EXISTS (the founder, 2026-09-05, batch 57: "Add ABV to the library,
-- nullable, no default")
-- ---------------------------------------------------------------------------
-- `duty.ts` computes a per-bottle duty and has refused every bottle in this
-- product since it was written, for a reason measured against the baseline on
-- 2026-09-05: **there is no alcohol-by-volume column anywhere in
-- `master_wine_library`.** It has `ml_derived_features` and `bottle_size_ml`
-- and nothing else. HMRC publishes alcohol duty per litre of PURE ALCOHOL
-- (Finance (No. 2) Act 2023, Part 2; rates in force 2026-02-01), so without a
-- strength no UK figure is computable for any bottle, for any house.
--
-- This is that column. It is deliberately the smallest possible version of it.
--
-- WHY IT CARRIES ITS AUTHOR, AND WHY THAT MATTERS MORE HERE THAN ON A HOUSE
-- ---------------------------------------------------------------------------
-- `restaurant_inventory.shelf_life_days` (20260906071000) carries
-- `_set_by` / `_set_at` because a shelf life nobody typed would let an alert
-- advise stocking up on a perishable. The same pattern is used here, and the
-- coordinator asked whether the library's author pattern differs. It does, and
-- the difference makes the author MORE load-bearing rather than less:
--
--   `restaurant_inventory` is ONE HOUSE'S shelf. A wrong shelf life misleads
--   the house that typed it.
--
--   `master_wine_library` is SHARED. Every house that stocks this bottle reads
--   this row, so a strength typed here reaches all of them -- and it is the
--   multiplicand in a TAX figure. A wrong ABV does not merely mislead; it
--   produces a number that looks like a duty and is not one.
--
-- The library's existing curation columns confirm the shape rather than
-- contradict it: `beverage_identities.curated_by` / `curated_at`
-- (20260906050000) already record who promoted an identity onto a library row.
-- This is the same discipline applied to a field rather than to a promotion.
--
-- THE HOUSE ALIAS NEVER TOUCHES IT, AND THAT IS ASSERTED RATHER THAN INTENDED
-- ---------------------------------------------------------------------------
-- A house's own bottle is a `beverage_identities` row with
-- `asserted_for_restaurant_id` set. Strength is a property of the LIQUID, not
-- of one house's paperwork, so it lives on the shared library row and nowhere
-- else. The assertion block below fails this migration if `abv_percent` ever
-- appears on `beverage_identities`, so the rule is measured on every replay
-- instead of being a sentence somebody has to remember.
--
-- WHAT THIS MIGRATION DOES NOT ADD, AND WHY IT DOES NOT NEED TO
-- ---------------------------------------------------------------------------
-- No author pair for the SIZE. The founder's requirement is that a duty print
-- only on a STATED size -- "not the 750 default, which duty.ts already refuses
-- by name" -- and a stated size ALREADY EXISTS in this schema:
-- `beverage_identities.size_ml`, whose own comment reads *"NULL means unstated.
-- NEVER 750: the library's 750 is a column default and this register exists
-- partly to stop that default being read as a fact"* (20260905140000). So the
-- size comes from the identity register and the strength comes from here, and
-- `master_wine_library.bottle_size_ml` is read by nothing in this path.
-- Duplicating a stated size onto the library would have been a second answer
-- to a question ADR 0124 already answered.
--
-- Additive and nullable. No existing column is altered, no existing row is
-- rewritten, and NOTHING IS BACKFILLED -- a backfilled ABV is a category
-- default with a different name, and the assertion block counts to prove it.

ALTER TABLE public.master_wine_library
  -- numeric(4,1): three digits and one decimal, so 0.0 through 100.0. Not an
  -- integer -- 13.5% is the ordinary case, not an edge one -- and not
  -- numeric(4,2), which would invite a second decimal no label ever prints.
  ADD COLUMN IF NOT EXISTS abv_percent NUMERIC(4, 1),
  -- NEVER auth.users: the two tables are disjoint and the JWT carries
  -- public.users.user_id. RESTRICT, not SET NULL: a strength whose author
  -- became NULL is a tax multiplicand by nobody.
  ADD COLUMN IF NOT EXISTS abv_percent_set_by UUID
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS abv_percent_set_at TIMESTAMPTZ,
  -- What the person read it off: "the label", "the producer's tech sheet",
  -- "the importer's spec". Optional, and worth having -- a label rounds and a
  -- tech sheet does not, and the difference shows up in the third figure of a
  -- duty.
  ADD COLUMN IF NOT EXISTS abv_percent_basis TEXT;

COMMENT ON COLUMN public.master_wine_library.abv_percent IS
  'Alcohol by volume, as a percentage, TYPED BY A PERSON. Nullable and normally null. No default and no inference from a category or a wine type, ever (founder, 2026-09-05): this is the multiplicand in a tax figure, on a SHARED row every house that stocks the bottle reads. 0.0 is a real answer (a de-alcoholised wine, and HMRC''s own 0-1.2% band is GBP 0.00); NULL means nobody has stated one.';
COMMENT ON COLUMN public.master_wine_library.abv_percent_set_by IS
  'The person who stated it, from public.users(user_id) - never auth.users, which is disjoint from it. RESTRICT rather than SET NULL: a strength by nobody is what this column exists to prevent, and it matters more here than on a house table because this row is shared.';
COMMENT ON COLUMN public.master_wine_library.abv_percent_basis IS
  'What the person read it off, in their words: "the label", "the producer''s tech sheet". Optional. A label rounds and a tech sheet does not, and the difference shows in the third figure of a duty.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'master_wine_library_abv_is_a_percentage'
       AND conrelid = to_regclass('public.master_wine_library')
  ) THEN
    -- The sane range, and both ends earn their place. Below zero is not a
    -- strength. Above 100 is not a strength either -- and the ceiling is not
    -- theoretical: a transcription that reads a US "proof" figure as a
    -- percentage doubles it, so 80 proof becomes 80% and 151 proof becomes 151,
    -- which this refuses at the door.
    ALTER TABLE public.master_wine_library
      ADD CONSTRAINT master_wine_library_abv_is_a_percentage
      CHECK (abv_percent IS NULL OR (abv_percent >= 0 AND abv_percent <= 100));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'master_wine_library_abv_names_its_author'
       AND conrelid = to_regclass('public.master_wine_library')
  ) THEN
    -- The value, the person and the moment are ONE fact. Any two without the
    -- third is a record that looks complete and is not. Same shape as
    -- restaurant_inventory.shelf_life_days, deliberately, so the two read alike.
    ALTER TABLE public.master_wine_library
      ADD CONSTRAINT master_wine_library_abv_names_its_author
      CHECK (
        (abv_percent IS NULL
          AND abv_percent_set_by IS NULL
          AND abv_percent_set_at IS NULL)
        OR
        (abv_percent IS NOT NULL
          AND abv_percent_set_by IS NOT NULL
          AND abv_percent_set_at IS NOT NULL)
      );
  END IF;
END
$$;

-- The duty path asks one question of this column: which library rows carry a
-- strength somebody stated. Partial, because the answer is a small minority of
-- a large table and will stay that way.
CREATE INDEX IF NOT EXISTS idx_master_wine_library_abv_stated
  ON public.master_wine_library (id)
  WHERE abv_percent IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  admitted BOOLEAN;
  probe_wine UUID;
  probe_user UUID;
  stated_rows BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'master_wine_library'
       AND column_name = 'abv_percent'
  ) THEN
    RAISE EXCEPTION 'abv_percent was not added';
  END IF;

  -- THE LOAD-BEARING ASSERTION. A default here would give every bottle in a
  -- shared library a strength nobody stated, and that strength multiplies a
  -- tax. This is the same failure `bottle_size_ml integer DEFAULT 750` already
  -- produces on the column beside it.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'master_wine_library'
       AND column_name IN ('abv_percent', 'abv_percent_set_by',
                           'abv_percent_set_at', 'abv_percent_basis')
       AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'an ABV column carries a DEFAULT; a defaulted strength is a category default with a different name, and it multiplies a tax';
  END IF;

  -- THE HOUSE ALIAS NEVER TOUCHES IT. Measured on every replay rather than
  -- remembered: strength is a property of the liquid, not of one house's
  -- paperwork, so it lives on the shared row and nowhere else.
  IF to_regclass('public.beverage_identities') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'beverage_identities'
          AND column_name LIKE 'abv%'
     ) THEN
    RAISE EXCEPTION
      'beverage_identities carries an ABV column; strength belongs to the liquid on the shared library row, never to a house''s own alias';
  END IF;

  -- The actor FK points inside public. auth.users and public.users are disjoint
  -- and a fresh CI database has no rows to prove it with.
  IF EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class ref ON ref.oid = con.confrelid
      JOIN pg_namespace ns ON ns.oid = ref.relnamespace
     WHERE con.conrelid = to_regclass('public.master_wine_library')
       AND con.contype = 'f'
       AND ns.nspname <> 'public'
       AND con.conname LIKE '%abv%'
  ) THEN
    RAISE EXCEPTION 'the ABV author FK points outside public';
  END IF;

  -- NOTHING WAS BACKFILLED. Measured, not asserted: if a later hand adds a
  -- backfill to this file, this count stops being zero and the migration fails.
  SELECT count(*) INTO stated_rows
    FROM public.master_wine_library WHERE abv_percent IS NOT NULL;
  IF stated_rows <> 0 THEN
    RAISE EXCEPTION
      'this migration stated % strengths; it must state none - a backfilled ABV is a guess with a person''s column around it',
      stated_rows;
  END IF;

  -- PROBE, against a real row where one exists.
  SELECT id INTO probe_wine FROM public.master_wine_library LIMIT 1;
  SELECT user_id INTO probe_user FROM public.users LIMIT 1;

  IF probe_wine IS NOT NULL AND probe_user IS NOT NULL THEN
    BEGIN
      UPDATE public.master_wine_library SET abv_percent = 13.5 WHERE id = probe_wine;
      admitted := true;
    EXCEPTION WHEN check_violation THEN
      admitted := false;
    END;
    IF admitted THEN
      UPDATE public.master_wine_library
         SET abv_percent = NULL, abv_percent_set_by = NULL, abv_percent_set_at = NULL
       WHERE id = probe_wine;
      RAISE EXCEPTION 'a strength was stated with nobody''s name on it';
    END IF;

    BEGIN
      UPDATE public.master_wine_library
         SET abv_percent = 151, abv_percent_set_by = probe_user, abv_percent_set_at = NOW()
       WHERE id = probe_wine;
      admitted := true;
    EXCEPTION WHEN check_violation THEN
      admitted := false;
    END;
    IF admitted THEN
      UPDATE public.master_wine_library
         SET abv_percent = NULL, abv_percent_set_by = NULL, abv_percent_set_at = NULL
       WHERE id = probe_wine;
      RAISE EXCEPTION 'a US proof figure was admitted as a percentage';
    END IF;

    -- And 0.0 IS admitted: a de-alcoholised wine is a real product, and HMRC's
    -- own 0-1.2% band is GBP 0.00. Refusing it would make "nobody stated one"
    -- and "somebody stated zero" render alike.
    UPDATE public.master_wine_library
       SET abv_percent = 0, abv_percent_set_by = probe_user, abv_percent_set_at = NOW()
     WHERE id = probe_wine;
    IF (SELECT abv_percent FROM public.master_wine_library WHERE id = probe_wine) <> 0 THEN
      RAISE EXCEPTION 'a stated zero strength was not kept';
    END IF;
    UPDATE public.master_wine_library
       SET abv_percent = NULL, abv_percent_set_by = NULL, abv_percent_set_at = NULL
     WHERE id = probe_wine;
  ELSE
    -- Said out loud rather than passing quietly: on an empty database the
    -- probes above did not run, and a migration that reports success for checks
    -- it never made is the shape this whole register is built against.
    RAISE NOTICE 'ABV: no master_wine_library row or no user exists here, so the three CHECK probes were NOT run. The constraints are declared; they are unproven on this database.';
  END IF;

  RAISE NOTICE 'ABV: column added, nullable, no default, author FK inside public, absent from beverage_identities, zero rows backfilled';
END
$$;
