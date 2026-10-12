-- ADR 0340 rules 12 and 14 (lane 5b): a draft read with its printed
-- sections keeps them, nested as printed (at most three levels), each with
-- the heading as read; the house's layout carries over by key from its live
-- (else latest archived) menu of the same kind, its confirmation never.
--
-- public.materialise_read_sections(p_restaurant_id, p_menu_id, p_actor,
-- p_sections) is the read's counterpart of materialise_menu_sections (which
-- makes sections from the lines' categories and stays the path for a read
-- with no section table). The gateway calls it only with MENUS_SPLIT_BY_KIND
-- on, once per draft of the split, right after the draft's lines are written.
--
-- p_sections is a JSON array, one entry per printed section, in reading
-- order:
--   { "path": ["Wines", "Red"],          -- outermost first; cut to 3 levels
--     "suggested_kind": "beverage" | "food" | "desserts" | "unknown" | null,
--     "suggested_category": a vocabulary token | null,
--     "suggested_by": "rules" | "read" | "second_opinion" | null,
--     "lines": [menu_items.id, ...] }    -- the lines printed under it
--
-- A level whose heading has no letter or digit is skipped. An ancestor the
-- read named only as a parent is made too, with no suggestion. A section is
-- found by its path-scoped key (menu_section_key_part), so two spellings of
-- one heading are one section. A NEW section's drink_category stays NULL:
-- the read's category is a suggestion for the owner's tap
-- (suggested_category), never a decision. An inherited one copies title,
-- position and drink_category from the source by key.
--
-- Positions: an inherited section keeps its source position; a new one goes
-- after the highest inherited position among its siblings, in reading order.
--
-- Each section made is one 'create' row in menu_section_changes ('source':
-- 'read'). Each listed line of THIS menu with no section yet is placed.
--
-- Errors, for the gateway's mapping: 22023 bad input (actor NULL,
-- p_sections not an array); P0002 not this house's menu; 55000 not a draft,
-- or the draft already has sections (a read is materialised once).
--
-- SECURITY INVOKER, search_path pinned, EXECUTE for service_role only. Every
-- lookup carries restaurant_id.

CREATE OR REPLACE FUNCTION public.materialise_read_sections(
  p_restaurant_id uuid,
  p_menu_id       uuid,
  p_actor         uuid,
  p_sections      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_menu      record;
  v_source    uuid;
  v_entry     jsonb;
  v_path      text[];
  v_heading   text;
  v_part      text;
  v_key       text;
  v_parent    uuid;
  v_id        uuid;
  v_src       record;
  v_leaf      boolean;
  v_seq       integer := 0;
  v_lvl       integer;
  v_kind      text;
  v_category  text;
  v_by        text;
  v_n         integer;
  v_created   integer := 0;
  v_inherited integer := 0;
  v_lines     integer := 0;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'materialise_read_sections: the sections of a read name the person who read it (actor is NULL); nothing was changed'
      USING ERRCODE = '22023';
  END IF;
  IF p_sections IS NULL OR jsonb_typeof(p_sections) <> 'array' THEN
    RAISE EXCEPTION 'materialise_read_sections: the sections of a read are a list; nothing was changed'
      USING ERRCODE = '22023';
  END IF;

  SELECT id, status, menu_type INTO v_menu
    FROM public.restaurant_menus
   WHERE id = p_menu_id AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'materialise_read_sections: no menu % in house %; nothing was changed', p_menu_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_menu.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'materialise_read_sections: sections are made for a draft as it is read; menu % is %. Nothing was changed.', p_menu_id, v_menu.status
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.menu_sections
              WHERE menu_id = p_menu_id AND restaurant_id = p_restaurant_id) THEN
    RAISE EXCEPTION 'materialise_read_sections: menu % already has its sections; a read is materialised once. Nothing was changed.', p_menu_id
      USING ERRCODE = '55000';
  END IF;

  -- The menu whose layout carries over: the live one of this kind, else the
  -- latest archived one (rule 12), as materialise_menu_sections chooses it.
  SELECT id INTO v_source
    FROM public.restaurant_menus
   WHERE restaurant_id = p_restaurant_id
     AND menu_type = v_menu.menu_type
     AND id <> p_menu_id
     AND status IN ('active', 'archived')
   ORDER BY (status = 'active') DESC, retired_at DESC NULLS LAST,
            made_current_at DESC NULLS LAST, created_at DESC, id
   LIMIT 1;

  FOR v_entry IN SELECT e FROM jsonb_array_elements(p_sections) AS e LOOP
    CONTINUE WHEN jsonb_typeof(v_entry) <> 'object'
              OR jsonb_typeof(v_entry->'path') IS DISTINCT FROM 'array';
    SELECT coalesce(array_agg(h ORDER BY o), '{}')
      INTO v_path
      FROM (SELECT left(btrim(x.h), 200) AS h, x.o
              FROM jsonb_array_elements_text(
                     CASE WHEN (SELECT bool_and(jsonb_typeof(y) = 'string')
                                  FROM jsonb_array_elements(v_entry->'path') y)
                          THEN v_entry->'path' ELSE '[]'::jsonb END)
                   WITH ORDINALITY AS x(h, o)) p
     WHERE public.menu_section_key_part(h) <> '';
    v_path := v_path[1:3];
    CONTINUE WHEN coalesce(array_length(v_path, 1), 0) = 0;

    v_kind := v_entry->>'suggested_kind';
    IF v_kind IS NOT NULL AND v_kind NOT IN ('beverage', 'food', 'desserts', 'unknown') THEN
      v_kind := NULL;
    END IF;
    v_category := v_entry->>'suggested_category';
    IF v_category IS NOT NULL AND v_category NOT IN (
         'red', 'white', 'rose', 'sparkling', 'orange', 'dessert', 'fortified', 'beer',
         'cider', 'sake', 'cocktail', 'spirit', 'whiskey', 'soft drink', 'non-alcoholic') THEN
      v_category := NULL;
    END IF;
    v_by := nullif(btrim(coalesce(v_entry->>'suggested_by', '')), '');
    IF v_by IS NOT NULL AND v_by NOT IN ('rules', 'read', 'second_opinion') THEN
      v_by := NULL;
    END IF;

    v_parent := NULL;
    v_key := '';
    FOR v_lvl IN 1 .. array_length(v_path, 1) LOOP
      v_heading := v_path[v_lvl];
      v_part := public.menu_section_key_part(v_heading);
      v_key := CASE WHEN v_key = '' THEN v_part ELSE v_key || '/' || v_part END;
      v_leaf := v_lvl = array_length(v_path, 1);

      SELECT id INTO v_id FROM public.menu_sections
       WHERE menu_id = p_menu_id AND restaurant_id = p_restaurant_id AND key = v_key;
      IF NOT FOUND THEN
        SELECT s.id, s.title, s.drink_category INTO v_src
          FROM public.menu_sections s
         WHERE s.menu_id = v_source AND s.restaurant_id = p_restaurant_id AND s.key = v_key;
        v_seq := v_seq + 1;
        -- A temporary position past any real one, in reading order; the
        -- final positions are set below, once every sibling is known.
        INSERT INTO public.menu_sections
          (restaurant_id, menu_id, parent_id, position, title, title_as_read, key,
           drink_category, suggested_kind, suggested_category, suggested_by,
           inherited_from_section_id)
        VALUES (p_restaurant_id, p_menu_id, v_parent, 1000000 + v_seq,
                coalesce(v_src.title, v_heading), v_heading, v_key,
                v_src.drink_category,
                CASE WHEN v_leaf THEN v_kind END,
                CASE WHEN v_leaf THEN v_category END,
                CASE WHEN v_leaf THEN v_by END,
                v_src.id)
        RETURNING id INTO v_id;
      END IF;
      v_parent := v_id;
    END LOOP;

    IF jsonb_typeof(v_entry->'lines') = 'array' THEN
      UPDATE public.menu_items mi
         SET section_id = v_parent
       WHERE mi.menu_id = p_menu_id
         AND mi.restaurant_id = p_restaurant_id
         AND mi.section_id IS NULL
         AND mi.id::text IN (SELECT jsonb_array_elements_text(
                               CASE WHEN (SELECT bool_and(jsonb_typeof(y) = 'string')
                                            FROM jsonb_array_elements(v_entry->'lines') y)
                                    THEN v_entry->'lines' ELSE '[]'::jsonb END));
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_lines := v_lines + v_n;
    END IF;
  END LOOP;

  -- Final positions (the one-per-place constraint is deferred to commit).
  UPDATE public.menu_sections s
     SET position = x.position
    FROM (
      SELECT d.id,
             CASE
               WHEN src.id IS NOT NULL THEN src.position
               ELSE coalesce(max(src.position) OVER (PARTITION BY d.parent_id), -1) + 1
                    + row_number() OVER (PARTITION BY d.parent_id, (src.id IS NULL)
                                         ORDER BY d.position) - 1
             END AS position
        FROM public.menu_sections d
        LEFT JOIN public.menu_sections src
          ON src.id = d.inherited_from_section_id
         AND src.restaurant_id = p_restaurant_id
       WHERE d.menu_id = p_menu_id AND d.restaurant_id = p_restaurant_id
    ) x
   WHERE s.id = x.id AND s.position IS DISTINCT FROM x.position;

  WITH logged AS (
    INSERT INTO public.menu_section_changes (restaurant_id, menu_id, section_id, actor, action, before, after)
    SELECT p_restaurant_id, p_menu_id, s.id, p_actor, 'create', NULL,
           jsonb_build_object('parent_id', s.parent_id, 'position', s.position, 'title', s.title,
                              'title_as_read', s.title_as_read, 'key', s.key,
                              'drink_category', s.drink_category,
                              'suggested_kind', s.suggested_kind,
                              'suggested_category', s.suggested_category,
                              'suggested_by', s.suggested_by,
                              'inherited_from_section_id', s.inherited_from_section_id,
                              'source', 'read')
      FROM public.menu_sections s
     WHERE s.menu_id = p_menu_id AND s.restaurant_id = p_restaurant_id
    RETURNING after
  )
  SELECT count(*), count(*) FILTER (WHERE after->>'inherited_from_section_id' IS NOT NULL)
    INTO v_created, v_inherited
    FROM logged;

  RETURN jsonb_build_object('menu_id', p_menu_id, 'sections', v_created,
                            'inherited', v_inherited, 'lines', v_lines,
                            'inherited_from_menu_id', v_source);
END
$$;

COMMENT ON FUNCTION public.materialise_read_sections(uuid, uuid, uuid, jsonb) IS
  'ADR 0340 rules 12 and 14 (lane 5b): a draft''s sections as its read printed them, nested at most three levels, with the heading as read and the read''s kind and category as suggestions; the house''s layout carried over by key, confirmation not copied. Logs one create per section; places the listed lines. Called only with MENUS_SPLIT_BY_KIND on.';

DO $$
DECLARE
  v_fn text := 'public.materialise_read_sections(uuid, uuid, uuid, jsonb)';
BEGIN
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', v_fn);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_fn::regprocedure) THEN
    RAISE EXCEPTION '% must run with the caller''s rights', v_fn;
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '% must not be callable by a client role', v_fn;
  END IF;
END
$$;
