-- A ZONE CAN SIT INSIDE ANOTHER ZONE.
--
-- Founder answer, 2026-09-29, verbatim pick: "Add parent column (Recommended)"
-- -- the option read: "Add a parent_id column (one migration) so zones can
-- nest, e.g. Cellar → Rack A → Shelf 2."
--
-- WHY. The zone editor has offered a "Parent Location" picker since P2, and
-- storage_locations never had a column for it (baseline
-- 20260805000000_baseline_from_production.sql, CREATE TABLE at :5487). The
-- gateway dropped the value and answered 200; PR #510 (fix/storage-location-
-- writes) turned that into an honest 422. This migration gives the value a
-- place to live, so the 422 becomes a real write.
--
-- WHAT THE DATABASE ITSELF GUARANTEES, whatever path writes the row (the
-- gateway, the orchestrator's service role, a hand-run SQL console):
--
--   1. parent_id references storage_locations(id). A hard DELETE of a parent
--      sets its children's parent_id to NULL (ON DELETE SET NULL): the
--      children stay, at the top level.
--   2. A zone is never its own parent (CHECK storage_locations_parent_is_not_self).
--   3. A parent is a zone of the SAME restaurant and is not soft-deleted
--      (trigger storage_locations_parent_guard). A cross-tenant parent would
--      let one house's zone tree name another house's row.
--   4. No cycle: the new parent's ancestor chain may not contain the zone
--      itself (same trigger). A CHECK cannot see other rows, so this is a
--      trigger. Parent changes within one restaurant are serialised by a
--      transaction-scoped advisory lock keyed on the restaurant, so two
--      concurrent moves (A under B, B under A) cannot each pass a check the
--      other invalidates.
--   5. A zone whose restaurant_id changes may not keep children or a parent
--      in the old restaurant (same trigger).
--   6. The gateway's delete is a SOFT delete (deleted_at). ON DELETE SET NULL
--      does not fire for that, so trigger storage_locations_orphans_go_top_level
--      clears parent_id on the children when deleted_at goes from NULL to a
--      time. Same outcome as a hard delete: the children become top-level.
--
-- DEPTH IS NOT CAPPED. Whether nesting should stop at some depth is an open
-- founder fork (filed in the PR, not decided here); the cycle guard's walk is
-- bounded by the restaurant's own zone count, not by a depth constant.
--
-- RLS. storage_locations has RLS enabled and no policies (baseline :15083; no
-- migration adds one): only the service role reads or writes it. A new column
-- inherits that; nothing here changes a policy or a grant.
--
-- Additive and idempotent. No row is changed: every existing zone arrives
-- parent_id NULL, which is what the table has always meant. No explicit
-- BEGIN/COMMIT: the Supabase CLI wraps each migration file in a transaction.
-- The closing DO block asserts the shape only; it writes no probe row.

ALTER TABLE public.storage_locations
  ADD COLUMN IF NOT EXISTS parent_id uuid
    REFERENCES public.storage_locations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.storage_locations.parent_id IS
  'The zone this zone sits inside (Cellar > Rack A > Shelf 2). NULL = top level. Same restaurant, never itself, never a cycle (trigger storage_locations_parent_guard). Deleting the parent, hard or soft, makes this zone top-level.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'storage_locations_parent_is_not_self'
      AND conrelid = to_regclass('public.storage_locations')
  ) THEN
    ALTER TABLE public.storage_locations
      ADD CONSTRAINT storage_locations_parent_is_not_self
      CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_storage_locations_parent
  ON public.storage_locations (parent_id)
  WHERE parent_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.storage_locations_parent_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  parent_house uuid;
  parent_gone timestamptz;
  loops boolean;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id
     AND NEW.restaurant_id IS NOT DISTINCT FROM OLD.restaurant_id THEN
    RETURN NEW;
  END IF;
  -- A new top-level zone joins no tree: nothing to check, no lock to take.
  IF TG_OP = 'INSERT' AND NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Serialise every parent change inside this restaurant (rule 4).
  PERFORM pg_advisory_xact_lock(
    hashtextextended('storage_locations.parent_id:' || NEW.restaurant_id::text, 0));

  -- Rule 5: a zone moving house takes no tree with it.
  IF TG_OP = 'UPDATE' AND NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
     AND EXISTS (SELECT 1 FROM public.storage_locations c
                 WHERE c.parent_id = NEW.id AND c.restaurant_id <> NEW.restaurant_id) THEN
    RAISE EXCEPTION 'storage zone % has zones inside it in another restaurant', NEW.id
      USING ERRCODE = 'check_violation',
            HINT = 'Move or clear the zones inside it first.';
  END IF;

  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'A zone cannot sit inside itself.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Rule 3: same restaurant, not soft-deleted. FOR SHARE so the parent cannot
  -- be moved or deleted between this read and the commit.
  SELECT p.restaurant_id, p.deleted_at INTO parent_house, parent_gone
  FROM public.storage_locations p
  WHERE p.id = NEW.parent_id
  FOR SHARE;

  IF NOT FOUND OR parent_house IS DISTINCT FROM NEW.restaurant_id THEN
    RAISE EXCEPTION 'The parent zone is not a zone of this restaurant.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF parent_gone IS NOT NULL THEN
    RAISE EXCEPTION 'The parent zone has been deleted.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Rule 4: walk up from the new parent. UNION (not UNION ALL) stops on a
  -- repeated row, so even a pre-existing cycle cannot make this loop forever.
  WITH RECURSIVE up(id, parent_id) AS (
    SELECT p.id, p.parent_id FROM public.storage_locations p WHERE p.id = NEW.parent_id
    UNION
    SELECT s.id, s.parent_id
    FROM public.storage_locations s
    JOIN up ON s.id = up.parent_id
  )
  SELECT EXISTS (SELECT 1 FROM up WHERE up.id = NEW.id) INTO loops;

  IF loops THEN
    RAISE EXCEPTION 'That parent is already inside this zone; a zone cannot sit inside its own contents.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS storage_locations_parent_guard ON public.storage_locations;
CREATE TRIGGER storage_locations_parent_guard
  BEFORE INSERT OR UPDATE OF parent_id, restaurant_id ON public.storage_locations
  FOR EACH ROW EXECUTE FUNCTION public.storage_locations_parent_guard();

CREATE OR REPLACE FUNCTION public.storage_locations_orphans_go_top_level()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.storage_locations
     SET parent_id = NULL, updated_at = now()
   WHERE parent_id = NEW.id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS storage_locations_orphans_go_top_level ON public.storage_locations;
CREATE TRIGGER storage_locations_orphans_go_top_level
  AFTER UPDATE OF deleted_at ON public.storage_locations
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION public.storage_locations_orphans_go_top_level();

-- Shape assertions. Reads the catalogue only; writes no row.
DO $$
DECLARE
  fk_action "char";
BEGIN
  SELECT c.confdeltype INTO fk_action
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = to_regclass('public.storage_locations')
    AND c.contype = 'f'
    AND c.confrelid = to_regclass('public.storage_locations')
    AND a.attname = 'parent_id';
  IF fk_action IS DISTINCT FROM 'n' THEN
    RAISE EXCEPTION 'storage_locations.parent_id must reference storage_locations ON DELETE SET NULL; found %',
      coalesce(fk_action::text, 'no foreign key');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgrelid = to_regclass('public.storage_locations')
                   AND tgname = 'storage_locations_parent_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'storage_locations_parent_guard was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgrelid = to_regclass('public.storage_locations')
                   AND tgname = 'storage_locations_orphans_go_top_level' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'storage_locations_orphans_go_top_level was not created';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
          WHERE oid = to_regclass('public.storage_locations')) THEN
    RAISE EXCEPTION 'storage_locations has RLS off';
  END IF;
END $$;
