-- A wine can state its own pour, and glass advice uses it only once an owner
-- or a manager has confirmed it; until then the house's confirmed pour is used.
--
-- THE FOUNDER, 2026-09-21 (round 6c), verbatim, to "should a wine be able to
-- state its own pour (overriding the house's confirmed one) for glass
-- advice?": "Yes, confirmed per wine".
-- ---------------------------------------------------------------------------
-- WHY A CONFIRMATION, AND NOT THE COLUMN AS IT IS. `restaurant_inventory
-- .pour_size_ml` (baseline) carries DEFAULT 150, and any house member may
-- write it on the inventory create, bulk-add and PATCH paths. A value nobody
-- chose cannot be told from a typed one (ADR 0193 F7), so the advice has not
-- read it since round 2. What makes a wine's pour usable is the same fact that
-- made the house's usable: a person with the authority to state it, and when.
--
-- WHAT THIS ADDS, mirroring 20260921115000 on the house row:
--   pour_size_confirmed_by  public.users(user_id), never auth.users; RESTRICT
--   pour_size_confirmed_at  when
-- The act (PUT /pricing/wines/:inventoryId/pour, owner or manager) writes
-- `pour_size_ml` and both columns in ONE update, so the confirmed number and
-- the number the advice reads are one column. A CHECK makes the person and the
-- moment one fact, and a confirmed pour a real pour (10 to 500 ml).
--
-- A LATER CHANGE UNDOES THE CONFIRMATION. If `pour_size_ml` changes in an
-- update that does not also restamp the confirmation (the inventory PATCH, a
-- bulk path, anything), the confirmation no longer describes the number, so
-- the trigger below clears it: the wine falls back to the house's confirmed
-- pour until an owner or manager confirms the new number. The confirmation
-- act itself restamps, so it passes.
--
-- NOT DEFAULTED, NOT BACKFILLED: no wine is confirmed by this migration
-- (asserted). Additive and idempotent. Writes no row. RLS: restaurant_inventory
-- already has it; no new table.

ALTER TABLE public.restaurant_inventory
  ADD COLUMN IF NOT EXISTS pour_size_confirmed_by UUID
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS pour_size_confirmed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.restaurant_inventory.pour_size_confirmed_by IS
  'Who confirmed this wine''s own pour (pour_size_ml), public.users(user_id). NULL = not confirmed: glass advice uses the house''s confirmed pour (founder, 2026-09-21: "Yes, confirmed per wine"). Cleared when pour_size_ml changes without a new confirmation.';
COMMENT ON COLUMN public.restaurant_inventory.pour_size_confirmed_at IS
  'When this wine''s own pour was confirmed. Set with pour_size_confirmed_by, or neither.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurant_inventory_pour_confirmation_names_its_author'
       AND conrelid = to_regclass('public.restaurant_inventory')
  ) THEN
    ALTER TABLE public.restaurant_inventory
      ADD CONSTRAINT restaurant_inventory_pour_confirmation_names_its_author
      CHECK (
        (pour_size_confirmed_by IS NULL AND pour_size_confirmed_at IS NULL)
        OR
        (pour_size_confirmed_by IS NOT NULL
          AND pour_size_confirmed_at IS NOT NULL
          AND pour_size_ml IS NOT NULL
          AND pour_size_ml >= 10
          AND pour_size_ml <= 500)
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.a_changed_pour_is_no_longer_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.pour_size_ml IS DISTINCT FROM OLD.pour_size_ml
     AND NEW.pour_size_confirmed_at IS NOT DISTINCT FROM OLD.pour_size_confirmed_at THEN
    NEW.pour_size_confirmed_by := NULL;
    NEW.pour_size_confirmed_at := NULL;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.a_changed_pour_is_no_longer_confirmed() IS
  'ADR 0193 round 3 (answer 3): a wine''s pour that changes without a new confirmation stops being confirmed, so glass advice falls back to the house''s confirmed pour.';
REVOKE ALL ON FUNCTION public.a_changed_pour_is_no_longer_confirmed() FROM PUBLIC;

DROP TRIGGER IF EXISTS a_changed_pour_is_no_longer_confirmed ON public.restaurant_inventory;
CREATE TRIGGER a_changed_pour_is_no_longer_confirmed
  BEFORE UPDATE OF pour_size_ml
  ON public.restaurant_inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.a_changed_pour_is_no_longer_confirmed();

DO $$
DECLARE
  confirmed bigint;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'restaurant_inventory'
         AND column_name IN ('pour_size_confirmed_by', 'pour_size_confirmed_at')
         AND column_default IS NULL) <> 2 THEN
    RAISE EXCEPTION 'the two per-wine pour-confirmation columns are missing, or one carries a default';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = to_regclass('public.restaurant_inventory')
       AND con.contype = 'f'
       AND att.attname = 'pour_size_confirmed_by'
       AND con.confrelid = to_regclass('public.users')
  ) THEN
    RAISE EXCEPTION 'restaurant_inventory.pour_size_confirmed_by does not reference public.users';
  END IF;
  SELECT count(*) INTO confirmed FROM public.restaurant_inventory WHERE pour_size_confirmed_at IS NOT NULL;
  IF confirmed <> 0 THEN
    RAISE EXCEPTION 'this migration confirmed % wine pours; it must confirm none', confirmed;
  END IF;
  RAISE NOTICE 'per-wine pour: two columns, no default, author FK to public.users, a changed pour loses its confirmation, zero wines confirmed';
END
$$;
