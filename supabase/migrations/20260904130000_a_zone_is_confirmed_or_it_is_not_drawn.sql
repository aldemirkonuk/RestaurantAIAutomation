-- A ZONE IS CONFIRMED, OR IT IS NOT DRAWN.
--
-- Founder decision, 2026-09-04: the cellar floor (sketch 092 direction A,
-- carried into 095 as a strip) is BUILT, but over confirmed zones only, in the
-- same infer-then-confirm shape the register set already uses
-- (20260903092000_restaurant_cellar_registers.sql).
--
-- WHY THIS IS NEEDED AT ALL. `public.storage_locations` cannot today tell a
-- zone somebody walked from a zone a seeder invented, and the floor is a
-- picture of rooms — the one surface where that difference is the whole
-- meaning. Measured on production 2026-09-04: the table holds **4 rows across
-- 2 tenants**, and all four carry one of the four names the seeded-defaults
-- sweep named — 'Wine Cellar - Main Cellar', 'Bar Area - Bar Fridge',
-- 'Reserve Room - Rare Collection', 'Overflow Storage'. (An earlier count of 87
-- rows across 7 tenants was measured 2026-09-02; 83 of them have since been
-- deleted. The proportion did not improve — it is now 4 of 4.) Two of the demo
-- tenant's three also carry a `current_occupancy` that disagrees with the
-- inventory rows actually assigned to them (180/32/45 against 17/17/16), which
-- is the same seeder's fingerprint.
--
-- WHAT THIS MIGRATION IS, AND IS NOT. It is three additive columns and nothing
-- else. It renames no zone, deletes no row, and does not decide that any
-- existing row is fake: it makes the ABSENCE of a confirmation representable,
-- so the floor can draw the confirmed ones and count the rest in words. Every
-- existing row therefore arrives `zone_confirmed_at IS NULL`, which is exactly
-- true of every one of them — nobody has ever been asked.
--
-- THE ACTOR COLUMN POINTS AT public.users, NOT auth.users. The two tables are
-- DISJOINT in this database and the JWT carries `public.users.user_id`, so a
-- foreign key to `auth.users` would 23503 on every write and CI could not catch
-- it (a fresh database has no rows to violate). This copies
-- 20260903092000:89 exactly, which is this page's own precedent.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

ALTER TABLE public.storage_locations
  ADD COLUMN IF NOT EXISTS zone_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS zone_confirmed_by uuid
    REFERENCES public.users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS zone_provenance text NOT NULL DEFAULT 'unconfirmed';

-- The vocabulary is closed, and 'unconfirmed' is the only value a row can hold
-- without a timestamp. A constraint rather than a convention, because a read
-- model that has to defend against `zone_provenance='confirmed',
-- zone_confirmed_at IS NULL` can say nothing reliable about either column —
-- the same reasoning as restaurant_cellar_registers' own check.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'storage_locations_confirmed_has_a_time'
      AND conrelid = to_regclass('public.storage_locations')
  ) THEN
    ALTER TABLE public.storage_locations
      ADD CONSTRAINT storage_locations_confirmed_has_a_time CHECK (
        (zone_provenance = 'unconfirmed' AND zone_confirmed_at IS NULL)
        OR (zone_provenance IN ('confirmed', 'renamed', 'created')
            AND zone_confirmed_at IS NOT NULL)
      );
  END IF;
END $$;

COMMENT ON COLUMN public.storage_locations.zone_confirmed_at IS
  'Null exactly while nobody has looked at this zone. This is the column that '
  'stops a seeded room from ageing into a floor plan. The cellar floor draws a '
  'zone only when this is set; the rest are counted in a sentence.';
COMMENT ON COLUMN public.storage_locations.zone_confirmed_by IS
  'public.users.user_id of whoever confirmed or renamed it. NOT auth.users — '
  'the two are disjoint here and the JWT carries this one.';
COMMENT ON COLUMN public.storage_locations.zone_provenance IS
  'unconfirmed: written by a seeder or an import and never checked by a human. '
  'confirmed: a manager agreed the name as it stood. renamed: a manager gave it '
  'a different name. created: a manager added the zone themselves, so it was '
  'never unconfirmed.';

-- Partial index: the floor's read is "the confirmed zones of this house", and
-- the unconfirmed ones are only ever counted.
CREATE INDEX IF NOT EXISTS idx_storage_locations_confirmed
  ON public.storage_locations (restaurant_id)
  WHERE zone_confirmed_at IS NOT NULL AND deleted_at IS NULL;

-- ── assertions: the columns landed, the constraint bites, nothing was
--    silently confirmed, and the table is still not client-reachable ────────
DO $$
DECLARE
  absent_cols text;
  c           text;
  required    text[] := ARRAY[
    'zone_confirmed_at', 'zone_confirmed_by', 'zone_provenance'
  ];
  default_is text;
BEGIN
  FOREACH c IN ARRAY required LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'storage_locations'
        AND column_name = c
    ) THEN
      absent_cols := concat_ws(', ', absent_cols, c);
    END IF;
  END LOOP;
  IF absent_cols IS NOT NULL THEN
    RAISE EXCEPTION 'storage_locations is missing columns the cellar floor reads: %', absent_cols;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'storage_locations_confirmed_has_a_time'
      AND conrelid = to_regclass('public.storage_locations')
  ) THEN
    RAISE EXCEPTION 'storage_locations_confirmed_has_a_time was not added';
  END IF;

  -- The whole point of the migration: every row it touched must arrive
  -- UNCONFIRMED. Asserted on the column default rather than by counting rows,
  -- deliberately — a row count would pass on the first apply and then throw on
  -- a re-run the moment a manager has actually confirmed a zone, which would
  -- make the file's own idempotency claim false.
  SELECT column_default INTO default_is
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'storage_locations'
    AND column_name = 'zone_provenance';
  IF default_is IS NULL OR default_is NOT LIKE '%unconfirmed%' THEN
    RAISE EXCEPTION
      'zone_provenance must default to unconfirmed so an existing row is not silently confirmed; default is %',
      coalesce(default_is, 'NULL');
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = to_regclass('public.storage_locations')) THEN
    RAISE EXCEPTION 'storage_locations has RLS off';
  END IF;
END $$;
