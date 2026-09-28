-- A carrying cost comes from a person, or the house does not have one.
--
-- THE FOUNDER, 2026-09-05, batch 59, answering the plan's §12 Q5 verbatim:
-- "Twice a year, and the house types its carrying cost."
-- ---------------------------------------------------------------------------
-- The quant pass that produced that answer is recorded in the plan's §9b/§9f.
-- Its load-bearing measurement: over 440 recorded FAO months, walk-forward, a
-- fire is followed by a higher index three months later 66.7 % of the time
-- against a 54.4 % benchmark -- but the whole gain is spent by a carrying cost
-- of about ONE PERCENT A MONTH. The break-even sits at 0.96 %/month on the
-- headline index, 1.66 % on Dairy and 0.27 % on Meat. Between 0.5 % and 1.0 %
-- the recommendation flips from "worth having on six series" to "worth having
-- on one", and NOTHING IN THIS CODEBASE HAS EVER ASKED A HOUSE FOR THAT NUMBER.
--
-- So the alert's money clause is gated on it. A house that has not typed a
-- carrying cost gets the sentence with the saving replaced by the word
-- "unmeasured" and the reason; it never gets a number nobody stated.
--
-- WHAT THIS COLUMN IS NOT, AND WHY EACH MATTERS
-- ---------------------------------------------------------------------------
-- 1. NOT DEFAULTED. No `DEFAULT`, at all, and the asserted block below fails
--    the migration if one is ever added. A default here would put a number
--    nobody chose underneath a saving figure printed in the house's own money
--    -- the `restaurants.currency DEFAULT 'USD'` defect with a currency symbol
--    in front of it. The same rule `shelf_life_days` was built under
--    (20260906071000) and for the same reason.
-- 2. NOT DERIVED FROM ANYTHING. Not from the country, not from the plan, not
--    from a cost of capital this product could look up. A carrying cost is
--    cash, space and shrink together, and only the house knows its own.
-- 3. NOT REQUIRED. NULL is the normal state and stays it. The alert still
--    fires; only the MONEY CLAUSE is withheld, and it says which of the two
--    inputs is missing rather than falling silent.
--
-- WHO TYPED IT TRAVELS WITH IT. The value, the person and the moment are ONE
-- fact enforced by a CHECK, not three columns that can disagree.
--
-- THE UNIT IS PERCENT PER MONTH, AND THE COLUMN NAME SAYS SO. `0.750` means
-- three quarters of one percent a month. A fraction stored here would be wrong
-- by a hundred and would understate every carrying cost into invisibility --
-- which is the direction that makes the alert look profitable, so the bounds
-- below refuse the fraction spelling rather than admitting it silently.
--
-- Additive and nullable. No existing column altered, no existing row rewritten,
-- no backfill attempted -- a backfilled carrying cost is the default this
-- migration exists to refuse.

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS carrying_cost_percent_per_month NUMERIC(5,3),
  -- NEVER auth.users: the two tables are disjoint and the JWT carries
  -- public.users.user_id. ON DELETE RESTRICT, not SET NULL -- a typed fact
  -- whose author became NULL is a fact by nobody.
  ADD COLUMN IF NOT EXISTS carrying_cost_set_by UUID
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS carrying_cost_set_at TIMESTAMPTZ,
  -- What the person counted, in their words: "cash at 9 % plus the walk-in",
  -- "just the money". Two houses can type the same number meaning different
  -- things and only the typist knows which.
  ADD COLUMN IF NOT EXISTS carrying_cost_basis TEXT;

COMMENT ON COLUMN public.restaurants.carrying_cost_percent_per_month IS
  'What holding stock costs this house, PERCENT PER MONTH of the goods value, TYPED BY A PERSON. 0.750 means 0.75 percent a month, not 75 and not 0.0075. Nullable and normally null; no default and no derivation, ever (founder, 2026-09-05 batch 59). The commodity alert states a saving in money ONLY when this is stated, and says "unmeasured" otherwise.';
COMMENT ON COLUMN public.restaurants.carrying_cost_set_by IS
  'The person who typed it, from public.users(user_id) - never auth.users, which is disjoint from it. RESTRICT rather than SET NULL: a typed fact by nobody is what this column exists to prevent.';
COMMENT ON COLUMN public.restaurants.carrying_cost_basis IS
  'What the person counted, in their own words. Optional. Cash, space and shrink are three different costs and a single percentage does not say which of them it includes.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurants_carrying_cost_is_a_plausible_percent'
       AND conrelid = to_regclass('public.restaurants')
  ) THEN
    -- The bounds are a UNITS check as much as a sanity check.
    --   Below 0.01 %/month is 0.12 % a year, which no house has and which is
    --   what a person typing the FRACTION 0.0075 would land on. Refused, so
    --   the mistake is a sentence rather than an alert that looks free.
    --   Above 25 %/month is 300 % a year, which is what a person typing 75
    --   meaning "0.75" would land on.
    -- A value this CHECK admits is a value the gateway's DTO admits, and the
    -- two carry the same numbers on purpose.
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_carrying_cost_is_a_plausible_percent
      CHECK (
        carrying_cost_percent_per_month IS NULL
        OR (carrying_cost_percent_per_month >= 0.01
            AND carrying_cost_percent_per_month <= 25.000)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurants_carrying_cost_names_its_author'
       AND conrelid = to_regclass('public.restaurants')
  ) THEN
    -- The value, the person and the moment are ONE fact. Any two without the
    -- third is a record that looks complete and is not.
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_carrying_cost_names_its_author
      CHECK (
        (carrying_cost_percent_per_month IS NULL
          AND carrying_cost_set_by IS NULL
          AND carrying_cost_set_at IS NULL)
        OR
        (carrying_cost_percent_per_month IS NOT NULL
          AND carrying_cost_set_by IS NOT NULL
          AND carrying_cost_set_at IS NOT NULL)
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  admitted BOOLEAN;
  probe_house UUID;
  probe_person UUID;
  typed_rows BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'restaurants'
       AND column_name = 'carrying_cost_percent_per_month'
  ) THEN
    RAISE EXCEPTION 'carrying_cost_percent_per_month was not added';
  END IF;

  -- THE LOAD-BEARING ASSERTION. A default here would put a number nobody chose
  -- underneath a money figure on a manager's screen.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'restaurants'
       AND column_name IN ('carrying_cost_percent_per_month',
                           'carrying_cost_set_by', 'carrying_cost_set_at',
                           'carrying_cost_basis')
       AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'a carrying-cost column carries a DEFAULT; a default is the invented number this migration exists to refuse';
  END IF;

  -- The actor FK points inside public. auth.users and public.users are
  -- disjoint and a fresh CI database has no rows to prove it with.
  IF EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class ref ON ref.oid = con.confrelid
      JOIN pg_namespace ns ON ns.oid = ref.relnamespace
     WHERE con.conrelid = to_regclass('public.restaurants')
       AND con.contype = 'f'
       AND ns.nspname <> 'public'
       AND con.conname LIKE '%carrying_cost%'
  ) THEN
    RAISE EXCEPTION 'the carrying-cost author FK points outside public';
  END IF;

  -- NOTHING WAS BACKFILLED. Measured, not asserted.
  SELECT count(*) INTO typed_rows
    FROM public.restaurants WHERE carrying_cost_percent_per_month IS NOT NULL;
  IF typed_rows <> 0 THEN
    RAISE EXCEPTION
      'this migration wrote % carrying costs; it must write none - a backfilled carrying cost is a default with a different name',
      typed_rows;
  END IF;

  SELECT id INTO probe_house FROM public.restaurants LIMIT 1;
  SELECT user_id INTO probe_person FROM public.users LIMIT 1;

  IF probe_house IS NOT NULL AND probe_person IS NOT NULL THEN
    -- A value with nobody's name on it.
    BEGIN
      UPDATE public.restaurants
         SET carrying_cost_percent_per_month = 0.750
       WHERE id = probe_house;
      admitted := true;
    EXCEPTION WHEN check_violation THEN
      admitted := false;
    END;
    IF admitted THEN
      UPDATE public.restaurants
         SET carrying_cost_percent_per_month = NULL,
             carrying_cost_set_by = NULL, carrying_cost_set_at = NULL
       WHERE id = probe_house;
      RAISE EXCEPTION 'a carrying cost was typed with nobody''s name on it';
    END IF;

    -- The fraction spelling: 0.0075 meaning "0.75 percent". Refused, because
    -- admitting it would understate the cost by a hundred and make every alert
    -- look profitable.
    BEGIN
      UPDATE public.restaurants
         SET carrying_cost_percent_per_month = 0.0075,
             carrying_cost_set_by = probe_person,
             carrying_cost_set_at = NOW()
       WHERE id = probe_house;
      admitted := true;
    EXCEPTION WHEN check_violation THEN
      admitted := false;
    END;
    IF admitted THEN
      UPDATE public.restaurants
         SET carrying_cost_percent_per_month = NULL,
             carrying_cost_set_by = NULL, carrying_cost_set_at = NULL
       WHERE id = probe_house;
      RAISE EXCEPTION 'the fraction spelling 0.0075 was admitted as a percent';
    END IF;

    -- And the other units mistake: 75 meaning "0.75".
    BEGIN
      UPDATE public.restaurants
         SET carrying_cost_percent_per_month = 75,
             carrying_cost_set_by = probe_person,
             carrying_cost_set_at = NOW()
       WHERE id = probe_house;
      admitted := true;
    EXCEPTION WHEN check_violation THEN
      admitted := false;
    END;
    IF admitted THEN
      UPDATE public.restaurants
         SET carrying_cost_percent_per_month = NULL,
             carrying_cost_set_by = NULL, carrying_cost_set_at = NULL
       WHERE id = probe_house;
      RAISE EXCEPTION 'a carrying cost of 75 percent a month was admitted';
    END IF;

    -- And the honest one is admitted, then cleared: this migration leaves no
    -- typed carrying cost behind, which the count above already asserted.
    UPDATE public.restaurants
       SET carrying_cost_percent_per_month = 0.750,
           carrying_cost_set_by = probe_person,
           carrying_cost_set_at = NOW()
     WHERE id = probe_house;
    IF (SELECT carrying_cost_percent_per_month FROM public.restaurants
         WHERE id = probe_house) IS NULL THEN
      RAISE EXCEPTION 'an honest carrying cost of 0.75 percent a month was refused';
    END IF;
    UPDATE public.restaurants
       SET carrying_cost_percent_per_month = NULL,
           carrying_cost_set_by = NULL, carrying_cost_set_at = NULL
     WHERE id = probe_house;
  ELSE
    -- Said out loud rather than passing quietly. A migration that reports
    -- success for checks it never made is the shape this register is built
    -- against.
    RAISE NOTICE 'carrying cost: no restaurant or no user row exists here, so the four CHECK probes were NOT run. The constraints are declared; they are unproven on this database.';
  END IF;

  RAISE NOTICE 'carrying cost: column added, nullable, no default, author FK inside public, zero rows backfilled';
END
$$;
