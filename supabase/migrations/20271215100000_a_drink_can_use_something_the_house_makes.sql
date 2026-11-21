-- A drink or dish can use something the house makes (r104 drinks need 1, ADR 0371).
--
-- A bar's syrup, infusion, batch mix or cordial has its own recipe and a yield,
-- and its cost per ml feeds the drink that uses it. Until now such a line could
-- only be 'untracked', so the drink read "not priced" and "every recipe costed"
-- failed for most cocktail menus. A house-made component is a dish of the house
-- with a stated yield (`dishes.yield_qty_base` in `yield_base_unit`): it already
-- has versions, a current pointer, a save path and a cost, so nothing is built
-- twice. A recipe line gains the role 'made', naming the component it draws.
--
-- Rules written here, in the one line writer both saves share:
--   * the component is a live dish of the same house with a yield, and the line
--     is measured in the unit the component is made in (ml against ml, g against g);
--   * a component cannot contain itself, and a chain of components is at most
--     three deep (syrup in batch in base), checked down the current versions.
-- `recipe_lines_untracked_has_no_item` needs no lifting: a made line has no shelf
-- item, which that CHECK already allows.

ALTER TABLE public.dishes
  ADD COLUMN IF NOT EXISTS yield_qty_base bigint CONSTRAINT dishes_yield_qty_base_positive CHECK (yield_qty_base > 0),
  ADD COLUMN IF NOT EXISTS yield_base_unit text CONSTRAINT dishes_yield_base_unit_known CHECK (yield_base_unit IN ('ml10', 'mg', 'each_milli'));
ALTER TABLE public.dishes
  ADD CONSTRAINT dishes_yield_is_both_or_neither CHECK ((yield_qty_base IS NULL) = (yield_base_unit IS NULL));
COMMENT ON COLUMN public.dishes.yield_qty_base IS
  'What one batch of this dish''s recipe makes, as an integer in yield_base_unit (700 ml is 7000 ml10). Set only on a house-made component (syrup, infusion, batch mix); NULL on a plated dish (ADR 0371).';

ALTER TABLE public.recipe_lines
  ADD COLUMN IF NOT EXISTS component_dish_id uuid REFERENCES public.dishes(id) ON DELETE RESTRICT;
ALTER TABLE public.recipe_lines DROP CONSTRAINT IF EXISTS recipe_lines_role_check;
ALTER TABLE public.recipe_lines
  ADD CONSTRAINT recipe_lines_role_check CHECK (role IN ('stocked', 'untracked', 'made')),
  ADD CONSTRAINT recipe_lines_made_names_component CHECK ((role = 'made') = (component_dish_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS recipe_lines_component_idx ON public.recipe_lines (component_dish_id) WHERE component_dish_id IS NOT NULL;
COMMENT ON COLUMN public.recipe_lines.component_dish_id IS
  'The house-made component this line draws (role = made): a dish with a yield. Its cost per base unit prices the line (ADR 0371).';

-- Does putting `p_component` into a recipe of dish `p_owner` keep the chain sound?
-- False when the component is the owner or leads back to it, or when the chain of
-- components under it, with it, is more than three deep. Walks current versions.
-- A cocktail owner (NULL here) cannot be reached from a component, so only depth counts.
CREATE OR REPLACE FUNCTION public.recipe_component_chain_ok(p_owner uuid, p_component uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH RECURSIVE chain(dish_id, depth) AS (
    SELECT p_component, 1
    UNION ALL
    SELECT l.component_dish_id, c.depth + 1
      FROM chain c
      JOIN public.recipe_current_dish rc ON rc.dish_id = c.dish_id
      JOIN public.recipe_lines l ON l.version_id = rc.version_id AND l.role = 'made'
     WHERE c.depth < 5
  )
  SELECT NOT EXISTS (SELECT 1 FROM chain WHERE depth > 3 OR dish_id = p_owner)
$$;

CREATE OR REPLACE FUNCTION public.recipe_insert_lines(p_version_id uuid, p_restaurant uuid, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_line jsonb;
  v_pos integer;
  v_role text;
  v_label text;
  v_qty numeric;
  v_unit text;
  v_item uuid;
  v_base record;
  v_usable numeric;
  v_component uuid;
  v_owner uuid;
  v_yield_unit text;
  v_out jsonb := '[]'::jsonb;
BEGIN
  -- The dish this version belongs to, when it belongs to one: a made line may not lead back to it.
  SELECT rv.dish_id INTO v_owner FROM public.recipe_versions rv WHERE rv.id = p_version_id;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'A recipe needs at least one ingredient.' USING ERRCODE = 'RCP00', HINT = 'no_lines';
  END IF;
  IF jsonb_array_length(p_lines) > 40 THEN
    RAISE EXCEPTION 'A recipe can have at most 40 ingredients.' USING ERRCODE = 'RCP00', HINT = 'too_many_lines';
  END IF;

  FOR v_line, v_pos IN SELECT e, o::integer FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(e, o) LOOP
    IF jsonb_typeof(v_line) <> 'object' THEN
      RAISE EXCEPTION 'Ingredient % must be stocked or untracked.', v_pos USING ERRCODE = 'RCP00', HINT = 'role';
    END IF;
    v_role := v_line ->> 'role';
    v_label := btrim(coalesce(v_line ->> 'label', ''));
    v_unit := v_line ->> 'unit';
    IF v_role IS NULL OR v_role NOT IN ('stocked', 'untracked', 'made') THEN
      RAISE EXCEPTION 'Ingredient % must be stocked, made in house or untracked.', v_pos USING ERRCODE = 'RCP00', HINT = 'role';
    END IF;
    IF v_label = '' THEN
      RAISE EXCEPTION 'Ingredient % needs a name.', v_pos USING ERRCODE = 'RCP00', HINT = 'label';
    END IF;
    v_qty := CASE WHEN jsonb_typeof(v_line -> 'qty') = 'number' THEN (v_line ->> 'qty')::numeric END;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Ingredient % (%) needs an amount above zero.', v_pos, v_label USING ERRCODE = 'RCP00', HINT = 'qty';
    END IF;
    SELECT * INTO v_base FROM public.recipe_qty_base(v_qty, v_unit);
    IF v_base.qty_base IS NULL THEN
      RAISE EXCEPTION 'Ingredient % (%) has a unit we do not know: %.', v_pos, v_label, coalesce(v_unit, 'none')
        USING ERRCODE = 'RCP00', HINT = 'unit';
    END IF;
    IF v_base.qty_base < 1 THEN
      RAISE EXCEPTION 'Ingredient % (%) is too small to measure.', v_pos, v_label USING ERRCODE = 'RCP00', HINT = 'qty';
    END IF;

    v_item := NULL;
    IF jsonb_typeof(v_line -> 'inventoryId') = 'string' THEN
      IF (v_line ->> 'inventoryId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'Ingredient % (%) is linked to something that is not on this house''s shelf.', v_pos, v_label
          USING ERRCODE = 'RCP00', HINT = 'item';
      END IF;
      v_item := (v_line ->> 'inventoryId')::uuid;
    END IF;
    IF v_role = 'untracked' AND v_item IS NOT NULL THEN
      RAISE EXCEPTION 'Ingredient % (%) is untracked, so it cannot be linked to a shelf item.', v_pos, v_label
        USING ERRCODE = 'RCP00', HINT = 'untracked_item';
    END IF;
    IF v_item IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.restaurant_inventory ri
       WHERE ri.id = v_item AND ri.restaurant_id = p_restaurant AND ri.is_active AND ri.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Ingredient % (%) is linked to something that is not on this house''s shelf.', v_pos, v_label
        USING ERRCODE = 'RCP00', HINT = 'item';
    END IF;

    -- A line made in the house names a component: a dish of this house with a stated yield.
    v_component := NULL;
    IF v_role = 'made' THEN
      IF v_item IS NOT NULL THEN
        RAISE EXCEPTION 'Ingredient % (%) is made in the house, so it is not linked to a shelf item.', v_pos, v_label
          USING ERRCODE = 'RCP00', HINT = 'made_item';
      END IF;
      IF jsonb_typeof(v_line -> 'componentId') IS DISTINCT FROM 'string'
         OR (v_line ->> 'componentId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'Ingredient % (%) is made in the house but names nothing it is made from.', v_pos, v_label
          USING ERRCODE = 'RCP00', HINT = 'component';
      END IF;
      v_component := (v_line ->> 'componentId')::uuid;
      SELECT d.yield_base_unit INTO v_yield_unit FROM public.dishes d
       WHERE d.id = v_component AND d.restaurant_id = p_restaurant AND d.deleted_at IS NULL
         AND d.yield_qty_base IS NOT NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Ingredient % (%) is made from something that is not a house-made component of this house.', v_pos, v_label
          USING ERRCODE = 'RCP00', HINT = 'component';
      END IF;
      IF v_yield_unit <> v_base.base_unit THEN
        RAISE EXCEPTION 'Ingredient % (%) is measured in %, but the component is made in %.', v_pos, v_label, v_base.base_unit, v_yield_unit
          USING ERRCODE = 'RCP00', HINT = 'component_unit';
      END IF;
      IF NOT public.recipe_component_chain_ok(v_owner, v_component) THEN
        RAISE EXCEPTION 'Ingredient % (%) would make a component contain itself, or sit more than three levels deep.', v_pos, v_label
          USING ERRCODE = 'RCP00', HINT = 'component_cycle';
      END IF;
    END IF;

    -- How much of what is bought ends up in the serve (r28 recipes gap 5).
    -- Absent, null or 100 is the whole of it, kept as NULL: one spelling.
    v_usable := NULL;
    IF jsonb_typeof(v_line -> 'usablePct') IS NOT NULL AND jsonb_typeof(v_line -> 'usablePct') <> 'null' THEN
      IF jsonb_typeof(v_line -> 'usablePct') <> 'number' THEN
        RAISE EXCEPTION 'Ingredient % (%): the usable share is a number of percent, from 1 to 100.', v_pos, v_label
          USING ERRCODE = 'RCP00', HINT = 'usable';
      END IF;
      v_usable := (v_line ->> 'usablePct')::numeric;
      IF v_usable < 1 OR v_usable > 100 OR v_usable <> round(v_usable, 2) THEN
        RAISE EXCEPTION 'Ingredient % (%): the usable share is a number of percent, from 1 to 100.', v_pos, v_label
          USING ERRCODE = 'RCP00', HINT = 'usable';
      END IF;
      IF v_usable = 100 THEN
        v_usable := NULL;
      ELSIF v_role <> 'stocked' THEN
        RAISE EXCEPTION 'Ingredient % (%) is not counted from the shelf, so it has no usable share.', v_pos, v_label
          USING ERRCODE = 'RCP00', HINT = 'usable_untracked';
      END IF;
    END IF;

    INSERT INTO public.recipe_lines
      (version_id, restaurant_id, position, role, inventory_id, component_dish_id, label, qty_entered, unit_code, qty_base, base_unit, usable_pct)
    VALUES (p_version_id, p_restaurant, v_pos, v_role, v_item, v_component, v_label, v_qty, v_unit, v_base.qty_base, v_base.base_unit, v_usable);
    v_out := v_out || jsonb_build_object('position', v_pos, 'role', v_role, 'inventoryId', v_item, 'componentId', v_component,
      'label', v_label, 'qtyEntered', v_qty, 'unitCode', v_unit, 'qtyBase', v_base.qty_base, 'baseUnit', v_base.base_unit,
      'usablePct', v_usable);
  END LOOP;
  RETURN v_out;
END $$;
