-- A MENU SECTION IS EDITED AND LOGGED IN ONE STEP (ADR 0340 rules 6, 9, 10,
-- 12, 16, 18, 24; founder answer S208 items 2, 3 and 5; lane 3b).
--
-- Lane 1 gave a menu its sections, the change log and two writers
-- (add_menu_section, reorder_menu_sections). Every other edit the review and
-- the Full menu need is here, each as ONE function, so the edit and its
-- menu_section_changes row commit together or not at all: the gateway's
-- client cannot hold a transaction across two writes, and a section edit
-- with no log row, or a log row for an edit that failed, is the failure
-- rule 6 ("every ... writes one row") rules out.
--
-- WHAT THIS FILE DOES
-- 0. menu_section_changes.action also allows 'assign' (lines put in a
--    section) and 'keep' (a Gone line kept into a draft). Both are writes the
--    review makes; rule 6's list named section edits only.
-- 1. materialise_menu_sections(house, menu, actor): the back-fill rule of
--    20270107200000 for ONE draft, run right after an upload writes its lines
--    (rule 12, "from category before" lane 5b's section table): one top-level
--    section per distinct normalised non-blank category, then every line
--    with such a category gets its section. Then the layout carries over:
--    each new section whose key the house's live menu of the same kind (else
--    its latest archived one) has copies that section's title, position and
--    drink_category and names it in inherited_from_section_id; confirmed_by
--    and confirmed_at are NOT copied (F21). One 'create' row per section.
-- 2. rename_menu_section: the title only; the key stays, so the house's name
--    carries to the next upload of the same heading. Live allowed (rule 9).
-- 3. reparent_menu_section: a new parent on the same menu (or the top
--    level), at the end of that parent's list; the section's key and its
--    subsections' keys follow the new path. Live allowed (rule 9), EXCEPT
--    when the section names no category of its own and the move would change
--    the category it inherits while it holds lines: that changes how drinks
--    are filed, which is a review's (409).
-- 4. delete_menu_section: a section with subsections is refused (409, move
--    or delete them first); otherwise it is deleted and its lines go to
--    Unsorted (menu_items_section_is_on_the_same_menu ... ON DELETE SET NULL).
--    On the live menu only an EMPTY section is deleted (409 otherwise).
-- 5. move_menu_section_to_kind: drafts only (rule 10). The target is the
--    upload's draft of that kind (same read_together_id), created in the same
--    transaction when the upload produced none. The UPDATE of menu_id is the
--    one lane 1's trigger guards (house lock, drafts of one upload, parent
--    NULL, position at the end, key re-cut); subsections and lines follow by
--    ON UPDATE CASCADE.
-- 6. set_menu_section_category: drafts only (rule 9: on a live menu a
--    category change files drinks outside a dated carry; 409). A person
--    setting a category is their tap: confirmed_by/at are set.
-- 7. confirm_menu_section: drafts only. The owner says Drink (optionally
--    with a category) or Dish for a section; every line under it (its
--    subsections included) that AGREES takes that kind. Before lane 5a's
--    rules exist, a line agrees when it has no stored kind or the same one;
--    a line already stored as the other kind, or one that cannot be a dish
--    because it carries both a bottle and a glass price, is left for its own
--    tap and counted. A line made a dish moves its one price to `price` and
--    loses its drink category and `category` token (rule 7, F20).
-- 8. confirm_menu_line: the same for one line, drafts only; a drink line
--    may be given its own category (the per-line override); a dish with both
--    a bottle and a glass price is refused (22023).
-- 9. assign_menu_lines: put lines in a section (or Unsorted), drafts only.
--    Rule 9 names section edits as presentation on a live menu, not line
--    moves, and a line's section decides its inherited drink category.
-- 10. keep_gone_menu_line: copy a line of the house's LIVE menu of the
--    draft's kind into the draft as a new line (rule 18 "Keep"): kind,
--    category, section key, prices and library link. The section path is
--    found by key on the draft, or created (logged), so a kept line is never
--    Unsorted when it had a section. A line the draft already holds (same
--    library wine, or same name, producer and vintage) is 23505.
--
-- Errors, for the gateway's mapping: 22023 bad input (400); P0002 not this
-- house's (404, ADR 0147); 55000 refused by the menu's state, live or
-- archived (409); 23505 a key or line already there (409); 23514 a shape the
-- table refuses, cycle or depth (400). An archived menu is history: no edit
-- reaches it.
--
-- All ten: SECURITY INVOKER, search_path pinned, EXECUTE for service_role
-- only. Every lookup carries restaurant_id.

-- ---------------------------------------------------------------------------
-- 0. Two more actions in the log.
-- ---------------------------------------------------------------------------
ALTER TABLE public.menu_section_changes
  DROP CONSTRAINT IF EXISTS menu_section_changes_action_check;
ALTER TABLE public.menu_section_changes
  ADD CONSTRAINT menu_section_changes_action_check CHECK (action IN (
    'create', 'rename', 'reorder', 'reparent', 'move', 'category', 'confirm', 'delete',
    'assign', 'keep'));

-- ---------------------------------------------------------------------------
-- 1. Sections from an upload's categories, the house's layout carried over.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.materialise_menu_sections(
  p_restaurant_id uuid,
  p_menu_id       uuid,
  p_actor         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_menu      record;
  v_source    uuid;
  v_had       boolean;
  v_country   text;
  v_created   integer := 0;
  v_inherited integer := 0;
  v_lines     integer := 0;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'materialise_menu_sections: the sections of a read name the person who read it (actor is NULL); nothing was changed'
      USING ERRCODE = '22023';
  END IF;

  SELECT id, status, menu_type INTO v_menu
    FROM public.restaurant_menus
   WHERE id = p_menu_id AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'materialise_menu_sections: no menu % in house %; nothing was changed', p_menu_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_menu.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'materialise_menu_sections: sections are made for a draft as it is read; menu % is %. Nothing was changed.', p_menu_id, v_menu.status
      USING ERRCODE = '55000';
  END IF;

  -- The menu whose layout carries over: the live one of this kind, else the
  -- latest archived one (rule 12).
  SELECT id INTO v_source
    FROM public.restaurant_menus
   WHERE restaurant_id = p_restaurant_id
     AND menu_type = v_menu.menu_type
     AND id <> p_menu_id
     AND status IN ('active', 'archived')
   ORDER BY (status = 'active') DESC, retired_at DESC NULLS LAST,
            made_current_at DESC NULLS LAST, created_at DESC, id
   LIMIT 1;

  v_had := EXISTS (SELECT 1 FROM public.menu_sections WHERE menu_id = p_menu_id);
  SELECT lower(btrim(coalesce(country, ''))) INTO v_country
    FROM public.restaurants WHERE id = p_restaurant_id;

  WITH vocabulary(token, en, tr) AS (
    VALUES
      ('red',           'Red wines',        'Kırmızı şaraplar'),
      ('white',         'White wines',      'Beyaz şaraplar'),
      ('rose',          'Rosé wines',       'Roze şaraplar'),
      ('sparkling',     'Sparkling wines',  'Köpüklü şaraplar'),
      ('orange',        'Orange wines',     'Turuncu şaraplar'),
      ('dessert',       'Dessert wines',    'Tatlı şaraplar'),
      ('fortified',     'Fortified wines',  'Güçlendirilmiş şaraplar'),
      ('beer',          'Beers',            'Biralar'),
      ('cider',         'Ciders',           'Elma şarapları'),
      ('sake',          'Sake',             'Sake'),
      ('cocktail',      'Cocktails',        'Kokteyller'),
      ('spirit',        'Spirits',          'Sert içkiler'),
      ('whiskey',       'Whiskeys',         'Viskiler'),
      ('soft drink',    'Soft drinks',      'Meşrubatlar'),
      ('non-alcoholic', 'Non-alcoholic',    'Alkolsüz içecekler')
  ),
  lines AS (
    SELECT btrim(mi.category) AS spelling,
           public.menu_section_key_part(mi.category) AS key
      FROM public.menu_items mi
     WHERE mi.menu_id = p_menu_id
       AND mi.restaurant_id = p_restaurant_id
       AND mi.category IS NOT NULL
       AND public.menu_section_key_part(mi.category) <> ''
  ),
  spellings AS (
    SELECT key, spelling, count(*) AS n FROM lines GROUP BY key, spelling
  ),
  wanted AS (
    SELECT DISTINCT ON (s.key)
           s.key, s.spelling AS most_used,
           (SELECT min(x.spelling) FROM spellings x WHERE x.key = s.key) AS lowest
      FROM spellings s
     WHERE NOT EXISTS (SELECT 1 FROM public.menu_sections e
                        WHERE e.menu_id = p_menu_id AND e.key = s.key)
     ORDER BY s.key, s.n DESC, s.spelling
  ),
  matched AS (
    SELECT w.*, src.id AS src_id, src.title AS src_title, src.position AS src_position,
           src.drink_category AS src_category
      FROM wanted w
      LEFT JOIN public.menu_sections src
        ON src.menu_id = v_source
       AND src.restaurant_id = p_restaurant_id
       AND src.key = w.key
  ),
  base AS (
    -- Inherited positions are kept only on a menu with no section yet, so
    -- they cannot meet a position already taken; new ones go after them.
    SELECT coalesce(
             (SELECT max(e.position) + 1 FROM public.menu_sections e
               WHERE e.menu_id = p_menu_id AND e.parent_id IS NULL),
             0) AS after_existing,
           coalesce((SELECT max(m.src_position) + 1 FROM matched m
                      WHERE m.src_id IS NOT NULL AND NOT v_had), 0) AS after_inherited
  ),
  placed AS (
    SELECT m.*,
           CASE
             WHEN m.src_id IS NOT NULL AND NOT v_had THEN m.src_position
             ELSE (SELECT greatest(b.after_existing, b.after_inherited) FROM base b)
                  + row_number() OVER (
                      PARTITION BY (m.src_id IS NOT NULL AND NOT v_had)
                      ORDER BY lower(m.lowest), m.lowest, m.key) - 1
           END AS position
      FROM matched m
  ),
  inserted AS (
    INSERT INTO public.menu_sections
      (restaurant_id, menu_id, parent_id, position, title, title_as_read, key,
       drink_category, inherited_from_section_id)
    SELECT p_restaurant_id, p_menu_id, NULL, p.position,
           CASE
             WHEN p.src_id IS NOT NULL THEN p.src_title
             WHEN v.token IS NULL THEN p.most_used
             WHEN v_country IN ('tr', 'tur', 'turkey', 'türkiye', 'turkiye') THEN v.tr
             ELSE v.en
           END,
           NULL,
           p.key,
           CASE WHEN p.src_id IS NOT NULL THEN p.src_category ELSE v.token END,
           p.src_id
      FROM placed p
      LEFT JOIN vocabulary v ON public.menu_section_key_part(v.token) = p.key
    RETURNING id, key, inherited_from_section_id, position, title, drink_category
  ),
  logged AS (
    INSERT INTO public.menu_section_changes (restaurant_id, menu_id, section_id, actor, action, before, after)
    SELECT p_restaurant_id, p_menu_id, id, p_actor, 'create', NULL,
           jsonb_build_object('parent_id', NULL, 'position', position, 'title', title,
                              'title_as_read', NULL, 'key', key, 'drink_category', drink_category,
                              'inherited_from_section_id', inherited_from_section_id,
                              'source', 'upload')
      FROM inserted
    RETURNING after
  )
  SELECT count(*), count(*) FILTER (WHERE after->>'inherited_from_section_id' IS NOT NULL)
    INTO v_created, v_inherited
    FROM logged;

  UPDATE public.menu_items mi
     SET section_id = s.id
    FROM public.menu_sections s
   WHERE s.menu_id = mi.menu_id
     AND mi.menu_id = p_menu_id
     AND mi.restaurant_id = p_restaurant_id
     AND s.key = public.menu_section_key_part(mi.category)
     AND mi.section_id IS NULL
     AND mi.category IS NOT NULL
     AND public.menu_section_key_part(mi.category) <> '';
  GET DIAGNOSTICS v_lines = ROW_COUNT;

  RETURN jsonb_build_object('menu_id', p_menu_id, 'sections', v_created,
                            'inherited', v_inherited, 'lines', v_lines,
                            'inherited_from_menu_id', v_source);
END
$$;

COMMENT ON FUNCTION public.materialise_menu_sections(uuid, uuid, uuid) IS
  'ADR 0340 rule 12: a draft''s sections from its lines'' categories (the back-fill rule), the house''s layout carried over by key from its live (else latest archived) menu of the same kind, confirmation not copied. Logs one create per section.';

-- ---------------------------------------------------------------------------
-- 2. Rename.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rename_menu_section(
  p_restaurant_id uuid,
  p_section_id    uuid,
  p_title         text,
  p_actor         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s      record;
  v_status text;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'rename_menu_section: a rename names the person who made it (actor is NULL); nothing was changed'
      USING ERRCODE = '22023';
  END IF;
  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'A section''s name cannot be blank. Nothing was changed.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_s FROM public.menu_sections
   WHERE id = p_section_id AND restaurant_id = p_restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rename_menu_section: no section % in house %; nothing was changed', p_section_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;
  SELECT status INTO v_status FROM public.restaurant_menus
   WHERE id = v_s.menu_id AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF v_status = 'archived' THEN
    RAISE EXCEPTION 'That menu is kept as it was; its sections are not edited. Nothing was changed.'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.menu_sections SET title = btrim(p_title)
   WHERE id = p_section_id AND restaurant_id = p_restaurant_id;

  INSERT INTO public.menu_section_changes (restaurant_id, menu_id, section_id, actor, action, before, after)
  VALUES (p_restaurant_id, v_s.menu_id, p_section_id, p_actor, 'rename',
          jsonb_build_object('title', v_s.title), jsonb_build_object('title', btrim(p_title)));

  RETURN jsonb_build_object('id', p_section_id, 'menu_id', v_s.menu_id, 'title', btrim(p_title));
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Reparent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reparent_menu_section(
  p_restaurant_id uuid,
  p_section_id    uuid,
  p_parent_id     uuid,
  p_actor         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s          record;
  v_status     text;
  v_parent_key text;
  v_new_key    text;
  v_position   integer;
  v_old_inh    text;
  v_new_inh    text;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'reparent_menu_section: a move names the person who made it (actor is NULL); nothing was changed'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_s FROM public.menu_sections
   WHERE id = p_section_id AND restaurant_id = p_restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reparent_menu_section: no section % in house %; nothing was changed', p_section_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;
  SELECT status INTO v_status FROM public.restaurant_menus
   WHERE id = v_s.menu_id AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF v_status = 'archived' THEN
    RAISE EXCEPTION 'That menu is kept as it was; its sections are not edited. Nothing was changed.'
      USING ERRCODE = '55000';
  END IF;

  IF p_parent_id IS NOT NULL THEN
    SELECT key INTO v_parent_key FROM public.menu_sections
     WHERE id = p_parent_id AND menu_id = v_s.menu_id AND restaurant_id = p_restaurant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'reparent_menu_section: no section % on menu %; nothing was changed', p_parent_id, v_s.menu_id
        USING ERRCODE = 'P0002';
    END IF;
    v_new_key := v_parent_key || '/' || regexp_replace(v_s.key, '^.*/', '');
  ELSE
    v_new_key := regexp_replace(v_s.key, '^.*/', '');
  END IF;

  -- The category the section inherits, before and after (nearest ancestor
  -- with one). Only matters when it names none of its own.
  IF v_status = 'active' AND v_s.drink_category IS NULL THEN
    WITH RECURSIVE up(id, parent_id, drink_category, lvl) AS (
      SELECT id, parent_id, drink_category, 1 FROM public.menu_sections WHERE id = v_s.parent_id
      UNION ALL
      SELECT p.id, p.parent_id, p.drink_category, u.lvl + 1
        FROM public.menu_sections p JOIN up u ON p.id = u.parent_id WHERE u.lvl < 4
    )
    SELECT drink_category INTO v_old_inh FROM up WHERE drink_category IS NOT NULL ORDER BY lvl LIMIT 1;
    WITH RECURSIVE up(id, parent_id, drink_category, lvl) AS (
      SELECT id, parent_id, drink_category, 1 FROM public.menu_sections WHERE id = p_parent_id
      UNION ALL
      SELECT p.id, p.parent_id, p.drink_category, u.lvl + 1
        FROM public.menu_sections p JOIN up u ON p.id = u.parent_id WHERE u.lvl < 4
    )
    SELECT drink_category INTO v_new_inh FROM up WHERE drink_category IS NOT NULL ORDER BY lvl LIMIT 1;
    IF v_old_inh IS DISTINCT FROM v_new_inh
       AND EXISTS (SELECT 1 FROM public.menu_items mi
                    JOIN public.menu_sections t ON t.id = mi.section_id
                   WHERE mi.menu_id = v_s.menu_id
                     AND mi.restaurant_id = p_restaurant_id
                     AND (t.id = v_s.id OR left(t.key, length(v_s.key) + 1) = v_s.key || '/')) THEN
      RAISE EXCEPTION 'Moving this section on the live menu would change the drink category its lines are filed under (% to %). Change it in a review. Nothing was changed.',
        coalesce(v_old_inh, 'none'), coalesce(v_new_inh, 'none')
        USING ERRCODE = '55000';
    END IF;
  END IF;

  SELECT coalesce(max(position) + 1, 0) INTO v_position
    FROM public.menu_sections
   WHERE menu_id = v_s.menu_id AND parent_id IS NOT DISTINCT FROM p_parent_id
     AND id <> p_section_id;

  UPDATE public.menu_sections
     SET parent_id = p_parent_id, position = v_position
   WHERE id = p_section_id AND restaurant_id = p_restaurant_id;

  -- The section's key and its subsections' keys follow the new path.
  UPDATE public.menu_sections
     SET key = v_new_key || substr(key, length(v_s.key) + 1)
   WHERE menu_id = v_s.menu_id
     AND restaurant_id = p_restaurant_id
     AND (id = p_section_id OR left(key, length(v_s.key) + 1) = v_s.key || '/');

  INSERT INTO public.menu_section_changes (restaurant_id, menu_id, section_id, actor, action, before, after)
  VALUES (p_restaurant_id, v_s.menu_id, p_section_id, p_actor, 'reparent',
          jsonb_build_object('parent_id', v_s.parent_id, 'position', v_s.position, 'key', v_s.key),
          jsonb_build_object('parent_id', p_parent_id, 'position', v_position, 'key', v_new_key));

  RETURN jsonb_build_object('id', p_section_id, 'menu_id', v_s.menu_id, 'parent_id', p_parent_id,
                            'position', v_position, 'key', v_new_key);
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Delete.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_menu_section(
  p_restaurant_id uuid,
  p_section_id    uuid,
  p_actor         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s      record;
  v_status text;
  v_lines  integer;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'delete_menu_section: a delete names the person who made it (actor is NULL); nothing was changed'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_s FROM public.menu_sections
   WHERE id = p_section_id AND restaurant_id = p_restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delete_menu_section: no section % in house %; nothing was changed', p_section_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;
  SELECT status INTO v_status FROM public.restaurant_menus
   WHERE id = v_s.menu_id AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF v_status = 'archived' THEN
    RAISE EXCEPTION 'That menu is kept as it was; its sections are not edited. Nothing was changed.'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.menu_sections WHERE parent_id = p_section_id) THEN
    RAISE EXCEPTION 'This section has sections inside it. Move or delete those first. Nothing was changed.'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_lines FROM public.menu_items
   WHERE section_id = p_section_id AND menu_id = v_s.menu_id AND restaurant_id = p_restaurant_id;
  -- On the live menu only an empty section goes: moving live lines to
  -- Unsorted would change what they are filed under without a new version.
  IF v_status = 'active' AND v_lines > 0 THEN
    RAISE EXCEPTION 'This section on the live menu still has lines. Move them first, or edit a new version. Nothing was changed.'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.menu_sections WHERE id = p_section_id AND restaurant_id = p_restaurant_id;

  INSERT INTO public.menu_section_changes (restaurant_id, menu_id, section_id, actor, action, before, after)
  VALUES (p_restaurant_id, v_s.menu_id, p_section_id, p_actor, 'delete',
          jsonb_build_object('parent_id', v_s.parent_id, 'position', v_s.position, 'title', v_s.title,
                             'key', v_s.key, 'drink_category', v_s.drink_category, 'lines', v_lines),
          jsonb_build_object('lines_to_unsorted', v_lines));

  RETURN jsonb_build_object('id', p_section_id, 'menu_id', v_s.menu_id, 'lines_to_unsorted', v_lines);
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Move to another kind (drafts of one upload only).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.move_menu_section_to_kind(
  p_restaurant_id uuid,
  p_section_id    uuid,
  p_kind          text,
  p_actor         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s       record;
  v_from    record;
  v_target  uuid;
  v_created boolean := false;
  v_after   record;
  v_lines   uuid[];
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'move_menu_section_to_kind: a move names the person who made it (actor is NULL); nothing was changed'
      USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('beverage', 'food', 'desserts') THEN
    RAISE EXCEPTION 'A section moves to Drinks, Food or Desserts. Nothing was changed.'
      USING ERRCODE = '22023';
  END IF;

  -- The lock make_menu_current takes first (the move trigger takes it too).
  PERFORM 1 FROM public.restaurants WHERE id = p_restaurant_id FOR UPDATE;

  SELECT * INTO v_s FROM public.menu_sections
   WHERE id = p_section_id AND restaurant_id = p_restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'move_menu_section_to_kind: no section % in house %; nothing was changed', p_section_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_from FROM public.restaurant_menus
   WHERE id = v_s.menu_id AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF v_from.status IS DISTINCT FROM 'draft' OR v_from.read_together_id IS NULL THEN
    RAISE EXCEPTION 'A section moves to another kind only while its upload is in review; a live or kept menu changes through a new review. Nothing was changed.'
      USING ERRCODE = '55000';
  END IF;
  IF v_from.menu_type = p_kind THEN
    RAISE EXCEPTION 'This section is already on that menu. Nothing was changed.'
      USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_target FROM public.restaurant_menus
   WHERE restaurant_id = p_restaurant_id
     AND read_together_id = v_from.read_together_id
     AND menu_type = p_kind
     AND status = 'draft'
   ORDER BY created_at, id
   LIMIT 1
   FOR UPDATE;

  IF v_target IS NULL THEN
    -- The upload produced no draft of this kind: one is made in the batch.
    -- Its extraction is empty (rule 10: each draft's extraction stays as
    -- read); the source is the upload's.
    INSERT INTO public.restaurant_menus
      (restaurant_id, name, menu_type, status, cadence, menu_date, menu_date_precision,
       source_method, source_path, source_sha256, source_mime, source_bytes, source_failure,
       extraction, lines_extracted, extracted_by, extracted_at, read_together_id)
    VALUES
      (p_restaurant_id,
       CASE p_kind WHEN 'food' THEN 'Food menu' WHEN 'desserts' THEN 'Desserts menu' ELSE 'Drinks list' END,
       p_kind, 'draft', v_from.cadence, v_from.menu_date, v_from.menu_date_precision,
       v_from.source_method, v_from.source_path, v_from.source_sha256, v_from.source_mime,
       v_from.source_bytes, v_from.source_failure,
       '[]'::jsonb, 0, v_from.extracted_by, v_from.extracted_at, v_from.read_together_id)
    RETURNING id INTO v_target;
    v_created := true;
  END IF;

  SELECT coalesce(array_agg(mi.id ORDER BY mi.id), '{}') INTO v_lines
    FROM public.menu_items mi
    JOIN public.menu_sections t ON t.id = mi.section_id
   WHERE mi.menu_id = v_s.menu_id
     AND mi.restaurant_id = p_restaurant_id
     AND (t.id = v_s.id OR left(t.key, length(v_s.key) + 1) = v_s.key || '/');

  UPDATE public.menu_sections SET menu_id = v_target
   WHERE id = p_section_id AND restaurant_id = p_restaurant_id;

  SELECT parent_id, position, key INTO v_after FROM public.menu_sections WHERE id = p_section_id;

  INSERT INTO public.menu_section_changes (restaurant_id, menu_id, section_id, actor, action, before, after)
  VALUES (p_restaurant_id, v_target, p_section_id, p_actor, 'move',
          jsonb_build_object('menu_id', v_s.menu_id, 'kind', v_from.menu_type,
                             'parent_id', v_s.parent_id, 'position', v_s.position, 'key', v_s.key),
          jsonb_build_object('menu_id', v_target, 'kind', p_kind, 'created_menu', v_created,
                             'parent_id', v_after.parent_id, 'position', v_after.position,
                             'key', v_after.key, 'lines', cardinality(v_lines)));

  RETURN jsonb_build_object('id', p_section_id, 'from_menu_id', v_s.menu_id, 'menu_id', v_target,
                            'kind', p_kind, 'created_menu', v_created, 'key', v_after.key,
                            'position', v_after.position, 'line_ids', to_jsonb(v_lines));
END
$$;

-- ---------------------------------------------------------------------------
-- 6. A section's drink category (drafts only).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_menu_section_category(
  p_restaurant_id  uuid,
  p_section_id     uuid,
  p_drink_category text,
  p_actor          uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s      record;
  v_status text;
  v_at     timestamptz := now();
  v_lines  uuid[];
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'set_menu_section_category: a category names the person who set it (actor is NULL); nothing was changed'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_s FROM public.menu_sections
   WHERE id = p_section_id AND restaurant_id = p_restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_menu_section_category: no section % in house %; nothing was changed', p_section_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;
  SELECT status INTO v_status FROM public.restaurant_menus
   WHERE id = v_s.menu_id AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'A section''s drink category changes how its drinks are filed, so it is set in a review, not on a live or kept menu. Read the menu again or restore it to change it. Nothing was changed.'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.menu_sections
     SET drink_category = p_drink_category,
         confirmed_by = CASE WHEN p_drink_category IS NULL THEN confirmed_by ELSE p_actor END,
         confirmed_at = CASE WHEN p_drink_category IS NULL THEN confirmed_at ELSE v_at END
   WHERE id = p_section_id AND restaurant_id = p_restaurant_id;

  SELECT coalesce(array_agg(mi.id ORDER BY mi.id), '{}') INTO v_lines
    FROM public.menu_items mi
    JOIN public.menu_sections t ON t.id = mi.section_id
   WHERE mi.menu_id = v_s.menu_id
     AND mi.restaurant_id = p_restaurant_id
     AND (t.id = v_s.id OR left(t.key, length(v_s.key) + 1) = v_s.key || '/');

  INSERT INTO public.menu_section_changes (restaurant_id, menu_id, section_id, actor, action, before, after)
  VALUES (p_restaurant_id, v_s.menu_id, p_section_id, p_actor, 'category',
          jsonb_build_object('drink_category', v_s.drink_category),
          jsonb_build_object('drink_category', p_drink_category));

  RETURN jsonb_build_object('id', p_section_id, 'menu_id', v_s.menu_id,
                            'drink_category', p_drink_category, 'line_ids', to_jsonb(v_lines));
END
$$;

-- ---------------------------------------------------------------------------
-- 7. The owner's tap on a section.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_menu_section(
  p_restaurant_id  uuid,
  p_section_id     uuid,
  p_line_kind      text,
  p_drink_category text,
  p_actor          uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s       record;
  v_status  text;
  v_at      timestamptz := now();
  v_applied uuid[];
  v_left    uuid[];
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'confirm_menu_section: a confirmation names the person who made it (actor is NULL); nothing was changed'
      USING ERRCODE = '22023';
  END IF;
  IF p_line_kind IS NULL OR p_line_kind NOT IN ('drink', 'dish') THEN
    RAISE EXCEPTION 'A section is confirmed as drinks or as dishes. Nothing was changed.'
      USING ERRCODE = '22023';
  END IF;
  IF p_line_kind = 'dish' AND p_drink_category IS NOT NULL THEN
    RAISE EXCEPTION 'A dish has no drink category. Nothing was changed.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_s FROM public.menu_sections
   WHERE id = p_section_id AND restaurant_id = p_restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_menu_section: no section % in house %; nothing was changed', p_section_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;
  SELECT status INTO v_status FROM public.restaurant_menus
   WHERE id = v_s.menu_id AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Whether a section is drinks or dishes changes what reaches the stock, so it is decided in a review, not on a live or kept menu. Nothing was changed.'
      USING ERRCODE = '55000';
  END IF;

  SELECT coalesce(array_agg(x.id ORDER BY x.id) FILTER (WHERE x.agrees), '{}'),
         coalesce(array_agg(x.id ORDER BY x.id) FILTER (WHERE NOT x.agrees), '{}')
    INTO v_applied, v_left
    FROM (
      SELECT mi.id,
             (mi.line_kind IS NULL OR mi.line_kind = p_line_kind)
             AND NOT (p_line_kind = 'dish' AND mi.line_kind IS NULL
                      AND mi.bottle_price IS NOT NULL AND mi.by_glass_price IS NOT NULL) AS agrees
        FROM public.menu_items mi
        JOIN public.menu_sections t ON t.id = mi.section_id
       WHERE mi.menu_id = v_s.menu_id
         AND mi.restaurant_id = p_restaurant_id
         AND mi.status IS DISTINCT FROM 'discarded'
         AND (t.id = v_s.id OR left(t.key, length(v_s.key) + 1) = v_s.key || '/')
    ) x;

  IF p_line_kind = 'dish' THEN
    UPDATE public.menu_items mi
       SET line_kind = 'dish',
           price = coalesce(mi.price, mi.bottle_price, mi.by_glass_price),
           bottle_price = NULL,
           by_glass_price = NULL,
           drink_category = NULL,
           category = NULL,
           kind_flag = NULL
     WHERE mi.id = ANY (v_applied) AND mi.restaurant_id = p_restaurant_id;
  ELSE
    UPDATE public.menu_items mi
       SET line_kind = 'drink',
           kind_flag = NULL
     WHERE mi.id = ANY (v_applied) AND mi.restaurant_id = p_restaurant_id;
  END IF;

  UPDATE public.menu_sections
     SET confirmed_by = p_actor,
         confirmed_at = v_at,
         drink_category = CASE
           WHEN p_line_kind = 'dish' THEN NULL
           ELSE coalesce(p_drink_category, drink_category)
         END
   WHERE id = p_section_id AND restaurant_id = p_restaurant_id;

  INSERT INTO public.menu_section_changes (restaurant_id, menu_id, section_id, actor, action, before, after)
  VALUES (p_restaurant_id, v_s.menu_id, p_section_id, p_actor, 'confirm',
          jsonb_build_object('drink_category', v_s.drink_category, 'confirmed_at', v_s.confirmed_at),
          jsonb_build_object('line_kind', p_line_kind,
                             'drink_category', CASE WHEN p_line_kind = 'dish' THEN NULL
                                                    ELSE coalesce(p_drink_category, v_s.drink_category) END,
                             'applied', cardinality(v_applied), 'left', cardinality(v_left)));

  RETURN jsonb_build_object('id', p_section_id, 'menu_id', v_s.menu_id, 'line_kind', p_line_kind,
                            'applied_line_ids', to_jsonb(v_applied), 'left_line_ids', to_jsonb(v_left));
END
$$;

-- ---------------------------------------------------------------------------
-- 8. The owner's tap on one line.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_menu_line(
  p_restaurant_id  uuid,
  p_line_id        uuid,
  p_line_kind      text,
  p_drink_category text,
  p_actor          uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_l      record;
  v_status text;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'confirm_menu_line: a confirmation names the person who made it (actor is NULL); nothing was changed'
      USING ERRCODE = '22023';
  END IF;
  IF p_line_kind IS NULL OR p_line_kind NOT IN ('drink', 'dish') THEN
    RAISE EXCEPTION 'A line is confirmed as a drink or as a dish. Nothing was changed.'
      USING ERRCODE = '22023';
  END IF;
  IF p_line_kind = 'dish' AND p_drink_category IS NOT NULL THEN
    RAISE EXCEPTION 'A dish has no drink category. Nothing was changed.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_l FROM public.menu_items
   WHERE id = p_line_id AND restaurant_id = p_restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_menu_line: no line % in house %; nothing was changed', p_line_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;
  SELECT status INTO v_status FROM public.restaurant_menus
   WHERE id = v_l.menu_id AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Whether a line is a drink or a dish changes what reaches the stock, so it is decided in a review, not on a live or kept menu. Nothing was changed.'
      USING ERRCODE = '55000';
  END IF;
  IF p_line_kind = 'dish' AND v_l.price IS NULL
     AND v_l.bottle_price IS NOT NULL AND v_l.by_glass_price IS NOT NULL THEN
    RAISE EXCEPTION 'This line has a bottle and a glass price; a dish has one price. Clear one of them first. Nothing was changed.'
      USING ERRCODE = '22023';
  END IF;

  IF p_line_kind = 'dish' THEN
    UPDATE public.menu_items
       SET line_kind = 'dish',
           price = coalesce(price, bottle_price, by_glass_price),
           bottle_price = NULL, by_glass_price = NULL,
           drink_category = NULL, category = NULL, kind_flag = NULL
     WHERE id = p_line_id AND restaurant_id = p_restaurant_id;
  ELSE
    UPDATE public.menu_items
       SET line_kind = 'drink',
           -- A dish told it is a drink keeps its one price as the bottle's.
           bottle_price = CASE WHEN line_kind = 'dish' THEN coalesce(bottle_price, price) ELSE bottle_price END,
           price = NULL,
           drink_category = coalesce(p_drink_category, drink_category),
           category = coalesce(p_drink_category, category),
           kind_flag = NULL
     WHERE id = p_line_id AND restaurant_id = p_restaurant_id;
  END IF;

  INSERT INTO public.menu_section_changes (restaurant_id, menu_id, section_id, actor, action, before, after)
  VALUES (p_restaurant_id, v_l.menu_id, v_l.section_id, p_actor, 'confirm',
          jsonb_build_object('line_id', p_line_id, 'line_kind', v_l.line_kind,
                             'drink_category', v_l.drink_category),
          jsonb_build_object('line_id', p_line_id, 'line_kind', p_line_kind,
                             'drink_category', CASE WHEN p_line_kind = 'dish' THEN NULL
                                                    ELSE coalesce(p_drink_category, v_l.drink_category) END));

  RETURN jsonb_build_object('line_id', p_line_id, 'menu_id', v_l.menu_id, 'line_kind', p_line_kind,
                            'drink_category', CASE WHEN p_line_kind = 'dish' THEN NULL
                                                   ELSE coalesce(p_drink_category, v_l.drink_category) END);
END
$$;

-- ---------------------------------------------------------------------------
-- 9. Lines into a section, or Unsorted (drafts only).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_menu_lines(
  p_restaurant_id uuid,
  p_menu_id       uuid,
  p_section_id    uuid,
  p_line_ids      uuid[],
  p_actor         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_found  integer;
  v_before jsonb;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'assign_menu_lines: a move names the person who made it (actor is NULL); nothing was changed'
      USING ERRCODE = '22023';
  END IF;
  IF p_line_ids IS NULL OR cardinality(p_line_ids) = 0 OR array_position(p_line_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'assign_menu_lines: no line, or an empty line id, was named; nothing was changed'
      USING ERRCODE = '22023';
  END IF;

  SELECT status INTO v_status FROM public.restaurant_menus
   WHERE id = p_menu_id AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assign_menu_lines: no menu % in house %; nothing was changed', p_menu_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'A line''s section decides the drink category it inherits, so lines are moved between sections in a review, not on a live or kept menu. Nothing was changed.'
      USING ERRCODE = '55000';
  END IF;
  IF p_section_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.menu_sections
                      WHERE id = p_section_id AND menu_id = p_menu_id
                        AND restaurant_id = p_restaurant_id) THEN
    RAISE EXCEPTION 'assign_menu_lines: no section % on menu %; nothing was changed', p_section_id, p_menu_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT count(DISTINCT id),
         coalesce(jsonb_agg(jsonb_build_object('line_id', id, 'section_id', section_id) ORDER BY id), '[]'::jsonb)
    INTO v_found, v_before
    FROM public.menu_items
   WHERE id = ANY (p_line_ids) AND menu_id = p_menu_id AND restaurant_id = p_restaurant_id;
  IF v_found <> (SELECT count(DISTINCT x) FROM unnest(p_line_ids) AS x) THEN
    RAISE EXCEPTION 'assign_menu_lines: a named line is not on menu %; nothing was changed', p_menu_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.menu_items SET section_id = p_section_id
   WHERE id = ANY (p_line_ids) AND menu_id = p_menu_id AND restaurant_id = p_restaurant_id;

  INSERT INTO public.menu_section_changes (restaurant_id, menu_id, section_id, actor, action, before, after)
  VALUES (p_restaurant_id, p_menu_id, p_section_id, p_actor, 'assign',
          jsonb_build_object('lines', v_before),
          jsonb_build_object('section_id', p_section_id, 'line_ids', to_jsonb(p_line_ids)));

  RETURN jsonb_build_object('menu_id', p_menu_id, 'section_id', p_section_id,
                            'line_ids', to_jsonb(p_line_ids));
END
$$;

-- ---------------------------------------------------------------------------
-- 10. Keep a Gone line: the live line, copied into the draft.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.keep_gone_menu_line(
  p_restaurant_id uuid,
  p_menu_id       uuid,
  p_line_id       uuid,
  p_actor         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_draft    record;
  v_l        record;
  v_live     record;
  v_src      record;
  v_parent   uuid := NULL;
  v_section  uuid := NULL;
  v_found    uuid;
  v_position integer;
  v_new      uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'keep_gone_menu_line: keeping a line names the person who kept it (actor is NULL); nothing was changed'
      USING ERRCODE = '22023';
  END IF;

  SELECT id, status, menu_type INTO v_draft FROM public.restaurant_menus
   WHERE id = p_menu_id AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'keep_gone_menu_line: no menu % in house %; nothing was changed', p_menu_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_draft.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'A line is kept into a menu in review, not into a live or kept one. Nothing was changed.'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_l FROM public.menu_items
   WHERE id = p_line_id AND restaurant_id = p_restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'keep_gone_menu_line: no line % in house %; nothing was changed', p_line_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;
  SELECT id, status, menu_type INTO v_live FROM public.restaurant_menus
   WHERE id = v_l.menu_id AND restaurant_id = p_restaurant_id;
  IF v_live.status IS DISTINCT FROM 'active' OR v_live.menu_type IS DISTINCT FROM v_draft.menu_type
     OR v_l.status = 'discarded' THEN
    RAISE EXCEPTION 'Only a line on the house''s live menu of the same kind can be kept into this review. Nothing was changed.'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.menu_items d
              WHERE d.menu_id = p_menu_id AND d.restaurant_id = p_restaurant_id
                AND d.status IS DISTINCT FROM 'discarded'
                AND ((v_l.wine_library_id IS NOT NULL AND d.wine_library_id = v_l.wine_library_id)
                     OR (lower(btrim(d.name)) = lower(btrim(v_l.name))
                         AND lower(btrim(coalesce(d.producer, ''))) = lower(btrim(coalesce(v_l.producer, '')))
                         AND coalesce(d.vintage, '') = coalesce(v_l.vintage, '')))) THEN
    RAISE EXCEPTION 'This menu in review already has that line. Nothing was changed.'
      USING ERRCODE = '23505';
  END IF;

  -- The live line's section path, top first, found by key on the draft or
  -- made there.
  IF v_l.section_id IS NOT NULL THEN
    FOR v_src IN
      WITH RECURSIVE up(id, parent_id, title, key, drink_category, lvl) AS (
        SELECT id, parent_id, title, key, drink_category, 1
          FROM public.menu_sections WHERE id = v_l.section_id AND restaurant_id = p_restaurant_id
        UNION ALL
        SELECT p.id, p.parent_id, p.title, p.key, p.drink_category, u.lvl + 1
          FROM public.menu_sections p JOIN up u ON p.id = u.parent_id WHERE u.lvl < 4
      )
      SELECT * FROM up ORDER BY lvl DESC
    LOOP
      SELECT id INTO v_found FROM public.menu_sections
       WHERE menu_id = p_menu_id AND restaurant_id = p_restaurant_id AND key = v_src.key;
      IF v_found IS NULL THEN
        SELECT coalesce(max(position) + 1, 0) INTO v_position
          FROM public.menu_sections
         WHERE menu_id = p_menu_id AND parent_id IS NOT DISTINCT FROM v_parent;
        INSERT INTO public.menu_sections
          (restaurant_id, menu_id, parent_id, position, title, title_as_read, key,
           drink_category, inherited_from_section_id)
        VALUES (p_restaurant_id, p_menu_id, v_parent, v_position, v_src.title, NULL, v_src.key,
                v_src.drink_category, v_src.id)
        RETURNING id INTO v_found;
        INSERT INTO public.menu_section_changes (restaurant_id, menu_id, section_id, actor, action, before, after)
        VALUES (p_restaurant_id, p_menu_id, v_found, p_actor, 'create', NULL,
                jsonb_build_object('parent_id', v_parent, 'position', v_position, 'title', v_src.title,
                                   'key', v_src.key, 'drink_category', v_src.drink_category,
                                   'inherited_from_section_id', v_src.id, 'source', 'keep'));
      END IF;
      v_parent := v_found;
      v_found := NULL;
    END LOOP;
    v_section := v_parent;
  END IF;

  INSERT INTO public.menu_items
    (menu_id, restaurant_id, name, producer, category, by_glass_price, bottle_price, vintage,
     region, country, grape_variety, wine_library_id, source, status, section_id,
     line_kind, drink_category, price)
  VALUES
    (p_menu_id, p_restaurant_id, v_l.name, v_l.producer, v_l.category, v_l.by_glass_price,
     v_l.bottle_price, v_l.vintage, v_l.region, v_l.country, v_l.grape_variety,
     v_l.wine_library_id, 'manual', 'approved', v_section,
     v_l.line_kind, v_l.drink_category, v_l.price)
  RETURNING id INTO v_new;

  INSERT INTO public.menu_section_changes (restaurant_id, menu_id, section_id, actor, action, before, after)
  VALUES (p_restaurant_id, p_menu_id, v_section, p_actor, 'keep',
          jsonb_build_object('line_id', p_line_id, 'menu_id', v_l.menu_id),
          jsonb_build_object('line_id', v_new, 'section_id', v_section));

  RETURN jsonb_build_object('line_id', v_new, 'menu_id', p_menu_id, 'section_id', v_section,
                            'kept_from_line_id', p_line_id);
END
$$;

-- ---------------------------------------------------------------------------
-- Grants: the gateway's service role only.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.materialise_menu_sections(uuid, uuid, uuid)',
    'public.rename_menu_section(uuid, uuid, text, uuid)',
    'public.reparent_menu_section(uuid, uuid, uuid, uuid)',
    'public.delete_menu_section(uuid, uuid, uuid)',
    'public.move_menu_section_to_kind(uuid, uuid, text, uuid)',
    'public.set_menu_section_category(uuid, uuid, text, uuid)',
    'public.confirm_menu_section(uuid, uuid, text, text, uuid)',
    'public.confirm_menu_line(uuid, uuid, text, text, uuid)',
    'public.assign_menu_lines(uuid, uuid, uuid, uuid[], uuid)',
    'public.keep_gone_menu_line(uuid, uuid, uuid, uuid)'] LOOP
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
  END LOOP;
END
$$;
