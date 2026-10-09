-- ONBOARDING PROGRESS IS KEPT PER HOUSE. F-240 (sim ledger).
--
-- WHAT BROKE. user_onboarding_progress is UNIQUE (user_id)
-- (baseline_from_production.sql, user_onboarding_progress_user_id_key), so an
-- owner has one checklist for every house they run. GET /onboarding/progress
-- read it by user alone (menus.service.ts getOnboardingProgress), and a second
-- house opened through Add a location (organizations.service.ts createLocation)
-- wrote no row, so the second house showed the first house's checklist: its
-- menu, its vendor, its invite. The self-heal read the row's restaurant_id,
-- which is house 1.
--
-- THE RULE. One row per person per house: UNIQUE (user_id, restaurant_id).
-- The gateway reads and writes the row of the house the session is in, and
-- createLocation writes the new house's row.
--
-- WHAT UNIQUE (user_id) ALSO DID, AND STILL MUST. createFirstHouse
-- (auth.service.ts) inserts this row first, on its own, because UNIQUE
-- (user_id) refused a second concurrent FIRST house by the same account
-- (F-006 OPEN-6, option b). A per-house key alone would let both win. So the
-- row now says whether it is the account's first house (first_house), and a
-- partial unique index keeps one first house per account. The default is
-- true: both sign-up writers (createFirstHouse and registerRestaurant) open
-- the account's first house and are unchanged; createLocation, the one writer
-- of a later house, says false. A future writer that forgets to say false is
-- refused (fails closed) rather than silently opening a second "first" house.
--
-- BACKFILL. Every existing row was written by one of the two sign-up writers
-- (the only inserts into this table on main), and UNIQUE (user_id) held one
-- row per account, so every existing row IS its account's first house: the
-- default fills true, which is correct for each. No row is deleted or moved.
-- Houses opened through Add a location before this file have no row; the
-- gateway answers "no checklist" there (404), never house 1's.
--
-- LOCK. ADD COLUMN with a constant default is catalogue-only on PG11+; the
-- constraint swap and the partial index each read the table once under the
-- lock the file holds (the CLI runs it as one transaction). The table holds
-- one row per account. Re-runnable: each step checks before it acts.

SET local statement_timeout = '120s';

ALTER TABLE public.user_onboarding_progress
  ADD COLUMN IF NOT EXISTS first_house boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.user_onboarding_progress.first_house IS
  'F-240: true for the row written when the account opened its first house (sign-up), false for a house opened later (Add a location). One first house per account (user_onboarding_progress_one_first_house).';

ALTER TABLE public.user_onboarding_progress
  DROP CONSTRAINT IF EXISTS user_onboarding_progress_user_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_onboarding_progress_user_house_key'
       AND conrelid = to_regclass('public.user_onboarding_progress')
  ) THEN
    ALTER TABLE public.user_onboarding_progress
      ADD CONSTRAINT user_onboarding_progress_user_house_key
      UNIQUE (user_id, restaurant_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS user_onboarding_progress_one_first_house
  ON public.user_onboarding_progress (user_id)
  WHERE first_house;

COMMENT ON INDEX public.user_onboarding_progress_one_first_house IS
  'F-240: keeps what UNIQUE (user_id) did for createFirstHouse (F-006 OPEN-6): a second concurrent first house by one account is refused.';
