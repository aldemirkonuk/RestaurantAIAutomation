-- MAKING A MENU CURRENT IS A DATED PRICE CHANGE OF ITS OWN.
-- F-618, founder answer S202 (2026-10-12): Option B, recorded as an
-- AMENDMENT to locked ADR 0193 (not a repeal of its item 3).
--
-- Since ADR 0193 round 3 (L11) choosing a menu already sets every unlocked
-- price it states, dated by the moment of the choice (made_current_at). It was
-- written as change_source 'import', the same word as a scanned or added line
-- and a line correction, so the record could not tell "this menu became the
-- one we sell from" apart from "a menu line said so". S202 names the act: the
-- carry is change_source 'menu_current', dated at activation, so the live
-- menu's prices are the newest dated change and win under item 3's own rule.
-- Item 3 is unchanged: a change dated before the price in effect (a stale
-- import) is still refused and applied nowhere, and a lock still holds ("The
-- menu sets it, locks keep"). Where a lock, or a person's price newer than
-- the activation, still differs from the live line, /menu and the wine say so
-- and an owner or a manager picks which one is charged (web; no table here).
--
-- What this changes:
-- 1. menu_price_versions.change_source accepts 'menu_current'.
-- 2. set_house_menu_price (the 13-argument writer; the 12-argument form
--    delegates to it) accepts 'menu_current'. Its body is otherwise the one
--    in 20260922230800, line for line.
-- 3. current_menu_line_follows_house_price (20270105500000) skips a
--    'menu_current' change as it skips 'import': the menu made it, and its
--    own line already holds it.
--
-- LOCKS. The CHECK is added NOT VALID (a brief ACCESS EXCLUSIVE, no scan)
-- and then validated under SHARE UPDATE EXCLUSIVE, which lets reads and
-- writes run. Every existing row already satisfies the wider list. CREATE OR
-- REPLACE FUNCTION keeps the owner and grants. Re-runnable. Writes no row.

ALTER TABLE public.menu_price_versions
  DROP CONSTRAINT IF EXISTS menu_price_versions_source_check;
ALTER TABLE public.menu_price_versions
  ADD CONSTRAINT menu_price_versions_source_check CHECK (
    change_source IN ('manual', 'agent_accepted', 'import', 'backfill', 'menu_current')
  ) NOT VALID;
ALTER TABLE public.menu_price_versions
  VALIDATE CONSTRAINT menu_price_versions_source_check;

COMMENT ON COLUMN public.menu_price_versions.change_source IS
  'Who moved the price: manual (a person), agent_accepted (accepted advice), import (a menu line scanned, added or corrected), menu_current (a menu made current, dated at activation; ADR 0193 S202 amendment), backfill.';

-- ---------------------------------------------------------------------------
-- 2. The one gateway writer, accepting 'menu_current' (body of 20260922230800).
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
     OR p_change_source NOT IN ('manual', 'agent_accepted', 'import', 'menu_current') THEN
    RAISE EXCEPTION 'set_house_menu_price: change_source must be manual, agent_accepted, import or menu_current, got %', p_change_source
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

-- ---------------------------------------------------------------------------
-- 3. The current menu's line follows any OTHER change of the house price
--    (body of 20270105500000, skipping 'menu_current' as well as 'import').
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_menu_line_follows_house_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bottle boolean := NEW.menu_price_current IS DISTINCT FROM OLD.menu_price_current
                      AND NEW.menu_price_current IS NOT NULL;
  v_glass  boolean := NEW.menu_price_glass IS DISTINCT FROM OLD.menu_price_glass
                      AND NEW.menu_price_glass IS NOT NULL;
BEGIN
  IF coalesce(nullif(current_setting('mudavym.menu_price_source', true), ''), '') IN ('import', 'menu_current')
     OR NOT (v_bottle OR v_glass) THEN
    RETURN NEW;
  END IF;

  UPDATE public.menu_items mi
     SET bottle_price   = CASE WHEN v_bottle THEN NEW.menu_price_current ELSE mi.bottle_price END,
         by_glass_price = CASE WHEN v_glass THEN NEW.menu_price_glass ELSE mi.by_glass_price END
    FROM public.restaurant_menus m
   WHERE m.id = mi.menu_id
     AND m.restaurant_id = NEW.restaurant_id
     AND m.status = 'active'
     AND mi.restaurant_id = NEW.restaurant_id
     AND mi.inventory_item_id = NEW.id
     AND mi.status IS DISTINCT FROM 'discarded'
     AND ((v_bottle AND mi.bottle_price IS DISTINCT FROM NEW.menu_price_current)
          OR (v_glass AND mi.by_glass_price IS DISTINCT FROM NEW.menu_price_glass));

  -- A blank-price flag says the line showed no price; once it shows every
  -- kind the house prices, the flag is no longer true.
  UPDATE public.menu_items mi
     SET price_flag = NULL,
         price_flag_note = NULL
    FROM public.restaurant_menus m
   WHERE m.id = mi.menu_id
     AND m.restaurant_id = NEW.restaurant_id
     AND m.status = 'active'
     AND mi.restaurant_id = NEW.restaurant_id
     AND mi.inventory_item_id = NEW.id
     AND mi.price_flag IS NOT NULL
     AND (mi.bottle_price IS NOT NULL OR NEW.menu_price_current IS NULL)
     AND (mi.by_glass_price IS NOT NULL OR NEW.menu_price_glass IS NULL)
     AND (mi.bottle_price IS NOT NULL OR mi.by_glass_price IS NOT NULL);
  RETURN NEW;
END
$$;
