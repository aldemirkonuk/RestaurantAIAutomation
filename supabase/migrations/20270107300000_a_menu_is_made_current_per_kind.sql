-- A MENU IS MADE CURRENT PER KIND (ADR 0340 rules 2, 3, 4, 6, 13; founder
-- answer S208; amends ADR 0193 round-2 item 7 as ADR 0340 records).
--
-- WHAT THIS FILE DOES
-- 1. make_menu_current: the body of 20270103500000, with four changes.
--    * It refuses a legacy kind ('full', 'bar', 'events') with 22023: those
--      rows still validate, but none is made live again (ADR 0340 F1).
--    * already_current and the archive are scoped to the chosen menu's kind
--      (AND menu_type = v_menu.menu_type): making a Drinks menu current
--      archives only the Drinks menu, and the live Food menu stays live.
--    * carried_at is cleared on activation, so a carry that did not finish
--      on an earlier activation is never mistaken for done (rule 4).
--    * The reply also carries menu_type and carried_at.
--    The F-681 empty-menu refusal and the actor refusal are unchanged.
-- 2. make_menus_current(house, menu ids, actor): the drafts one upload read
--    go live together or not at all (rule 13). It locks the house row, then
--    the menus in id order; refuses with 22023 an empty list, a NULL id, a
--    kind named twice, a legacy kind or a menu with no line (F-681, each
--    menu); answers P0002 for a menu not in the house. Then per kind it
--    archives the live menu that is not in the batch and activates the
--    batch with one made_current_at. The reply has one outcome per menu
--    (made_current | already_current) and its carried_at.
-- 3. add_menu_section(house, menu, parent, title, actor, category, as read):
--    the server computes the key (the parent's key + '/' + the heading's
--    slug) and the position (the end of the parent's list), under the
--    menu's row lock. An empty slug or blank title is 22023, a key the menu
--    already has is 23505, an unknown menu or a parent on another menu is
--    P0002. It logs a 'create' change.
-- 4. reorder_menu_sections(house, menu, parent, ids, actor): positions
--    0..n-1 in the order given. An id that is not a section of that menu
--    is P0002 (404); a list that is not exactly the parent's sections (one
--    missing, or named twice) is 40001 (409, someone else changed the list;
--    the precedent is 20270104800000). It logs a 'reorder' change.
--    [Deviation from menus-lanes.md, which listed no actor: the change log's
--    actor is NOT NULL, so the function takes one.]
--
-- All four: SECURITY INVOKER, search_path pinned, EXECUTE for service_role
-- only. Writes no row.

-- ---------------------------------------------------------------------------
-- 1. One menu, per kind.
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

  SELECT id, status, menu_type, made_current_at, carried_at
    INTO v_menu
    FROM public.restaurant_menus
   WHERE id = p_menu_id
     AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'make_menu_current: no menu % in house %; nothing was changed', p_menu_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_menu.menu_type NOT IN ('beverage', 'food', 'desserts') THEN
    RAISE EXCEPTION 'This menu is of an old kind (%) that is no longer made current; read it again as Drinks, Food or Desserts. Nothing was changed.', v_menu.menu_type
      USING ERRCODE = '22023';
  END IF;

  IF v_menu.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM public.restaurant_menus
                      WHERE restaurant_id = p_restaurant_id
                        AND menu_type = v_menu.menu_type
                        AND status = 'active'
                        AND id <> p_menu_id) THEN
    RETURN jsonb_build_object('outcome', 'already_current', 'menu_id', p_menu_id,
                              'menu_type', v_menu.menu_type,
                              'previous_menu_ids', '[]'::jsonb,
                              'made_current_at', v_menu.made_current_at,
                              'carried_at', v_menu.carried_at);
  END IF;

  -- F-681: a menu with no lines would archive the house's menu of this kind
  -- and leave it with none. Lines discarded by a person do not count.
  IF NOT EXISTS (SELECT 1 FROM public.menu_items
                  WHERE menu_id = p_menu_id
                    AND restaurant_id = p_restaurant_id
                    AND status IS DISTINCT FROM 'discarded') THEN
    RAISE EXCEPTION 'This menu has no lines, so making it current would empty the house''s menu. Nothing was changed.'
      USING ERRCODE = '22023';
  END IF;

  WITH retired AS (
    UPDATE public.restaurant_menus
       SET status = 'archived',
           retired_at = v_at,
           retired_by = p_actor
     WHERE restaurant_id = p_restaurant_id
       AND menu_type = v_menu.menu_type
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
         retired_by = NULL,
         carried_at = NULL
   WHERE id = p_menu_id
     AND restaurant_id = p_restaurant_id;

  RETURN jsonb_build_object('outcome', 'made_current', 'menu_id', p_menu_id,
                            'menu_type', v_menu.menu_type,
                            'previous_menu_ids', to_jsonb(v_previous),
                            'made_current_at', v_at,
                            'carried_at', NULL);
END
$$;

REVOKE ALL ON FUNCTION public.make_menu_current(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.make_menu_current(uuid, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.make_menu_current(uuid, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The drafts of one upload, together.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.make_menus_current(
  p_restaurant_id uuid,
  p_menu_ids      uuid[],
  p_actor         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_at      timestamptz := now();
  v_found   integer;
  v_kind    text;
  v_menu    record;
  v_results jsonb := '[]'::jsonb;
  v_prev    uuid[];
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'make_menus_current: choosing the current menus names the person who chose them (actor is NULL); nothing was changed'
      USING ERRCODE = '22023';
  END IF;
  IF p_menu_ids IS NULL OR cardinality(p_menu_ids) = 0 THEN
    RAISE EXCEPTION 'make_menus_current: no menu was named; nothing was changed'
      USING ERRCODE = '22023';
  END IF;
  IF array_position(p_menu_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'make_menus_current: a menu id is empty; nothing was changed'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.restaurants WHERE id = p_restaurant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'make_menus_current: no restaurant %; nothing was changed', p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM public.restaurant_menus
   WHERE id = ANY (p_menu_ids) AND restaurant_id = p_restaurant_id
   ORDER BY id
   FOR UPDATE;
  SELECT count(DISTINCT id) INTO v_found
    FROM public.restaurant_menus
   WHERE id = ANY (p_menu_ids) AND restaurant_id = p_restaurant_id;
  IF v_found <> (SELECT count(DISTINCT x) FROM unnest(p_menu_ids) AS x) THEN
    RAISE EXCEPTION 'make_menus_current: a named menu is not in house %; nothing was changed', p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_found <> cardinality(p_menu_ids) THEN
    RAISE EXCEPTION 'make_menus_current: a menu is named twice; nothing was changed'
      USING ERRCODE = '22023';
  END IF;

  SELECT menu_type INTO v_kind
    FROM public.restaurant_menus
   WHERE id = ANY (p_menu_ids)
   GROUP BY menu_type
  HAVING count(*) > 1
   LIMIT 1;
  IF v_kind IS NOT NULL THEN
    RAISE EXCEPTION 'Two of these menus are both % menus; a house has one live menu of each kind. Nothing was changed.', v_kind
      USING ERRCODE = '22023';
  END IF;

  SELECT menu_type INTO v_kind
    FROM public.restaurant_menus
   WHERE id = ANY (p_menu_ids)
     AND menu_type NOT IN ('beverage', 'food', 'desserts')
   LIMIT 1;
  IF v_kind IS NOT NULL THEN
    RAISE EXCEPTION 'One of these menus is of an old kind (%) that is no longer made current. Nothing was changed.', v_kind
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.restaurant_menus m
              WHERE m.id = ANY (p_menu_ids)
                AND NOT EXISTS (SELECT 1 FROM public.menu_items mi
                                 WHERE mi.menu_id = m.id
                                   AND mi.restaurant_id = p_restaurant_id
                                   AND mi.status IS DISTINCT FROM 'discarded')) THEN
    RAISE EXCEPTION 'One of these menus has no lines, so making it current would empty the house''s menu of that kind. Nothing was changed.'
      USING ERRCODE = '22023';
  END IF;

  FOR v_menu IN
    SELECT id, status, menu_type, made_current_at, carried_at
      FROM public.restaurant_menus
     WHERE id = ANY (p_menu_ids)
     ORDER BY id
  LOOP
    IF v_menu.status = 'active' THEN
      -- The index allows no other live menu of this kind: already current.
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'outcome', 'already_current', 'menu_id', v_menu.id, 'menu_type', v_menu.menu_type,
        'previous_menu_ids', '[]'::jsonb,
        'made_current_at', v_menu.made_current_at, 'carried_at', v_menu.carried_at));
      CONTINUE;
    END IF;

    WITH retired AS (
      UPDATE public.restaurant_menus
         SET status = 'archived',
             retired_at = v_at,
             retired_by = p_actor
       WHERE restaurant_id = p_restaurant_id
         AND menu_type = v_menu.menu_type
         AND status = 'active'
         AND NOT (id = ANY (p_menu_ids))
      RETURNING id
    )
    SELECT coalesce(array_agg(id), '{}') INTO v_prev FROM retired;

    UPDATE public.restaurant_menus
       SET status = 'active',
           made_current_at = v_at,
           made_current_by = p_actor,
           retired_at = NULL,
           retired_by = NULL,
           carried_at = NULL
     WHERE id = v_menu.id;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'outcome', 'made_current', 'menu_id', v_menu.id, 'menu_type', v_menu.menu_type,
      'previous_menu_ids', to_jsonb(v_prev),
      'made_current_at', v_at, 'carried_at', NULL));
  END LOOP;

  RETURN jsonb_build_object('made_current_at', v_at, 'menus', v_results);
END
$$;

COMMENT ON FUNCTION public.make_menus_current(uuid, uuid[], uuid) IS
  'ADR 0340 rule 13: make the drafts one upload read live together, one per kind, or none. Per kind it archives the live menu not in the batch.';

REVOKE ALL ON FUNCTION public.make_menus_current(uuid, uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.make_menus_current(uuid, uuid[], uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.make_menus_current(uuid, uuid[], uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Add a section.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_menu_section(
  p_restaurant_id  uuid,
  p_menu_id        uuid,
  p_parent_id      uuid,
  p_title          text,
  p_actor          uuid,
  p_drink_category text DEFAULT NULL,
  p_title_as_read  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_part       text := public.menu_section_key_part(coalesce(p_title_as_read, p_title));
  v_parent_key text;
  v_key        text;
  v_position   integer;
  v_id         uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'add_menu_section: adding a section names the person who added it (actor is NULL); nothing was changed'
      USING ERRCODE = '22023';
  END IF;
  IF p_title IS NULL OR btrim(p_title) = '' OR v_part = '' THEN
    RAISE EXCEPTION 'A section''s name needs at least one letter or digit. Nothing was changed.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.restaurant_menus
   WHERE id = p_menu_id AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'add_menu_section: no menu % in house %; nothing was changed', p_menu_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  IF p_parent_id IS NOT NULL THEN
    SELECT key INTO v_parent_key
      FROM public.menu_sections
     WHERE id = p_parent_id AND menu_id = p_menu_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'add_menu_section: no section % on menu %; nothing was changed', p_parent_id, p_menu_id
        USING ERRCODE = 'P0002';
    END IF;
    v_key := v_parent_key || '/' || v_part;
  ELSE
    v_key := v_part;
  END IF;

  IF EXISTS (SELECT 1 FROM public.menu_sections WHERE menu_id = p_menu_id AND key = v_key) THEN
    RAISE EXCEPTION 'This menu already has a section called that here. Nothing was changed.'
      USING ERRCODE = '23505';
  END IF;

  SELECT coalesce(max(position) + 1, 0) INTO v_position
    FROM public.menu_sections
   WHERE menu_id = p_menu_id AND parent_id IS NOT DISTINCT FROM p_parent_id;

  INSERT INTO public.menu_sections
    (restaurant_id, menu_id, parent_id, position, title, title_as_read, key, drink_category)
  VALUES
    (p_restaurant_id, p_menu_id, p_parent_id, v_position, btrim(p_title), p_title_as_read, v_key, p_drink_category)
  RETURNING id INTO v_id;

  INSERT INTO public.menu_section_changes (restaurant_id, menu_id, section_id, actor, action, before, after)
  VALUES (p_restaurant_id, p_menu_id, v_id, p_actor, 'create', NULL,
          jsonb_build_object('parent_id', p_parent_id, 'position', v_position, 'title', btrim(p_title),
                             'title_as_read', p_title_as_read, 'key', v_key,
                             'drink_category', p_drink_category));

  RETURN jsonb_build_object('id', v_id, 'menu_id', p_menu_id, 'parent_id', p_parent_id,
                            'position', v_position, 'title', btrim(p_title), 'key', v_key,
                            'drink_category', p_drink_category);
END
$$;

REVOKE ALL ON FUNCTION public.add_menu_section(uuid, uuid, uuid, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_menu_section(uuid, uuid, uuid, text, uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_menu_section(uuid, uuid, uuid, text, uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Reorder one parent's sections.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_menu_sections(
  p_restaurant_id uuid,
  p_menu_id       uuid,
  p_parent_id     uuid,
  p_ids           uuid[],
  p_actor         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before jsonb;
  v_after  jsonb;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'reorder_menu_sections: a reorder names the person who made it (actor is NULL); nothing was changed'
      USING ERRCODE = '22023';
  END IF;
  IF p_ids IS NULL OR array_position(p_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'reorder_menu_sections: the order names an empty id; nothing was changed'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.restaurant_menus
   WHERE id = p_menu_id AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reorder_menu_sections: no menu % in house %; nothing was changed', p_menu_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_ids) AS x
              WHERE NOT EXISTS (SELECT 1 FROM public.menu_sections s
                                 WHERE s.id = x AND s.menu_id = p_menu_id
                                   AND s.restaurant_id = p_restaurant_id)) THEN
    RAISE EXCEPTION 'reorder_menu_sections: a section in the order is not on menu %; nothing was changed', p_menu_id
      USING ERRCODE = 'P0002';
  END IF;

  IF cardinality(p_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_ids) AS x)
     OR (SELECT coalesce(array_agg(id ORDER BY id), '{}') FROM public.menu_sections
          WHERE menu_id = p_menu_id AND parent_id IS NOT DISTINCT FROM p_parent_id)
        IS DISTINCT FROM
        (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(p_ids) AS x) THEN
    RAISE EXCEPTION 'The sections here changed while you were ordering them. Reload and try again; nothing was changed.'
      USING ERRCODE = '40001';
  END IF;

  SELECT coalesce(jsonb_agg(id ORDER BY position), '[]'::jsonb) INTO v_before
    FROM public.menu_sections
   WHERE menu_id = p_menu_id AND parent_id IS NOT DISTINCT FROM p_parent_id;

  UPDATE public.menu_sections s
     SET position = o.ord - 1
    FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)
   WHERE s.id = o.id
     AND s.position IS DISTINCT FROM o.ord - 1;

  v_after := to_jsonb(p_ids);

  INSERT INTO public.menu_section_changes (restaurant_id, menu_id, section_id, actor, action, before, after)
  VALUES (p_restaurant_id, p_menu_id, p_parent_id, p_actor, 'reorder',
          jsonb_build_object('parent_id', p_parent_id, 'order', v_before),
          jsonb_build_object('parent_id', p_parent_id, 'order', v_after));

  RETURN jsonb_build_object('menu_id', p_menu_id, 'parent_id', p_parent_id, 'order', v_after);
END
$$;

REVOKE ALL ON FUNCTION public.reorder_menu_sections(uuid, uuid, uuid, uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reorder_menu_sections(uuid, uuid, uuid, uuid[], uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_menu_sections(uuid, uuid, uuid, uuid[], uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Assertions (catalogue reads only): invoker rights, no client execute.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.make_menu_current(uuid, uuid, uuid)',
    'public.make_menus_current(uuid, uuid[], uuid)',
    'public.add_menu_section(uuid, uuid, uuid, text, uuid, text, text)',
    'public.reorder_menu_sections(uuid, uuid, uuid, uuid[], uuid)'] LOOP
    IF (SELECT prosecdef FROM pg_proc WHERE oid = v_fn::regprocedure) THEN
      RAISE EXCEPTION '% must run with the caller''s rights', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% must not be callable by a client role', v_fn;
    END IF;
  END LOOP;
END
$$;
