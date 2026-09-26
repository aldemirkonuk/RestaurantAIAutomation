-- A house confirms its pour size once, and only then does a glass get price
-- advice.
--
-- THE FOUNDER, 2026-09-21, relayed (ADR 0193, answer 4): glass advice appears
-- only after the house confirms its pour size - a one-time confirmation;
-- bottle advice is unaffected.
-- ---------------------------------------------------------------------------
-- WHY. Glass cost = bottle cost x pour ml / bottle ml. ADR 0193's last-call
-- review (F7) found that every size the advice could read carries a database
-- DEFAULT: `restaurants.default_pour_ml` DEFAULT 150 (baseline :3586),
-- `restaurant_inventory.pour_size_ml`, and both bottle sizes. And no code
-- anywhere writes `restaurants.default_pour_ml`: the web's "default pour"
-- setting lives in one browser's local store (restaurantSettingsStore.ts) and
-- never reaches the database. So a "raise the glass to X" was priced on a
-- 150 ml pour that nobody at the house ever stated.
--
-- WHAT THIS ADDS. The confirmation, as a fact with its person and moment:
--   pour_size_confirmed_by  public.users(user_id), never auth.users; RESTRICT,
--                           because a confirmation by nobody is what this
--                           column exists to prevent;
--   pour_size_confirmed_at  when.
-- The act that sets them (PUT /pricing/pour-size, owner or manager) writes
-- `default_pour_ml` in the SAME update, so the confirmed number and the number
-- the glass advice reads are one column, not two copies of one meaning. Until
-- both are set, every glass reads "waiting for the house's pour size"; bottle
-- advice never reads either column.
--
-- NOT DEFAULTED, NOT BACKFILLED: every house starts unconfirmed (asserted
-- below, measured not assumed). A confirmation stamped onto existing rows
-- would be the defaulted pour this migration exists to stop reading.
--
-- Additive and idempotent: ADD COLUMN IF NOT EXISTS, the CHECK added only when
-- absent. Writes no row. RLS: `restaurants` already has it; no new table.

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS pour_size_confirmed_by UUID
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS pour_size_confirmed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.restaurants.pour_size_confirmed_by IS
  'Who confirmed this house''s pour size (restaurants.default_pour_ml), public.users(user_id). NULL = never confirmed: glass price advice waits (founder, 2026-09-21, ADR 0193). Set only by the owner/manager confirmation act, together with default_pour_ml.';
COMMENT ON COLUMN public.restaurants.pour_size_confirmed_at IS
  'When this house confirmed its pour size. Set with pour_size_confirmed_by, or neither.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurants_pour_size_confirmation_names_its_author'
       AND conrelid = to_regclass('public.restaurants')
  ) THEN
    -- The person and the moment are one fact, and a confirmed pour is a real
    -- pour: not NULL and inside the range a glass can be.
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_pour_size_confirmation_names_its_author
      CHECK (
        (pour_size_confirmed_by IS NULL AND pour_size_confirmed_at IS NULL)
        OR
        (pour_size_confirmed_by IS NOT NULL
          AND pour_size_confirmed_at IS NOT NULL
          AND default_pour_ml IS NOT NULL
          AND default_pour_ml >= 10
          AND default_pour_ml <= 500)
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Assert the outcome. Catalog reads, and one count.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  confirmed BIGINT;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'restaurants'
         AND column_name IN ('pour_size_confirmed_by', 'pour_size_confirmed_at')
         AND column_default IS NULL) <> 2 THEN
    RAISE EXCEPTION 'the two pour-confirmation columns are missing, or one carries a default';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = to_regclass('public.restaurants')
       AND con.contype = 'f'
       AND att.attname = 'pour_size_confirmed_by'
       AND con.confrelid = to_regclass('public.users')
  ) THEN
    RAISE EXCEPTION 'pour_size_confirmed_by does not reference public.users';
  END IF;

  SELECT count(*) INTO confirmed
    FROM public.restaurants
   WHERE pour_size_confirmed_at IS NOT NULL;
  IF confirmed <> 0 THEN
    RAISE EXCEPTION
      'this migration confirmed % pour sizes; it must confirm none - a confirmation nobody made is the default this exists to refuse',
      confirmed;
  END IF;

  RAISE NOTICE 'pour confirmation: two columns, no default, author FK to public.users, zero houses confirmed';
END
$$;
