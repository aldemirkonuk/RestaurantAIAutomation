-- A recipe is a versioned list of house items in base units (ADR 0360).
--
-- QA round 7c BLOCKER 2: `cocktail_ingredients` is written and never read, no
-- recipe links a good on the house's shelf, and no drink has a cost. This
-- migration gives a cocktail an append-only list of versions, each a list of
-- lines; a `stocked` line points at the house item (`restaurant_inventory.id`,
-- ADR 0115 H3) and stores an integer quantity in a base unit worked out here,
-- never by the client. Tenths of a ml honour R81 in this column without waiting
-- for the ledger's M3. The sale that draws these goods down comes later.
--
-- Nothing is moved from `cocktail_ingredients` (catalogue ids, no lot): the DO
-- block at the end only counts it (skip-and-flag). The old table and its route
-- stay as they are until #650 merges.

-- 1. Versions: one row per save, never edited.
CREATE TABLE public.recipe_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
  owner_kind    text NOT NULL DEFAULT 'cocktail' CHECK (owner_kind IN ('cocktail')),
  cocktail_id   uuid REFERENCES public.cocktails(id) ON DELETE RESTRICT,
  version       integer NOT NULL CHECK (version > 0),
  yield_serves  integer NOT NULL DEFAULT 1 CHECK (yield_serves > 0),
  method        text,
  glass         text,
  garnish       text,
  author        uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recipe_versions_cocktail_owner CHECK (owner_kind <> 'cocktail' OR cocktail_id IS NOT NULL),
  CONSTRAINT recipe_versions_cocktail_version_key UNIQUE (cocktail_id, version),
  CONSTRAINT recipe_versions_id_cocktail_key UNIQUE (id, cocktail_id)
);
COMMENT ON COLUMN public.recipe_versions.owner_kind IS
  'What the recipe belongs to. Only cocktail today; prep and dish widen this CHECK later.';
COMMENT ON COLUMN public.recipe_versions.author IS
  'public.users id of the person who saved this version (the JWT subject), kept as written.';

-- 2. Lines: what the bartender typed, and the integer it means.
CREATE TABLE public.recipe_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id    uuid NOT NULL REFERENCES public.recipe_versions(id) ON DELETE RESTRICT,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
  position      integer NOT NULL CHECK (position > 0),
  role          text NOT NULL CHECK (role IN ('stocked', 'untracked')),
  inventory_id  uuid REFERENCES public.restaurant_inventory(id) ON DELETE RESTRICT,
  label         text NOT NULL CHECK (btrim(label) <> ''),
  qty_entered   numeric NOT NULL CHECK (qty_entered > 0),
  unit_code     text NOT NULL CHECK (unit_code IN
                  ('ml', 'cl', 'l', 'oz', 'tsp', 'tbsp', 'dash', 'barspoon', 'g', 'kg', 'each')),
  qty_base      bigint NOT NULL CHECK (qty_base > 0),
  base_unit     text NOT NULL CHECK (base_unit IN ('ml10', 'mg', 'each_milli')),
  CONSTRAINT recipe_lines_position_key UNIQUE (version_id, position),
  CONSTRAINT recipe_lines_untracked_has_no_item CHECK (role = 'stocked' OR inventory_id IS NULL)
);
CREATE INDEX recipe_lines_inventory_idx ON public.recipe_lines (inventory_id) WHERE inventory_id IS NOT NULL;
COMMENT ON COLUMN public.recipe_lines.inventory_id IS
  'The house item this line draws. NULL on a stocked line means "not linked yet": the sale of '
  'such a recipe waits and takes nothing (F6). An untracked line (garnish, ice) never has one.';
COMMENT ON COLUMN public.recipe_lines.qty_base IS
  'Integer quantity in base_unit: tenths of a ml (ml10), mg, or thousandths of an each. '
  'Set by save_recipe_version through recipe_qty_base, never by a client.';

-- 3. Which version is current. The only mutable recipe row; the composite FK
--    keeps the pointer on a version of the same cocktail.
CREATE TABLE public.recipe_current (
  cocktail_id   uuid PRIMARY KEY REFERENCES public.cocktails(id) ON DELETE RESTRICT,
  version_id    uuid NOT NULL UNIQUE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recipe_current_version_fkey FOREIGN KEY (version_id, cocktail_id)
    REFERENCES public.recipe_versions (id, cocktail_id)
);

-- 4. Append-only: a saved version is history (F4). Editing one would re-price
--    last month's sales after the fact.
CREATE FUNCTION public.recipe_rows_are_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'A saved recipe is kept as it was. Save a new version instead.'
    USING ERRCODE = 'restrict_violation';
END $$;
CREATE TRIGGER recipe_versions_append_only BEFORE UPDATE OR DELETE ON public.recipe_versions
  FOR EACH ROW EXECUTE FUNCTION public.recipe_rows_are_append_only();
CREATE TRIGGER recipe_lines_append_only BEFORE UPDATE OR DELETE ON public.recipe_lines
  FOR EACH ROW EXECUTE FUNCTION public.recipe_rows_are_append_only();

-- 5. Typed quantity -> integer base (F3). Fixed factors; half-up to a tenth of
--    a ml (numeric round() is half away from zero, and every qty is > 0).
CREATE FUNCTION public.recipe_qty_base(p_qty numeric, p_unit text, OUT qty_base bigint, OUT base_unit text)
LANGUAGE sql IMMUTABLE STRICT SET search_path = public, pg_temp AS $$
  SELECT round(p_qty * f.factor)::bigint, f.base
  FROM (VALUES
    ('ml', 10::numeric, 'ml10'), ('cl', 100, 'ml10'), ('l', 10000, 'ml10'),
    ('oz', 295.735, 'ml10'), ('tsp', 50, 'ml10'), ('tbsp', 150, 'ml10'),
    ('dash', 10, 'ml10'), ('barspoon', 50, 'ml10'),
    ('g', 1000, 'mg'), ('kg', 1000000, 'mg'), ('each', 1000, 'each_milli')
  ) AS f(code, factor, base)
  WHERE f.code = p_unit
$$;
COMMENT ON FUNCTION public.recipe_qty_base(numeric, text) IS
  'oz is the US fluid ounce (29.5735 ml). dash = 1 ml and barspoon = 5 ml are fixed here; '
  'house-editable dash and barspoon values are deferred (F3), not built.';

-- 6. The one write path: a whole version, in one transaction.
--    Refusals: SQLSTATE RCP09 = a stale save (409); RCP00 = any other (400).
--    The message is the sentence a person reads.
CREATE FUNCTION public.save_recipe_version(
  p_restaurant uuid, p_cocktail uuid, p_expected_version uuid, p_yield_serves integer,
  p_method text, p_glass text, p_garnish text, p_author uuid, p_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_current uuid;
  v_version_id uuid;
  v_version integer;
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
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'A recipe needs at least one ingredient.' USING ERRCODE = 'RCP00', HINT = 'no_lines';
  END IF;
  IF jsonb_array_length(p_lines) > 40 THEN
    RAISE EXCEPTION 'A recipe can have at most 40 ingredients.' USING ERRCODE = 'RCP00', HINT = 'too_many_lines';
  END IF;

  SELECT coalesce(max(v.version), 0) + 1 INTO v_version FROM public.recipe_versions v WHERE v.cocktail_id = p_cocktail;
  INSERT INTO public.recipe_versions
    (restaurant_id, owner_kind, cocktail_id, version, yield_serves, method, glass, garnish, author)
  VALUES (p_restaurant, 'cocktail', p_cocktail, v_version, p_yield_serves,
          nullif(btrim(p_method), ''), nullif(btrim(p_glass), ''), nullif(btrim(p_garnish), ''), p_author)
  RETURNING id INTO v_version_id;

  FOR v_line, v_pos IN SELECT e, o::integer FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(e, o) LOOP
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
    VALUES (v_version_id, p_restaurant, v_pos, v_role, v_item, v_label, v_qty, v_unit, v_base.qty_base, v_base.base_unit);
    v_out := v_out || jsonb_build_object('position', v_pos, 'role', v_role, 'inventoryId', v_item,
      'label', v_label, 'qtyEntered', v_qty, 'unitCode', v_unit, 'qtyBase', v_base.qty_base, 'baseUnit', v_base.base_unit);
  END LOOP;

  INSERT INTO public.recipe_current (cocktail_id, version_id, restaurant_id)
  VALUES (p_cocktail, v_version_id, p_restaurant)
  ON CONFLICT (cocktail_id) DO UPDATE SET version_id = excluded.version_id, updated_at = now();

  RETURN jsonb_build_object('version_id', v_version_id, 'version', v_version, 'lines', v_out);
END $$;

-- 7. Grants and RLS. The gateway reads and writes with service_role, writes
--    through the RPC only. Clients hold no grant (OD-72; the guard
--    check_new_tables_are_locked_down). The house-read policy is the statement
--    of who may read, in the predicate of vendor_price_observations_authenticated_read
--    (the_register_states_who_may_see_a_row): inert while the grant is revoked,
--    exact if a grant is ever added.
REVOKE ALL ON FUNCTION public.save_recipe_version(uuid, uuid, uuid, integer, text, text, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_recipe_version(uuid, uuid, uuid, integer, text, text, text, uuid, jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.recipe_qty_base(numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recipe_qty_base(numeric, text) TO service_role;
REVOKE ALL ON FUNCTION public.recipe_rows_are_append_only() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.recipe_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_current ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recipe_versions FROM anon, authenticated;
REVOKE ALL ON public.recipe_lines FROM anon, authenticated;
REVOKE ALL ON public.recipe_current FROM anon, authenticated;
GRANT ALL ON public.recipe_versions, public.recipe_lines, public.recipe_current TO service_role;

CREATE POLICY recipe_versions_service_role ON public.recipe_versions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY recipe_lines_service_role ON public.recipe_lines
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY recipe_current_service_role ON public.recipe_current
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['recipe_versions', 'recipe_lines', 'recipe_current'] LOOP
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (
      restaurant_id IN (
        SELECT user_restaurant_access.restaurant_id
        FROM public.user_restaurant_access
        WHERE user_restaurant_access.user_id = auth.uid()
          AND user_restaurant_access.is_active
      ))$p$, t || '_house_read', t);
  END LOOP;
END $$;

-- 8. Skip-and-flag: count the old catalogue-keyed rows; move none.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.cocktail_ingredients;
  RAISE NOTICE 'recipes: % legacy cocktail_ingredients row(s) left in place, none moved (ADR 0360).', n;
END $$;
