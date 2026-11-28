-- A dish has a recipe, on the drinks' recipe engine (ADR 0366, on ADR 0360).
--
-- The founder's 2026-11-07 /goal asks that a food good show which dishes use
-- it, with their figures, as a spirit already shows its drinks. ADR 0360 built
-- recipes for cocktails only (`recipe_versions.owner_kind IN ('cocktail')`,
-- "prep and dish widen this CHECK later"). This widens it:
--
--   1. `dishes`: the house's plates (name, menu section, price), one table,
--      tenant-scoped, soft-deleted like `cocktails`.
--   2. `recipe_versions` gains `dish_id`; `owner_kind` takes 'dish'; exactly
--      one owner per version. A composite FK ties a dish version to a dish OF
--      THE SAME HOUSE, so a version can never cross houses even if a writer
--      other than the RPC appears.
--   3. `recipe_current_dish`: which version of a dish is current. A sibling of
--      `recipe_current`, not a rewrite of it, so no cocktail row, key or reader
--      changes.
--   4. `recipe_insert_lines`: the line rules, owner-agnostic, and
--      `save_dish_recipe_version`, the one write path for a dish. The cocktail
--      RPC is left exactly as ADR 0360 wrote it (see ADR 0366 item 4).
--
-- Lines, units, base quantities and the append-only rule are ADR 0360's,
-- unchanged: a dish line is a `recipe_lines` row like a drink's.

-- 1. Dishes.
CREATE TABLE public.dishes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
  name          text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 200),
  menu_section  text CHECK (menu_section IS NULL OR char_length(menu_section) <= 200),
  price         numeric(12,2) CHECK (price IS NULL OR price >= 0),
  description   text CHECK (description IS NULL OR char_length(description) <= 4000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT dishes_id_restaurant_key UNIQUE (id, restaurant_id)
);
CREATE INDEX dishes_restaurant_idx ON public.dishes (restaurant_id) WHERE deleted_at IS NULL;
-- One live dish per name in a house, case- and space-folded: a second
-- "Lemon tart" would split its recipe and its usage in two.
CREATE UNIQUE INDEX dishes_house_name_key ON public.dishes
  (restaurant_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) WHERE deleted_at IS NULL;
COMMENT ON TABLE public.dishes IS
  'A plate the house makes and sells (ADR 0366). Its recipe is recipe_versions with owner_kind = ''dish''. '
  'price is the menu price as the house lists it; whether it includes tax is not recorded here (ADR 0359).';
COMMENT ON COLUMN public.dishes.price IS
  'The menu price as listed, in the house''s currency. NULL = no price stated, never 0.';

-- 2. A version belongs to a cocktail or to a dish, never both, never neither.
ALTER TABLE public.recipe_versions ADD COLUMN dish_id uuid;
ALTER TABLE public.recipe_versions DROP CONSTRAINT recipe_versions_owner_kind_check;
ALTER TABLE public.recipe_versions
  ADD CONSTRAINT recipe_versions_owner_kind_check CHECK (owner_kind IN ('cocktail', 'dish')),
  ADD CONSTRAINT recipe_versions_dish_owner CHECK (owner_kind <> 'dish' OR dish_id IS NOT NULL),
  ADD CONSTRAINT recipe_versions_one_owner CHECK (num_nonnulls(cocktail_id, dish_id) = 1),
  ADD CONSTRAINT recipe_versions_dish_same_house_fkey FOREIGN KEY (dish_id, restaurant_id)
    REFERENCES public.dishes (id, restaurant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT recipe_versions_dish_version_key UNIQUE (dish_id, version),
  ADD CONSTRAINT recipe_versions_id_dish_key UNIQUE (id, dish_id);
COMMENT ON COLUMN public.recipe_versions.owner_kind IS
  'What the recipe belongs to: cocktail (cocktail_id) or dish (dish_id), exactly one (ADR 0366). Prep widens this CHECK later.';
COMMENT ON COLUMN public.recipe_versions.dish_id IS
  'The dish this version is a recipe of (owner_kind = dish). The FK on (dish_id, restaurant_id) keeps it in the dish''s house.';

-- 3. Which version of a dish is current. The composite FK keeps the pointer
--    on a version of the same dish.
CREATE TABLE public.recipe_current_dish (
  dish_id       uuid PRIMARY KEY REFERENCES public.dishes(id) ON DELETE RESTRICT,
  version_id    uuid NOT NULL UNIQUE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recipe_current_dish_version_fkey FOREIGN KEY (version_id, dish_id)
    REFERENCES public.recipe_versions (id, dish_id),
  CONSTRAINT recipe_current_dish_same_house_fkey FOREIGN KEY (dish_id, restaurant_id)
    REFERENCES public.dishes (id, restaurant_id)
);
CREATE INDEX recipe_current_dish_restaurant_idx ON public.recipe_current_dish (restaurant_id);

-- 4a. The line rules of ADR 0360 item 11, for any owner: 1 to 40 lines, each
--     stocked or untracked, named, a positive amount in a known unit, and a
--     link only to a live item of THIS house. Refusals are RCP00 with the
--     sentence a person reads, exactly as save_recipe_version says them.
CREATE FUNCTION public.recipe_insert_lines(p_version_id uuid, p_restaurant uuid, p_lines jsonb)
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

    INSERT INTO public.recipe_lines
      (version_id, restaurant_id, position, role, inventory_id, label, qty_entered, unit_code, qty_base, base_unit)
    VALUES (p_version_id, p_restaurant, v_pos, v_role, v_item, v_label, v_qty, v_unit, v_base.qty_base, v_base.base_unit);
    v_out := v_out || jsonb_build_object('position', v_pos, 'role', v_role, 'inventoryId', v_item,
      'label', v_label, 'qtyEntered', v_qty, 'unitCode', v_unit, 'qtyBase', v_base.qty_base, 'baseUnit', v_base.base_unit);
  END LOOP;
  RETURN v_out;
END $$;

-- 4b. The one write path for a dish's recipe: a whole version, in one
--     transaction. RCP09 = a stale save (409); RCP00 = any other refusal (400).
CREATE FUNCTION public.save_dish_recipe_version(
  p_restaurant uuid, p_dish uuid, p_expected_version uuid, p_yield_serves integer,
  p_method text, p_garnish text, p_author uuid, p_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_current uuid;
  v_version_id uuid;
  v_version integer;
  v_out jsonb;
BEGIN
  -- Locking the dish serialises saves of one recipe, first save included.
  PERFORM 1 FROM public.dishes d
   WHERE d.id = p_dish AND d.restaurant_id = p_restaurant AND d.deleted_at IS NULL
   FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This dish is not on this house''s list.' USING ERRCODE = 'RCP00', HINT = 'not_this_house';
  END IF;

  SELECT rc.version_id INTO v_current FROM public.recipe_current_dish rc WHERE rc.dish_id = p_dish;
  IF v_current IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'Someone saved this recipe after you opened it. Nothing was changed.'
      USING ERRCODE = 'RCP09', HINT = 'stale';
  END IF;

  IF p_yield_serves IS NULL OR p_yield_serves < 1 THEN
    RAISE EXCEPTION 'A recipe makes at least one serve.' USING ERRCODE = 'RCP00', HINT = 'yield';
  END IF;

  SELECT coalesce(max(v.version), 0) + 1 INTO v_version FROM public.recipe_versions v WHERE v.dish_id = p_dish;
  INSERT INTO public.recipe_versions
    (restaurant_id, owner_kind, dish_id, version, yield_serves, method, glass, garnish, author)
  VALUES (p_restaurant, 'dish', p_dish, v_version, p_yield_serves,
          nullif(btrim(p_method), ''), NULL, nullif(btrim(p_garnish), ''), p_author)
  RETURNING id INTO v_version_id;

  v_out := public.recipe_insert_lines(v_version_id, p_restaurant, p_lines);

  INSERT INTO public.recipe_current_dish (dish_id, version_id, restaurant_id)
  VALUES (p_dish, v_version_id, p_restaurant)
  ON CONFLICT (dish_id) DO UPDATE SET version_id = excluded.version_id, updated_at = now();

  RETURN jsonb_build_object('version_id', v_version_id, 'version', v_version, 'lines', v_out);
END $$;

-- 5. Grants and RLS, as ADR 0360 item 12 set them for the recipe tables: the
--    gateway reads and writes with service_role; clients hold no grant (OD-72,
--    check_new_tables_are_locked_down); a house-read policy states who may
--    read, inert while the grant is revoked.
REVOKE ALL ON FUNCTION public.recipe_insert_lines(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recipe_insert_lines(uuid, uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.save_dish_recipe_version(uuid, uuid, uuid, integer, text, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_dish_recipe_version(uuid, uuid, uuid, integer, text, text, uuid, jsonb)
  TO service_role;

ALTER TABLE public.dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_current_dish ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dishes FROM anon, authenticated;
REVOKE ALL ON public.recipe_current_dish FROM anon, authenticated;
GRANT ALL ON public.dishes, public.recipe_current_dish TO service_role;

CREATE POLICY dishes_service_role ON public.dishes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY recipe_current_dish_service_role ON public.recipe_current_dish
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dishes', 'recipe_current_dish'] LOOP
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (
      restaurant_id IN (
        SELECT user_restaurant_access.restaurant_id
        FROM public.user_restaurant_access
        WHERE user_restaurant_access.user_id = auth.uid()
          AND user_restaurant_access.is_active
      ))$p$, t || '_house_read', t);
  END LOOP;
END $$;
