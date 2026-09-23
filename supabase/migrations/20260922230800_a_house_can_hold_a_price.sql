-- A house can hold a price: a lock on its bottle or glass price that no menu,
-- correction, edit or accepted advice can move, set and released only by its
-- owners and managers, and kept on the record for good.
--
-- THE FOUNDER, 2026-09-21 (round 6c), verbatim, answering "a manager re-picks
-- an OLDER menu as current: should its prices come back?":
--   "add a section to that where you can lock price, but wha f that menu item
--    disappears? so think verify validate your decision and build"
-- He delegated the design on condition it is researched, adversarially
-- validated and then built. The decision, its 27 rules (L1-L27) and the
-- alternatives it rejected are in ADR 0193, "Amendment, round 3".
-- ---------------------------------------------------------------------------
-- WHAT THIS ADDS
--
--   1. house_price_locks: one row per lock. An open lock (released_at NULL)
--      holds ONE kind (bottle or glass) of ONE house wine at the price it had
--      when the lock was set (L1, L2). A partial UNIQUE allows one open lock
--      per wine and kind; bottle and glass are independent. The table is its
--      own audit and append-only (L9): while a lock is open only its release
--      may be written, once; a released lock is history and only its wine may
--      follow a library merge. RLS on, no policy: the gateway (service_role)
--      is the only reader and writer. No path in the product deletes a row;
--      deleting the HOUSE removes its locks (restaurant_id ON DELETE CASCADE),
--      and a lock's wine cannot be deleted from under it (inventory_id is
--      ON DELETE NO ACTION), so a library-row delete that would cascade to a
--      locked wine is refused (L21).
--   2. A BEFORE UPDATE guard on restaurant_inventory (L4): a value change to a
--      locked price is refused from ANY writer, with the lock named. The lock
--      functions below release a lock before they write, so they pass.
--   3. set_house_menu_price, 13 arguments (adds p_menu_id): reads the open
--      locks under the wine row's FOR UPDATE, writes nothing for a held kind
--      and says so per kind (L4, L5): overall outcome 'locked' when every
--      named kind was held, and a `held` list naming each lock otherwise.
--      The 12-argument form stays, as a wrapper that passes no menu, so no
--      caller of the old signature can bypass a lock either.
--   4. menu_price_versions.menu_id: which menu set a price (L11), nullable,
--      ON DELETE SET NULL. Filled by set_house_menu_price's hand-over.
--   5. make_menu_current also returns made_current_at, the moment of the
--      choice: a chosen menu's prices are dated by it (L11), not by the scan.
--   6. The four acts, each taking the wine row FOR UPDATE first (L27):
--      lock_house_menu_price, release_house_price_lock,
--      change_locked_house_menu_price ("change and keep locked", L6) and
--      move_house_price_lock (L20).
--   7. menu_items.price_flag admits 'blank_no_house_price' (round 6c answer 4,
--      "Flag it"): a line with no price at all for a wine the house has no
--      price for.
--
-- ACTOR FKs go to public.users(user_id), never auth.users, ON DELETE RESTRICT
-- (the name stays resolvable, L10). Every function is SECURITY INVOKER,
-- revoked from PUBLIC, anon and authenticated, granted to service_role.
--
-- Additive and idempotent: CREATE ... IF NOT EXISTS, CREATE OR REPLACE,
-- DROP TRIGGER IF EXISTS before CREATE TRIGGER, constraints added only when
-- absent. The one constraint replaced is menu_items_price_flag_check, WIDENED
-- (it admits one more value), never narrowed. This migration writes no row.

-- ---------------------------------------------------------------------------
-- 1. The lock table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.house_price_locks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id      uuid NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_id       uuid NOT NULL
    REFERENCES public.restaurant_inventory(id) ON DELETE NO ACTION,
  kind               text NOT NULL,
  locked_price       numeric(10,2) NOT NULL,
  locked_by          uuid NOT NULL
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  locked_at          timestamptz NOT NULL DEFAULT now(),
  note               text,
  released_by        uuid
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  released_at        timestamptz,
  release_note       text,
  moved_from_lock_id uuid
    REFERENCES public.house_price_locks(id) ON DELETE NO ACTION,
  CONSTRAINT house_price_locks_kind_check CHECK (kind IN ('bottle', 'glass')),
  CONSTRAINT house_price_locks_price_check CHECK (locked_price >= 0),
  CONSTRAINT house_price_locks_release_names_its_author CHECK (
    (released_by IS NULL) = (released_at IS NULL)
    AND (release_note IS NULL OR released_at IS NOT NULL)
    AND (released_at IS NULL OR released_at >= locked_at)
  ),
  CONSTRAINT house_price_locks_not_its_own_origin CHECK (moved_from_lock_id IS DISTINCT FROM id)
);

COMMENT ON TABLE public.house_price_locks IS
  'ADR 0193 round 3: a house holds its bottle or glass price. One open lock (released_at NULL) per wine and kind; while open, no writer may change that price. Append-only: only a release is ever written to a row, and no product path deletes one. Set, changed, moved and released only by owners and managers (the gateway checks).';
COMMENT ON COLUMN public.house_price_locks.locked_price IS
  'The house''s price for this kind at the moment the lock was set (or the price a change-and-keep or a move named). While the lock is open the house price equals it.';
COMMENT ON COLUMN public.house_price_locks.moved_from_lock_id IS
  'The lock this one takes over from: a MOVE to another wine (a person linking a returning wine by hand), or a CHANGE AND KEEP LOCKED on the same wine. NULL for a lock set fresh.';

CREATE UNIQUE INDEX IF NOT EXISTS house_price_locks_one_open
  ON public.house_price_locks (inventory_id, kind)
  WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS house_price_locks_house_open
  ON public.house_price_locks (restaurant_id)
  WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS house_price_locks_moved_from
  ON public.house_price_locks (moved_from_lock_id)
  WHERE moved_from_lock_id IS NOT NULL;

ALTER TABLE public.house_price_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.house_price_locks FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.house_price_locks FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.house_price_locks FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    -- Read, set and release. Never DELETE or TRUNCATE (L9): a lock is
    -- removed only with its house, by the FK cascade.
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.house_price_locks TO service_role';
    EXECUTE 'REVOKE DELETE, TRUNCATE ON TABLE public.house_price_locks FROM service_role';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. The lock row is append-only, and names a wine of its own house.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.house_price_lock_is_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Whatever the act, the wine must be a wine of the lock's own house (L26).
  IF NOT EXISTS (SELECT 1 FROM public.restaurant_inventory
                  WHERE id = NEW.inventory_id AND restaurant_id = NEW.restaurant_id) THEN
    RAISE EXCEPTION 'house_price_locks: wine % is not a wine of house %; a lock holds a price of its own house only', NEW.inventory_id, NEW.restaurant_id
      USING ERRCODE = 'HPL05';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.released_at IS NOT NULL THEN
      RAISE EXCEPTION 'house_price_locks: a lock is set open; it is released by an act of its own'
        USING ERRCODE = 'HPL05';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.locked_price IS DISTINCT FROM OLD.locked_price
     OR NEW.locked_by IS DISTINCT FROM OLD.locked_by
     OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.moved_from_lock_id IS DISTINCT FROM OLD.moved_from_lock_id THEN
    RAISE EXCEPTION 'house_price_locks: lock % of house % is on the record as it was set; only its release may be written', OLD.id, OLD.restaurant_id
      USING ERRCODE = 'HPL05';
  END IF;

  IF OLD.released_at IS NOT NULL THEN
    -- A released lock is history. Its wine may follow a library merge (the
    -- generic repoint of merge_library_wines' loop 1), nothing else moves.
    IF NEW.released_at IS DISTINCT FROM OLD.released_at
       OR NEW.released_by IS DISTINCT FROM OLD.released_by
       OR NEW.release_note IS DISTINCT FROM OLD.release_note THEN
      RAISE EXCEPTION 'house_price_locks: lock % of house % was released at %; a release is written once', OLD.id, OLD.restaurant_id, OLD.released_at
        USING ERRCODE = 'HPL05';
    END IF;
    RETURN NEW;
  END IF;

  -- An open lock: its wine never changes under it. A library merge that
  -- would move it aborts here, naming the house and the lock (L21; merge
  -- loop 1's own rule, "aborting is the safe direction").
  IF NEW.inventory_id IS DISTINCT FROM OLD.inventory_id THEN
    RAISE EXCEPTION 'house_price_locks: the % price of wine % at house % is locked (lock %, % since %); an open lock cannot move to another wine. A person releases it or moves it first; nothing was changed', OLD.kind, OLD.inventory_id, OLD.restaurant_id, OLD.id, OLD.locked_price, OLD.locked_at
      USING ERRCODE = 'HPL05';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.house_price_lock_is_append_only() IS
  'ADR 0193 L9/L21/L26: a lock names a wine of its own house; only its release is ever written, once; an open lock never moves to another wine (a library merge that would move one aborts); a released lock may follow its wine in a merge.';
REVOKE ALL ON FUNCTION public.house_price_lock_is_append_only() FROM PUBLIC;

DROP TRIGGER IF EXISTS house_price_lock_is_append_only ON public.house_price_locks;
CREATE TRIGGER house_price_lock_is_append_only
  BEFORE INSERT OR UPDATE ON public.house_price_locks
  FOR EACH ROW
  EXECUTE FUNCTION public.house_price_lock_is_append_only();

-- ---------------------------------------------------------------------------
-- 3. The guard: no writer changes a locked price.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.house_price_lock_holds_the_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lock record;
BEGIN
  IF NEW.menu_price_current IS DISTINCT FROM OLD.menu_price_current THEN
    SELECT id, locked_price, locked_at INTO v_lock
      FROM public.house_price_locks
     WHERE inventory_id = OLD.id AND kind = 'bottle' AND released_at IS NULL;
    IF FOUND THEN
      RAISE EXCEPTION 'the bottle price of wine % is locked at % since % (lock %); it was not changed. An owner or manager changes it and keeps it locked, or releases the lock first', OLD.id, v_lock.locked_price, v_lock.locked_at, v_lock.id
        USING ERRCODE = 'HPL01';
    END IF;
  END IF;
  IF NEW.menu_price_glass IS DISTINCT FROM OLD.menu_price_glass THEN
    SELECT id, locked_price, locked_at INTO v_lock
      FROM public.house_price_locks
     WHERE inventory_id = OLD.id AND kind = 'glass' AND released_at IS NULL;
    IF FOUND THEN
      RAISE EXCEPTION 'the glass price of wine % is locked at % since % (lock %); it was not changed. An owner or manager changes it and keeps it locked, or releases the lock first', OLD.id, v_lock.locked_price, v_lock.locked_at, v_lock.id
        USING ERRCODE = 'HPL01';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.house_price_lock_holds_the_price() IS
  'ADR 0193 L4: refuses (HPL01) a change to a house price whose kind has an open lock, from any writer. set_house_menu_price never reaches it (it skips a held kind); the lock acts release before they write.';
REVOKE ALL ON FUNCTION public.house_price_lock_holds_the_price() FROM PUBLIC;

DROP TRIGGER IF EXISTS house_price_lock_holds_the_price ON public.restaurant_inventory;
CREATE TRIGGER house_price_lock_holds_the_price
  BEFORE UPDATE OF menu_price_current, menu_price_glass
  ON public.restaurant_inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.house_price_lock_holds_the_price();

-- ---------------------------------------------------------------------------
-- 4. Which menu set a price.
-- ---------------------------------------------------------------------------
ALTER TABLE public.menu_price_versions
  ADD COLUMN IF NOT EXISTS menu_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'menu_price_versions_menu_id_fkey'
       AND conrelid = to_regclass('public.menu_price_versions')
  ) THEN
    ALTER TABLE public.menu_price_versions
      ADD CONSTRAINT menu_price_versions_menu_id_fkey
      FOREIGN KEY (menu_id) REFERENCES public.restaurant_menus(id) ON DELETE SET NULL;
  END IF;
END
$$;
COMMENT ON COLUMN public.menu_price_versions.menu_id IS
  'The menu whose choice (or whose line) set this price, when a menu did (ADR 0193 L11). NULL for a person''s edit, an accepted advice, a backfill, and every row written before menus were kept.';

-- The version trigger learns the menu (same body as 20260922230400, plus the
-- menu id hand-over).
CREATE OR REPLACE FUNCTION public.record_house_menu_price_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source   text := nullif(current_setting('mudavym.menu_price_source', true), '');
  v_by       uuid := nullif(current_setting('mudavym.menu_price_changed_by', true), '')::uuid;
  v_from     timestamptz := nullif(current_setting('mudavym.menu_price_effective_from', true), '')::timestamptz;
  v_reason   text := nullif(current_setting('mudavym.menu_price_reason', true), '');
  v_cost     numeric := nullif(current_setting('mudavym.menu_price_unit_cost', true), '')::numeric;
  v_analysis uuid := nullif(current_setting('mudavym.menu_price_analysis_id', true), '')::uuid;
  v_menu     uuid := nullif(current_setting('mudavym.menu_price_menu_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.menu_price_current IS NULL AND NEW.menu_price_glass IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.menu_price_current IS NOT DISTINCT FROM OLD.menu_price_current
       AND NEW.menu_price_glass IS NOT DISTINCT FROM OLD.menu_price_glass THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_source IS NULL THEN
    v_source := 'manual';
    v_reason := coalesce(v_reason,
      'written without set_house_menu_price: no person or source was named');
  END IF;
  v_from := coalesce(v_from, now());

  UPDATE public.menu_price_versions
     SET effective_to = greatest(v_from, effective_from)
   WHERE inventory_id = NEW.id
     AND effective_to IS NULL;

  INSERT INTO public.menu_price_versions
    (restaurant_id, inventory_id, bottle_price, glass_price, unit_cost,
     effective_from, change_source, changed_by, pricing_analysis_id, reason, menu_id)
  VALUES
    (NEW.restaurant_id, NEW.id, NEW.menu_price_current, NEW.menu_price_glass,
     v_cost, v_from, v_source, v_by, v_analysis, v_reason, v_menu);

  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. The one gateway writer, now holding locks and naming the menu.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_house_menu_price(
  p_restaurant_id        uuid,
  p_inventory_id         uuid,
  p_set_bottle           boolean,
  p_bottle_price         numeric,
  p_set_glass            boolean,
  p_glass_price          numeric,
  p_change_source        text,
  p_changed_by           uuid,
  p_effective_from       timestamptz,
  p_reason               text,
  p_unit_cost            numeric,
  p_pricing_analysis_id  uuid,
  p_menu_id              uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row         record;
  v_open        record;
  v_has_open    boolean;
  v_from        timestamptz;
  v_bottle      numeric;
  v_glass       numeric;
  v_version     uuid;
  v_named_b     boolean := coalesce(p_set_bottle, false);
  v_named_g     boolean := coalesce(p_set_glass, false);
  v_lock_b      record;
  v_lock_g      record;
  v_held_b      boolean := false;
  v_held_g      boolean := false;
  v_held        jsonb := '[]'::jsonb;
  v_kinds       jsonb;
BEGIN
  IF p_change_source IS NULL
     OR p_change_source NOT IN ('manual', 'agent_accepted', 'import') THEN
    RAISE EXCEPTION 'set_house_menu_price: change_source must be manual, agent_accepted or import, got %', p_change_source
      USING ERRCODE = '22023';
  END IF;
  IF p_changed_by IS NULL THEN
    RAISE EXCEPTION 'set_house_menu_price: a price change names the person who made it (changed_by is NULL); nothing was changed'
      USING ERRCODE = '22023';
  END IF;
  IF NOT v_named_b AND NOT v_named_g THEN
    RAISE EXCEPTION 'set_house_menu_price: neither the bottle nor the glass price was named; nothing was changed'
      USING ERRCODE = '22023';
  END IF;
  IF (v_named_b AND p_bottle_price < 0) OR (v_named_g AND p_glass_price < 0) THEN
    RAISE EXCEPTION 'set_house_menu_price: a price cannot be negative; nothing was changed'
      USING ERRCODE = '22023';
  END IF;

  v_from := coalesce(p_effective_from, now());
  IF v_from > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'set_house_menu_price: a price change cannot be dated in the future (%); nothing was changed', v_from
      USING ERRCODE = '22023';
  END IF;

  -- The house check, and the lock that serialises every price write and every
  -- lock act on one wine (L27).
  SELECT id, menu_price_current, menu_price_glass
    INTO v_row
    FROM public.restaurant_inventory
   WHERE id = p_inventory_id
     AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_house_menu_price: no inventory item % in house %; nothing was changed', p_inventory_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  -- THE LOCKS (ADR 0193 L4). Read under the wine row's lock: every lock act
  -- takes the same row lock first, so none can open or close in between.
  IF v_named_b THEN
    SELECT id, locked_price, locked_by, locked_at INTO v_lock_b
      FROM public.house_price_locks
     WHERE inventory_id = p_inventory_id AND kind = 'bottle' AND released_at IS NULL;
    v_held_b := FOUND;
    IF v_held_b THEN
      v_held := v_held || jsonb_build_array(jsonb_build_object(
        'kind', 'bottle', 'lock_id', v_lock_b.id, 'locked_price', v_lock_b.locked_price,
        'locked_by', v_lock_b.locked_by, 'locked_at', v_lock_b.locked_at));
    END IF;
  END IF;
  IF v_named_g THEN
    SELECT id, locked_price, locked_by, locked_at INTO v_lock_g
      FROM public.house_price_locks
     WHERE inventory_id = p_inventory_id AND kind = 'glass' AND released_at IS NULL;
    v_held_g := FOUND;
    IF v_held_g THEN
      v_held := v_held || jsonb_build_array(jsonb_build_object(
        'kind', 'glass', 'lock_id', v_lock_g.id, 'locked_price', v_lock_g.locked_price,
        'locked_by', v_lock_g.locked_by, 'locked_at', v_lock_g.locked_at));
    END IF;
  END IF;

  -- Every named kind held: nothing to write, and it says so (L5).
  IF (NOT v_named_b OR v_held_b) AND (NOT v_named_g OR v_held_g) THEN
    RETURN jsonb_build_object(
      'outcome', 'locked',
      'bottle_price', v_row.menu_price_current,
      'glass_price', v_row.menu_price_glass,
      'held', v_held,
      'kinds', jsonb_build_object(
        'bottle', CASE WHEN v_named_b THEN 'locked' END,
        'glass', CASE WHEN v_named_g THEN 'locked' END)
    );
  END IF;

  SELECT id, effective_from, change_source
    INTO v_open
    FROM public.menu_price_versions
   WHERE inventory_id = p_inventory_id
     AND effective_to IS NULL;
  v_has_open := FOUND;

  -- THE NEWEST DATED CHANGE WINS (unchanged from 20260922230400).
  IF v_has_open AND v_from < v_open.effective_from THEN
    RETURN jsonb_build_object(
      'outcome', 'stale',
      'bottle_price', v_row.menu_price_current,
      'glass_price', v_row.menu_price_glass,
      'current_since', v_open.effective_from,
      'current_source', v_open.change_source,
      'held', v_held,
      'kinds', jsonb_build_object(
        'bottle', CASE WHEN NOT v_named_b THEN NULL WHEN v_held_b THEN 'locked' ELSE 'stale' END,
        'glass', CASE WHEN NOT v_named_g THEN NULL WHEN v_held_g THEN 'locked' ELSE 'stale' END)
    );
  END IF;

  v_bottle := CASE WHEN v_named_b AND NOT v_held_b
                   THEN round(p_bottle_price, 2) ELSE v_row.menu_price_current END;
  v_glass  := CASE WHEN v_named_g AND NOT v_held_g
                   THEN round(p_glass_price, 2) ELSE v_row.menu_price_glass END;

  v_kinds := jsonb_build_object(
    'bottle', CASE WHEN NOT v_named_b THEN NULL WHEN v_held_b THEN 'locked'
                   WHEN v_bottle IS NOT DISTINCT FROM v_row.menu_price_current THEN 'unchanged'
                   ELSE 'changed' END,
    'glass', CASE WHEN NOT v_named_g THEN NULL WHEN v_held_g THEN 'locked'
                  WHEN v_glass IS NOT DISTINCT FROM v_row.menu_price_glass THEN 'unchanged'
                  ELSE 'changed' END);

  IF v_bottle IS NOT DISTINCT FROM v_row.menu_price_current
     AND v_glass IS NOT DISTINCT FROM v_row.menu_price_glass THEN
    RETURN jsonb_build_object(
      'outcome', 'unchanged',
      'bottle_price', v_row.menu_price_current,
      'glass_price', v_row.menu_price_glass,
      'held', v_held,
      'kinds', v_kinds
    );
  END IF;

  PERFORM set_config('mudavym.menu_price_source', p_change_source, true);
  PERFORM set_config('mudavym.menu_price_changed_by', p_changed_by::text, true);
  PERFORM set_config('mudavym.menu_price_effective_from', v_from::text, true);
  PERFORM set_config('mudavym.menu_price_reason', coalesce(p_reason, ''), true);
  PERFORM set_config('mudavym.menu_price_unit_cost', coalesce(p_unit_cost::text, ''), true);
  PERFORM set_config('mudavym.menu_price_analysis_id', coalesce(p_pricing_analysis_id::text, ''), true);
  PERFORM set_config('mudavym.menu_price_menu_id', coalesce(p_menu_id::text, ''), true);

  UPDATE public.restaurant_inventory
     SET menu_price_current = v_bottle,
         menu_price_glass   = v_glass
   WHERE id = p_inventory_id
     AND restaurant_id = p_restaurant_id;

  PERFORM set_config('mudavym.menu_price_source', '', true);
  PERFORM set_config('mudavym.menu_price_changed_by', '', true);
  PERFORM set_config('mudavym.menu_price_effective_from', '', true);
  PERFORM set_config('mudavym.menu_price_reason', '', true);
  PERFORM set_config('mudavym.menu_price_unit_cost', '', true);
  PERFORM set_config('mudavym.menu_price_analysis_id', '', true);
  PERFORM set_config('mudavym.menu_price_menu_id', '', true);

  SELECT id INTO v_version
    FROM public.menu_price_versions
   WHERE inventory_id = p_inventory_id
     AND effective_to IS NULL;

  RETURN jsonb_build_object(
    'outcome', 'changed',
    'bottle_price', v_bottle,
    'glass_price', v_glass,
    'previous_bottle', v_row.menu_price_current,
    'previous_glass', v_row.menu_price_glass,
    'effective_from', v_from,
    'version_id', v_version,
    'held', v_held,
    'kinds', v_kinds
  );
END
$$;

COMMENT ON FUNCTION public.set_house_menu_price(uuid, uuid, boolean, numeric, boolean, numeric, text, uuid, timestamptz, text, numeric, uuid, uuid) IS
  'ADR 0193 (+ round 3): the one gateway writer of a house''s bottle and glass price. House-scoped; takes the wine row FOR UPDATE; writes nothing for a kind with an open lock (outcome locked when every named kind was held; `held` names each lock and `kinds` says per kind); refuses a change dated before the price in effect (stale); skips a no-op (unchanged); records the menu that set a price (menu_id).';

-- The 12-argument form (20260922230400) delegates, so an old caller cannot
-- bypass a lock and gets the same answers.
CREATE OR REPLACE FUNCTION public.set_house_menu_price(
  p_restaurant_id        uuid,
  p_inventory_id         uuid,
  p_set_bottle           boolean,
  p_bottle_price         numeric,
  p_set_glass            boolean,
  p_glass_price          numeric,
  p_change_source        text,
  p_changed_by           uuid,
  p_effective_from       timestamptz DEFAULT NULL,
  p_reason               text DEFAULT NULL,
  p_unit_cost            numeric DEFAULT NULL,
  p_pricing_analysis_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  SELECT public.set_house_menu_price(
    p_restaurant_id, p_inventory_id, p_set_bottle, p_bottle_price, p_set_glass,
    p_glass_price, p_change_source, p_changed_by, p_effective_from, p_reason,
    p_unit_cost, p_pricing_analysis_id, NULL::uuid)
$$;

-- ---------------------------------------------------------------------------
-- 6. make_menu_current returns the moment of the choice (L11).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.make_menu_current(
  p_restaurant_id uuid,
  p_menu_id       uuid,
  p_actor         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_menu     record;
  v_previous uuid[];
  v_at       timestamptz := now();
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'make_menu_current: choosing the current menu names the person who chose it (actor is NULL); nothing was changed'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.restaurants WHERE id = p_restaurant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'make_menu_current: no restaurant %; nothing was changed', p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT id, status, made_current_at
    INTO v_menu
    FROM public.restaurant_menus
   WHERE id = p_menu_id
     AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'make_menu_current: no menu % in house %; nothing was changed', p_menu_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_menu.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM public.restaurant_menus
                      WHERE restaurant_id = p_restaurant_id
                        AND status = 'active'
                        AND id <> p_menu_id) THEN
    RETURN jsonb_build_object('outcome', 'already_current', 'menu_id', p_menu_id,
                              'previous_menu_ids', '[]'::jsonb,
                              'made_current_at', v_menu.made_current_at);
  END IF;

  WITH retired AS (
    UPDATE public.restaurant_menus
       SET status = 'archived',
           retired_at = v_at,
           retired_by = p_actor
     WHERE restaurant_id = p_restaurant_id
       AND status = 'active'
       AND id <> p_menu_id
    RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}') INTO v_previous FROM retired;

  UPDATE public.restaurant_menus
     SET status = 'active',
         made_current_at = v_at,
         made_current_by = p_actor,
         retired_at = NULL,
         retired_by = NULL
   WHERE id = p_menu_id
     AND restaurant_id = p_restaurant_id;

  RETURN jsonb_build_object('outcome', 'made_current', 'menu_id', p_menu_id,
                            'previous_menu_ids', to_jsonb(v_previous),
                            'made_current_at', v_at);
END
$$;

-- ---------------------------------------------------------------------------
-- 7. The four acts. Each takes the wine row FOR UPDATE before it reads or
--    writes a lock (L27), so a lock act and a price write never interleave.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_house_menu_price(
  p_restaurant_id uuid,
  p_inventory_id  uuid,
  p_kind          text,
  p_actor         uuid,
  p_note          text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row   record;
  v_price numeric;
  v_open  record;
  v_lock  public.house_price_locks;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('bottle', 'glass') THEN
    RAISE EXCEPTION 'lock_house_menu_price: a lock holds the bottle or the glass price, got %; nothing was locked', p_kind
      USING ERRCODE = '22023';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'lock_house_menu_price: a lock names the person who set it; nothing was locked'
      USING ERRCODE = '22023';
  END IF;

  SELECT id, menu_price_current, menu_price_glass
    INTO v_row
    FROM public.restaurant_inventory
   WHERE id = p_inventory_id
     AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lock_house_menu_price: no wine % in house %; nothing was locked', p_inventory_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  v_price := CASE WHEN p_kind = 'bottle' THEN v_row.menu_price_current ELSE v_row.menu_price_glass END;
  -- L2: a lock holds a price that exists.
  IF v_price IS NULL THEN
    RAISE EXCEPTION 'nothing_to_lock: this house has no % price for this wine, so there is nothing to hold; nothing was locked', p_kind
      USING ERRCODE = 'HPL02';
  END IF;

  SELECT id, locked_price, locked_at INTO v_open
    FROM public.house_price_locks
   WHERE inventory_id = p_inventory_id AND kind = p_kind AND released_at IS NULL;
  IF FOUND THEN
    RAISE EXCEPTION 'already_locked: the % price is already locked at % since % (lock %); nothing was changed', p_kind, v_open.locked_price, v_open.locked_at, v_open.id
      USING ERRCODE = 'HPL03';
  END IF;

  INSERT INTO public.house_price_locks (restaurant_id, inventory_id, kind, locked_price, locked_by, note)
  VALUES (p_restaurant_id, p_inventory_id, p_kind, v_price, p_actor, nullif(btrim(p_note), ''))
  RETURNING * INTO v_lock;

  RETURN jsonb_build_object('outcome', 'locked', 'lock', to_jsonb(v_lock));
END
$$;

CREATE OR REPLACE FUNCTION public.release_house_price_lock(
  p_restaurant_id uuid,
  p_lock_id       uuid,
  p_actor         uuid,
  p_note          text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv   uuid;
  v_row   record;
  v_lock  public.house_price_locks;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'release_house_price_lock: a release names the person who made it; nothing was released'
      USING ERRCODE = '22023';
  END IF;

  SELECT inventory_id INTO v_inv
    FROM public.house_price_locks
   WHERE id = p_lock_id AND restaurant_id = p_restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'release_house_price_lock: no lock % in house %; nothing was released', p_lock_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT id, menu_price_current, menu_price_glass INTO v_row
    FROM public.restaurant_inventory
   WHERE id = v_inv AND restaurant_id = p_restaurant_id
   FOR UPDATE;

  SELECT * INTO v_lock FROM public.house_price_locks WHERE id = p_lock_id FOR UPDATE;
  IF v_lock.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'lock_not_open: lock % was already released at %; nothing was changed', p_lock_id, v_lock.released_at
      USING ERRCODE = 'HPL04';
  END IF;

  -- L24: releasing never changes a price.
  UPDATE public.house_price_locks
     SET released_by = p_actor,
         released_at = greatest(now(), locked_at),
         release_note = nullif(btrim(p_note), '')
   WHERE id = p_lock_id
  RETURNING * INTO v_lock;

  RETURN jsonb_build_object(
    'outcome', 'released',
    'lock', to_jsonb(v_lock),
    'house_price', CASE WHEN v_lock.kind = 'bottle' THEN v_row.menu_price_current ELSE v_row.menu_price_glass END
  );
END
$$;

CREATE OR REPLACE FUNCTION public.change_locked_house_menu_price(
  p_restaurant_id uuid,
  p_lock_id       uuid,
  p_price         numeric,
  p_actor         uuid,
  p_note          text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv    uuid;
  v_lock   public.house_price_locks;
  v_new    public.house_price_locks;
  v_price  numeric;
  v_write  jsonb;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'change_locked_house_menu_price: a change names the person who made it; nothing was changed'
      USING ERRCODE = '22023';
  END IF;
  IF p_price IS NULL OR p_price < 0 THEN
    RAISE EXCEPTION 'change_locked_house_menu_price: the new price is a number of 0 or more; nothing was changed'
      USING ERRCODE = '22023';
  END IF;
  v_price := round(p_price, 2);

  SELECT inventory_id INTO v_inv
    FROM public.house_price_locks
   WHERE id = p_lock_id AND restaurant_id = p_restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'change_locked_house_menu_price: no lock % in house %; nothing was changed', p_lock_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM public.restaurant_inventory
   WHERE id = v_inv AND restaurant_id = p_restaurant_id
   FOR UPDATE;

  SELECT * INTO v_lock FROM public.house_price_locks WHERE id = p_lock_id FOR UPDATE;
  -- L6: the caller names the lock it saw. Anything else open now is a 409.
  IF v_lock.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'lock_not_open: lock % is no longer the open lock on this price (released at %); nothing was changed', p_lock_id, v_lock.released_at
      USING ERRCODE = 'HPL04';
  END IF;
  IF v_price = v_lock.locked_price THEN
    RETURN jsonb_build_object('outcome', 'unchanged', 'lock', to_jsonb(v_lock));
  END IF;

  UPDATE public.house_price_locks
     SET released_by = p_actor,
         released_at = greatest(now(), locked_at),
         release_note = 'changed from ' || v_lock.locked_price || ' to ' || v_price || ' and kept locked'
   WHERE id = p_lock_id;

  v_write := public.set_house_menu_price(
    p_restaurant_id, v_inv,
    v_lock.kind = 'bottle', CASE WHEN v_lock.kind = 'bottle' THEN v_price END,
    v_lock.kind = 'glass',  CASE WHEN v_lock.kind = 'glass' THEN v_price END,
    'manual', p_actor, NULL, 'changed and kept locked', NULL, NULL, NULL::uuid);
  IF v_write->>'outcome' NOT IN ('changed', 'unchanged') THEN
    RAISE EXCEPTION 'change_locked_house_menu_price: the price write answered %; nothing was changed', v_write->>'outcome'
      USING ERRCODE = 'HPL04';
  END IF;

  INSERT INTO public.house_price_locks
    (restaurant_id, inventory_id, kind, locked_price, locked_by, note, moved_from_lock_id)
  VALUES (p_restaurant_id, v_inv, v_lock.kind, v_price, p_actor, nullif(btrim(p_note), ''), p_lock_id)
  RETURNING * INTO v_new;

  RETURN jsonb_build_object(
    'outcome', 'changed_and_locked',
    'previous_lock_id', p_lock_id,
    'previous_price', v_lock.locked_price,
    'lock', to_jsonb(v_new),
    'price_change', v_write
  );
END
$$;

CREATE OR REPLACE FUNCTION public.move_house_price_lock(
  p_restaurant_id       uuid,
  p_lock_id             uuid,
  p_target_inventory_id uuid,
  p_price               numeric,
  p_actor               uuid,
  p_note                text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv     uuid;
  v_n       integer;
  v_lock    public.house_price_locks;
  v_new     public.house_price_locks;
  v_open    record;
  v_price   numeric;
  v_target  record;
  v_write   jsonb;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'move_house_price_lock: a move names the person who made it; nothing was changed'
      USING ERRCODE = '22023';
  END IF;
  -- L20: the price is named by the person, never defaulted.
  IF p_price IS NULL OR p_price < 0 THEN
    RAISE EXCEPTION 'move_house_price_lock: a move names the price the wine is locked at (a number of 0 or more); nothing was changed'
      USING ERRCODE = '22023';
  END IF;
  v_price := round(p_price, 2);

  SELECT inventory_id INTO v_inv
    FROM public.house_price_locks
   WHERE id = p_lock_id AND restaurant_id = p_restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'move_house_price_lock: no lock % in house %; nothing was changed', p_lock_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;
  IF p_target_inventory_id IS NULL OR p_target_inventory_id = v_inv THEN
    RAISE EXCEPTION 'move_house_price_lock: a move names another wine of this house; nothing was changed'
      USING ERRCODE = '22023';
  END IF;

  -- Both wine rows, in one order, so two moves cannot deadlock.
  SELECT count(*) INTO v_n
    FROM (SELECT id FROM public.restaurant_inventory
           WHERE id IN (v_inv, p_target_inventory_id) AND restaurant_id = p_restaurant_id
           ORDER BY id
           FOR UPDATE) AS both_wines;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'move_house_price_lock: no wine % in house %; nothing was changed', p_target_inventory_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_lock FROM public.house_price_locks WHERE id = p_lock_id FOR UPDATE;
  IF v_lock.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'lock_not_open: lock % was released at %; nothing was moved', p_lock_id, v_lock.released_at
      USING ERRCODE = 'HPL04';
  END IF;

  SELECT id, locked_price, locked_at INTO v_open
    FROM public.house_price_locks
   WHERE inventory_id = p_target_inventory_id AND kind = v_lock.kind AND released_at IS NULL;
  IF FOUND THEN
    RAISE EXCEPTION 'already_locked: the % price of the target wine is already locked at % since % (lock %); nothing was moved', v_lock.kind, v_open.locked_price, v_open.locked_at, v_open.id
      USING ERRCODE = 'HPL03';
  END IF;

  SELECT id, coalesce(wine_name, id::text) AS label INTO v_target
    FROM public.restaurant_inventory WHERE id = p_target_inventory_id;

  UPDATE public.house_price_locks
     SET released_by = p_actor,
         released_at = greatest(now(), locked_at),
         release_note = 'moved to ' || v_target.label || ' (' || p_target_inventory_id || ')'
                        || coalesce(': ' || nullif(btrim(p_note), ''), '')
   WHERE id = p_lock_id;

  v_write := public.set_house_menu_price(
    p_restaurant_id, p_target_inventory_id,
    v_lock.kind = 'bottle', CASE WHEN v_lock.kind = 'bottle' THEN v_price END,
    v_lock.kind = 'glass',  CASE WHEN v_lock.kind = 'glass' THEN v_price END,
    'manual', p_actor, NULL, 'a lock moved here from another wine', NULL, NULL, NULL::uuid);
  IF v_write->>'outcome' NOT IN ('changed', 'unchanged') THEN
    RAISE EXCEPTION 'move_house_price_lock: the price write answered %; nothing was moved', v_write->>'outcome'
      USING ERRCODE = 'HPL04';
  END IF;

  INSERT INTO public.house_price_locks
    (restaurant_id, inventory_id, kind, locked_price, locked_by, note, moved_from_lock_id)
  VALUES (p_restaurant_id, p_target_inventory_id, v_lock.kind, v_price, p_actor,
          nullif(btrim(p_note), ''), p_lock_id)
  RETURNING * INTO v_new;

  RETURN jsonb_build_object(
    'outcome', 'moved',
    'previous_lock_id', p_lock_id,
    'lock', to_jsonb(v_new),
    'price_change', v_write
  );
END
$$;

COMMENT ON FUNCTION public.lock_house_menu_price(uuid, uuid, text, uuid, text) IS
  'ADR 0193 L1/L2: holds the house''s current price for one kind of one wine. Refuses a kind with no price (HPL02 nothing_to_lock) and a second open lock (HPL03 already_locked). The gateway checks owner/manager first.';
COMMENT ON FUNCTION public.release_house_price_lock(uuid, uuid, uuid, text) IS
  'ADR 0193 L16/L24: only a person ends a lock; releasing never changes a price. HPL04 when the lock is not open.';
COMMENT ON FUNCTION public.change_locked_house_menu_price(uuid, uuid, numeric, uuid, text) IS
  'ADR 0193 L6: change and keep locked, in one transaction: releases the named open lock (HPL04 if it is not the open one), writes the new price as manual by the person, opens a new lock that takes over from it.';
COMMENT ON FUNCTION public.move_house_price_lock(uuid, uuid, uuid, numeric, uuid, text) IS
  'ADR 0193 L20: a person links a lock to another wine of the house at a price the person names (no default): releases the lock, writes that price as manual on the target, locks it there with moved_from_lock_id.';

-- Grants: service_role only, never anon or authenticated.
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.set_house_menu_price(uuid, uuid, boolean, numeric, boolean, numeric, text, uuid, timestamptz, text, numeric, uuid, uuid)',
    'public.lock_house_menu_price(uuid, uuid, text, uuid, text)',
    'public.release_house_price_lock(uuid, uuid, uuid, text)',
    'public.change_locked_house_menu_price(uuid, uuid, numeric, uuid, text)',
    'public.move_house_price_lock(uuid, uuid, uuid, numeric, uuid, text)'
  ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM PUBLIC';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM authenticated';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO service_role';
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 8. The never-priced blank is flagged too (round 6c answer 4, "Flag it").
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'menu_items_price_flag_known'
                    AND conrelid = to_regclass('public.menu_items')) THEN
    ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_price_flag_check;
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_price_flag_known
      CHECK (
        (price_flag IS NULL AND price_flag_note IS NULL)
        OR (price_flag IN ('blank_kept_last_known', 'blank_no_house_price')
            AND price_flag_note IS NOT NULL)
      );
  END IF;
END
$$;
COMMENT ON COLUMN public.menu_items.price_flag IS
  'blank_kept_last_known: the line showed no price for a kind the house already prices, so the house kept its last known price (founder answer 3). blank_no_house_price: the line shows no price at all and the house has no price for the wine either (round 6c answer 4, "Flag it"). NULL = nothing unclear.';

-- ---------------------------------------------------------------------------
-- Assert the outcome. Catalog reads, and counts that must be zero.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n bigint;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.house_price_locks')) THEN
    RAISE EXCEPTION 'house_price_locks has row level security off';
  END IF;
  IF (SELECT count(*) FROM pg_constraint con
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
       WHERE con.conrelid = to_regclass('public.house_price_locks') AND con.contype = 'f'
         AND att.attname IN ('locked_by', 'released_by')
         AND con.confrelid = to_regclass('public.users')) <> 2 THEN
    RAISE EXCEPTION 'a lock actor column does not reference public.users';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = to_regclass('public.house_price_locks') AND contype = 'f'
                    AND confrelid = to_regclass('public.restaurant_inventory')
                    AND confdeltype = 'a') THEN
    RAISE EXCEPTION 'house_price_locks.inventory_id is not ON DELETE NO ACTION';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = to_regclass('public.house_price_locks') AND contype = 'f'
                    AND confrelid = to_regclass('public.restaurants')
                    AND confdeltype = 'c') THEN
    RAISE EXCEPTION 'house_price_locks.restaurant_id is not ON DELETE CASCADE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'house_price_lock_holds_the_price'
                  AND tgrelid = to_regclass('public.restaurant_inventory') AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'the lock guard is not on restaurant_inventory';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'house_price_lock_is_append_only'
                  AND tgrelid = to_regclass('public.house_price_locks') AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'the append-only trigger is not on house_price_locks';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE proname IN ('set_house_menu_price', 'lock_house_menu_price', 'release_house_price_lock',
                                'change_locked_house_menu_price', 'move_house_price_lock', 'make_menu_current',
                                'house_price_lock_holds_the_price', 'house_price_lock_is_append_only')
                AND pronamespace = 'public'::regnamespace
                AND prosecdef) THEN
    RAISE EXCEPTION 'a price-lock function is SECURITY DEFINER; it must not be';
  END IF;
  SELECT count(*) INTO n FROM public.house_price_locks;
  IF n <> 0 THEN
    RAISE EXCEPTION 'this migration wrote % locks; it must write none', n;
  END IF;
  SELECT count(*) INTO n FROM public.menu_price_versions WHERE menu_id IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'this migration named a menu on % price versions; it must name none', n;
  END IF;
  RAISE NOTICE 'price locks: table (RLS on, append-only, one open lock per wine and kind), guard on restaurant_inventory, set_house_menu_price holds locks and names the menu, make_menu_current returns its moment, four acts (invoker, service_role only), never-priced blank flag admitted, zero rows written';
END
$$;
