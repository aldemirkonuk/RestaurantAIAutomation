-- Every change to a house's own bottle or glass price is on the record: who,
-- when, from where, and the newest dated change wins.
--
-- THE FOUNDER, 2026-09-21, verbatim (ADR 0193):
-- "Dynamic means two things 1. it could be changed every time a menu is
-- updated and secondly it should be changed whenever the manager wants"
-- ---------------------------------------------------------------------------
-- THE ONE BOTTLE-PRICE COLUMN. `restaurant_inventory.menu_price_current`
-- (baseline :3319) is the house's bottle price: every margin, valuation and
-- POS path already reads it (analytics.service.ts, advanced-analytics,
-- dashboard valuation, pos-hub consumption, simpos, score_tasks.py, and
-- 20260805123951_pricing_agility.sql's own backfill into `bottle_price`).
-- The cellar lane briefly added a second column for the same meaning
-- (`menu_price_bottle`, never merged); ADR 0193 removes it so edits, advice and
-- margins read ONE number. `menu_price_glass` is the glass price.
--
-- WHAT WAS MISSING. `menu_price_versions` (20260805123951) was built as the
-- effective-dated history of these two prices, with `change_source` already
-- naming the founder's two sources ('import' = the menu, 'manual' = a person,
-- 'agent_accepted' = a person accepting advice). Nothing has ever written it
-- after the one backfill. This migration adds the writer, twice over:
--
--   1. A TRIGGER on restaurant_inventory. Any INSERT carrying a price, and any
--      UPDATE that changes either price, closes the open version row and opens
--      a new one IN THE SAME TRANSACTION. No writer, present or future, can
--      move a price without leaving a row. A writer that names nobody is
--      recorded as 'manual' with changed_by NULL and a reason saying so - the
--      gap is visible in the record, not hidden by it.
--   2. set_house_menu_price(), the one gateway writer. It checks the item
--      belongs to the house, refuses a change dated BEFORE the price now in
--      effect ("the newest dated change wins" - a menu line scanned before a
--      manager typed a price does not overwrite it), skips a change that
--      changes nothing, and hands the trigger who / why / from where through
--      transaction-local settings, so the history row carries changed_by from
--      the JWT and change_source from the caller.
--
-- ALSO: menu_price_versions.changed_by gains its FK to public.users(user_id)
-- (never auth.users). Every existing row is a 'backfill' row with a NULL
-- changed_by, so the constraint validates against nothing.
--
-- Additive and idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS before
-- CREATE TRIGGER, the FK added only when absent. This migration writes no row.

-- ---------------------------------------------------------------------------
-- 1. The actor FK on the history table.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'menu_price_versions_changed_by_fkey'
       AND conrelid = to_regclass('public.menu_price_versions')
  ) THEN
    ALTER TABLE public.menu_price_versions
      ADD CONSTRAINT menu_price_versions_changed_by_fkey
      FOREIGN KEY (changed_by) REFERENCES public.users(user_id) ON DELETE RESTRICT;
  END IF;
END
$$;

COMMENT ON COLUMN public.menu_price_versions.changed_by IS
  'The person who made this price change, public.users(user_id) from the verified JWT - never auth.users. NULL only on backfill rows and on a write that bypassed set_house_menu_price (its reason says so).';

-- ---------------------------------------------------------------------------
-- 2. The trigger: no price moves without a version row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_house_menu_price_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Handed over by set_house_menu_price() for this transaction only. Empty
  -- when the write came from anywhere else.
  v_source   text := nullif(current_setting('mudavym.menu_price_source', true), '');
  v_by       uuid := nullif(current_setting('mudavym.menu_price_changed_by', true), '')::uuid;
  v_from     timestamptz := nullif(current_setting('mudavym.menu_price_effective_from', true), '')::timestamptz;
  v_reason   text := nullif(current_setting('mudavym.menu_price_reason', true), '');
  v_cost     numeric := nullif(current_setting('mudavym.menu_price_unit_cost', true), '')::numeric;
  v_analysis uuid := nullif(current_setting('mudavym.menu_price_analysis_id', true), '')::uuid;
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

  -- Close whatever was in effect. greatest() keeps effective_to >= effective_from
  -- even for a same-instant pair of changes.
  UPDATE public.menu_price_versions
     SET effective_to = greatest(v_from, effective_from)
   WHERE inventory_id = NEW.id
     AND effective_to IS NULL;

  INSERT INTO public.menu_price_versions
    (restaurant_id, inventory_id, bottle_price, glass_price, unit_cost,
     effective_from, change_source, changed_by, pricing_analysis_id, reason)
  VALUES
    (NEW.restaurant_id, NEW.id, NEW.menu_price_current, NEW.menu_price_glass,
     v_cost, v_from, v_source, v_by, v_analysis, v_reason);

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.record_house_menu_price_version() IS
  'ADR 0193: every INSERT with a price and every UPDATE that changes menu_price_current or menu_price_glass closes the open menu_price_versions row and opens a new one, in the same transaction. Source/actor come from set_house_menu_price(); a write that bypasses it is recorded as manual with changed_by NULL and a reason saying so.';

REVOKE ALL ON FUNCTION public.record_house_menu_price_version() FROM PUBLIC;

DROP TRIGGER IF EXISTS record_house_menu_price_version ON public.restaurant_inventory;
CREATE TRIGGER record_house_menu_price_version
  AFTER INSERT OR UPDATE OF menu_price_current, menu_price_glass
  ON public.restaurant_inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.record_house_menu_price_version();

-- ---------------------------------------------------------------------------
-- 3. The one gateway writer.
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
  p_effective_from       timestamptz DEFAULT NULL,
  p_reason               text DEFAULT NULL,
  p_unit_cost            numeric DEFAULT NULL,
  p_pricing_analysis_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row     record;
  v_open    record;
  v_has_open boolean;
  v_from    timestamptz;
  v_bottle  numeric;
  v_glass   numeric;
  v_version uuid;
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
  IF NOT coalesce(p_set_bottle, false) AND NOT coalesce(p_set_glass, false) THEN
    RAISE EXCEPTION 'set_house_menu_price: neither the bottle nor the glass price was named; nothing was changed'
      USING ERRCODE = '22023';
  END IF;
  IF (coalesce(p_set_bottle, false) AND p_bottle_price < 0)
     OR (coalesce(p_set_glass, false) AND p_glass_price < 0) THEN
    RAISE EXCEPTION 'set_house_menu_price: a price cannot be negative; nothing was changed'
      USING ERRCODE = '22023';
  END IF;

  v_from := coalesce(p_effective_from, now());
  IF v_from > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'set_house_menu_price: a price change cannot be dated in the future (%); nothing was changed', v_from
      USING ERRCODE = '22023';
  END IF;

  -- The house check, and the lock that serialises two changes to one wine.
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

  SELECT id, effective_from, change_source
    INTO v_open
    FROM public.menu_price_versions
   WHERE inventory_id = p_inventory_id
     AND effective_to IS NULL;
  v_has_open := FOUND;

  -- THE NEWEST DATED CHANGE WINS. A change dated before the price now in
  -- effect is refused, not applied: the older menu line does not overwrite
  -- what a person set later. Both stay on the record - the menu line keeps its
  -- own price in menu_items, the later price keeps its version row.
  IF v_has_open AND v_from < v_open.effective_from THEN
    RETURN jsonb_build_object(
      'outcome', 'stale',
      'bottle_price', v_row.menu_price_current,
      'glass_price', v_row.menu_price_glass,
      'current_since', v_open.effective_from,
      'current_source', v_open.change_source
    );
  END IF;

  v_bottle := CASE WHEN coalesce(p_set_bottle, false)
                   THEN round(p_bottle_price, 2) ELSE v_row.menu_price_current END;
  v_glass  := CASE WHEN coalesce(p_set_glass, false)
                   THEN round(p_glass_price, 2) ELSE v_row.menu_price_glass END;

  IF v_bottle IS NOT DISTINCT FROM v_row.menu_price_current
     AND v_glass IS NOT DISTINCT FROM v_row.menu_price_glass THEN
    RETURN jsonb_build_object(
      'outcome', 'unchanged',
      'bottle_price', v_row.menu_price_current,
      'glass_price', v_row.menu_price_glass
    );
  END IF;

  PERFORM set_config('mudavym.menu_price_source', p_change_source, true);
  PERFORM set_config('mudavym.menu_price_changed_by', p_changed_by::text, true);
  PERFORM set_config('mudavym.menu_price_effective_from', v_from::text, true);
  PERFORM set_config('mudavym.menu_price_reason', coalesce(p_reason, ''), true);
  PERFORM set_config('mudavym.menu_price_unit_cost', coalesce(p_unit_cost::text, ''), true);
  PERFORM set_config('mudavym.menu_price_analysis_id', coalesce(p_pricing_analysis_id::text, ''), true);

  UPDATE public.restaurant_inventory
     SET menu_price_current = v_bottle,
         menu_price_glass   = v_glass
   WHERE id = p_inventory_id
     AND restaurant_id = p_restaurant_id;

  -- Clear the hand-over, so a later plain write in the same transaction is not
  -- recorded under this caller's name.
  PERFORM set_config('mudavym.menu_price_source', '', true);
  PERFORM set_config('mudavym.menu_price_changed_by', '', true);
  PERFORM set_config('mudavym.menu_price_effective_from', '', true);
  PERFORM set_config('mudavym.menu_price_reason', '', true);
  PERFORM set_config('mudavym.menu_price_unit_cost', '', true);
  PERFORM set_config('mudavym.menu_price_analysis_id', '', true);

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
    'version_id', v_version
  );
END
$$;

COMMENT ON FUNCTION public.set_house_menu_price(uuid, uuid, boolean, numeric, boolean, numeric, text, uuid, timestamptz, text, numeric, uuid) IS
  'ADR 0193: the one gateway writer of a house''s bottle (menu_price_current) and glass (menu_price_glass) price. House-scoped; refuses a change dated before the price in effect (outcome stale); skips a no-op (outcome unchanged); otherwise writes the price and the trigger records the version with change_source and changed_by.';

REVOKE ALL ON FUNCTION public.set_house_menu_price(uuid, uuid, boolean, numeric, boolean, numeric, text, uuid, timestamptz, text, numeric, uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.set_house_menu_price(uuid, uuid, boolean, numeric, boolean, numeric, text, uuid, timestamptz, text, numeric, uuid) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.set_house_menu_price(uuid, uuid, boolean, numeric, boolean, numeric, text, uuid, timestamptz, text, numeric, uuid) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.set_house_menu_price(uuid, uuid, boolean, numeric, boolean, numeric, text, uuid, timestamptz, text, numeric, uuid) TO service_role';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Assert the outcome. Catalog reads only: this migration touches no row.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'record_house_menu_price_version'
       AND tgrelid = to_regclass('public.restaurant_inventory')
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'the price-history trigger is not on restaurant_inventory';
  END IF;

  IF to_regprocedure('public.set_house_menu_price(uuid, uuid, boolean, numeric, boolean, numeric, text, uuid, timestamptz, text, numeric, uuid)') IS NULL THEN
    RAISE EXCEPTION 'set_house_menu_price was not created';
  END IF;

  -- Not SECURITY DEFINER: the gateway calls it as service_role, and a definer
  -- here would be a new privileged entry point nobody asked for.
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid IN (to_regprocedure('public.set_house_menu_price(uuid, uuid, boolean, numeric, boolean, numeric, text, uuid, timestamptz, text, numeric, uuid)'),
                   to_regprocedure('public.record_house_menu_price_version()'))
       AND prosecdef
  ) THEN
    RAISE EXCEPTION 'a price-history function is SECURITY DEFINER; it must not be';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'menu_price_versions_changed_by_fkey'
       AND conrelid = to_regclass('public.menu_price_versions')
       AND confrelid = to_regclass('public.users')
  ) THEN
    RAISE EXCEPTION 'menu_price_versions.changed_by does not reference public.users';
  END IF;

  -- The lane's second bottle-price column must not exist (ADR 0193).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'restaurant_inventory'
       AND column_name = 'menu_price_bottle'
  ) THEN
    RAISE EXCEPTION 'restaurant_inventory.menu_price_bottle exists; the house bottle price is menu_price_current (ADR 0193)';
  END IF;

  RAISE NOTICE 'house price history: trigger on, set_house_menu_price created (invoker), changed_by FK to public.users, no second bottle column';
END
$$;
