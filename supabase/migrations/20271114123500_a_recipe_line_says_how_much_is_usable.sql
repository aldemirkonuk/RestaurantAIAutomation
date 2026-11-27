-- A recipe line says how much of what is bought ends up in the serve
-- (r28 recipes audit, gap 5: waste and trim yield).
--
-- A chef writes what goes on the plate: 180 g of salmon fillet, 30 ml of lime
-- juice. The shelf keeps what is bought: a whole salmon, limes by the kg. Until
-- now the line was costed as if every gram bought reached the plate, so a
-- trimmed fish, a peeled vegetable or a squeezed lemon read cheap, and the
-- food and pour cost shares read low.
--
-- `usable_pct` is the share of what is bought that the line's amount is: 45
-- means 180 g on the plate takes 400 g bought, and costs 400 g. It sits on the
-- line, not on the good, because one good is trimmed differently by different
-- recipes (a lime as a wedge is all of it; as juice, under half). It is part
-- of the version, so a change of trim is a new version with its history.
-- Nothing is assumed: NULL is "all of it", and there is no table of usual
-- yields. What a serve contains (nutrition) is the line's amount as written.
--
-- 1 to 99.99 is stored; 100, null or absent is the whole, kept as NULL. A line
-- that is not counted has none. Both save paths now share recipe_insert_lines
-- (the cocktail save kept its own copy of the same rules until now), so the
-- one rule holds for drinks and dishes alike.

ALTER TABLE public.recipe_lines
  ADD COLUMN IF NOT EXISTS usable_pct numeric(5,2)
    CONSTRAINT recipe_lines_usable_pct_bounds CHECK (usable_pct >= 1 AND usable_pct < 100);
ALTER TABLE public.recipe_lines
  ADD CONSTRAINT recipe_lines_usable_pct_is_counted CHECK (role = 'stocked' OR usable_pct IS NULL);

COMMENT ON COLUMN public.recipe_lines.usable_pct IS
  'The share of what is bought that this line''s amount is, in percent (45: 180 g on the plate is 400 g bought). The line costs its amount divided by this share. NULL: all of it. Stocked lines only (r28 recipes gap 5).';

-- The line rules, for any owner, now with the usable share.
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
  v_out jsonb := '[]'::jsonb;
BEGIN
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
    IF v_role IS NULL OR v_role NOT IN ('stocked', 'untracked') THEN
      RAISE EXCEPTION 'Ingredient % must be stocked or untracked.', v_pos USING ERRCODE = 'RCP00', HINT = 'role';
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
      ELSIF v_role = 'untracked' THEN
        RAISE EXCEPTION 'Ingredient % (%) is not counted, so it has no usable share.', v_pos, v_label
          USING ERRCODE = 'RCP00', HINT = 'usable_untracked';
      END IF;
    END IF;

    INSERT INTO public.recipe_lines
      (version_id, restaurant_id, position, role, inventory_id, label, qty_entered, unit_code, qty_base, base_unit, usable_pct)
    VALUES (p_version_id, p_restaurant, v_pos, v_role, v_item, v_label, v_qty, v_unit, v_base.qty_base, v_base.base_unit, v_usable);
    v_out := v_out || jsonb_build_object('position', v_pos, 'role', v_role, 'inventoryId', v_item,
      'label', v_label, 'qtyEntered', v_qty, 'unitCode', v_unit, 'qtyBase', v_base.qty_base, 'baseUnit', v_base.base_unit,
      'usablePct', v_usable);
  END LOOP;
  RETURN v_out;
END $$;


-- The cocktail save writes its lines through the same rules as the dish save.
-- Its own checks (the drink is this house's, the save is not stale, at least
-- one serve) and their order are unchanged; the line rules and their
-- sentences are recipe_insert_lines', which were copied from this function.
CREATE OR REPLACE FUNCTION public.save_recipe_version(
  p_restaurant uuid, p_cocktail uuid, p_expected_version uuid, p_yield_serves integer,
  p_method text, p_glass text, p_garnish text, p_author uuid, p_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_current uuid;
  v_version_id uuid;
  v_version integer;
  v_out jsonb;
BEGIN
  -- Locking the drink serialises saves of one recipe, first save included.
  PERFORM 1 FROM public.cocktails c
   WHERE c.id = p_cocktail AND c.restaurant_id = p_restaurant AND c.deleted_at IS NULL
   FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This drink is not on this house''s list.' USING ERRCODE = 'RCP00', HINT = 'not_this_house';
  END IF;

  SELECT rc.version_id INTO v_current FROM public.recipe_current rc WHERE rc.cocktail_id = p_cocktail;
  IF v_current IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'Someone saved this recipe after you opened it. Nothing was changed.'
      USING ERRCODE = 'RCP09', HINT = 'stale';
  END IF;

  IF p_yield_serves IS NULL OR p_yield_serves < 1 THEN
    RAISE EXCEPTION 'A recipe makes at least one serve.' USING ERRCODE = 'RCP00', HINT = 'yield';
  END IF;

  SELECT coalesce(max(v.version), 0) + 1 INTO v_version FROM public.recipe_versions v WHERE v.cocktail_id = p_cocktail;
  INSERT INTO public.recipe_versions
    (restaurant_id, owner_kind, cocktail_id, version, yield_serves, method, glass, garnish, author)
  VALUES (p_restaurant, 'cocktail', p_cocktail, v_version, p_yield_serves,
          nullif(btrim(p_method), ''), nullif(btrim(p_glass), ''), nullif(btrim(p_garnish), ''), p_author)
  RETURNING id INTO v_version_id;

  -- A refused line raises here, and the version above goes with it.
  v_out := public.recipe_insert_lines(v_version_id, p_restaurant, p_lines);

  INSERT INTO public.recipe_current (cocktail_id, version_id, restaurant_id)
  VALUES (p_cocktail, v_version_id, p_restaurant)
  ON CONFLICT (cocktail_id) DO UPDATE SET version_id = excluded.version_id, updated_at = now();

  RETURN jsonb_build_object('version_id', v_version_id, 'version', v_version, 'lines', v_out);
END $$;
