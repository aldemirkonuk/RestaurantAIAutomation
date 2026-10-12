-- A MENU KEEPS THE HOUSE'S OWN SECTIONS (ADR 0340 rules 6, 7, 10, 11; founder
-- answer S208 items 2 and 5).
--
-- Until now a "section" was the free text menu_items.category: no id, no
-- order, no nesting, and the same column fed the closed drink vocabulary
-- (ADR 0186) and, through the resolver, the shared library (ADR 0333). This
-- file gives a menu its own sections and lets a line say what it is.
--
-- WHAT THIS FILE DOES
-- 1. public.menu_section_key_part(text): the normalised slug of one heading
--    (btrim; every dotted/dotless i folded to 'i', so "KIRMIZI", "Kırmızı"
--    and "kirmizi" agree; lower(); only letters and digits kept). A key is
--    the parent's key + '/' + this, so "Glass" under Red and under White
--    differ. "Red" and "red " are one key.
-- 2. public.menu_sections (rule 6): id, house, menu, parent, position, the
--    house's title (renamable), title_as_read (the printed heading; NULL for
--    a back-filled section; never changed once written), key, drink_category
--    (the 0186 vocabulary, NULL = inherit or not a drink section; the lines'
--    line_kind decides which), the AI suggestion fields, the owner's tap
--    (confirmed_by -> users ON DELETE SET NULL; the change log is the audit
--    record) and timestamps. Integrity:
--      * same house: (menu_id, restaurant_id) -> restaurant_menus(id,
--        restaurant_id) ON DELETE CASCADE;
--      * same menu as the parent: (menu_id, parent_id) -> menu_sections
--        (menu_id, id), ON UPDATE CASCADE (a moved section takes its
--        children with it);
--      * no cycle and at most three levels (Wines > Red > Turkey; ADR 0340
--        F2), by a BEFORE trigger that walks the parents and measures the
--        subtree below the row;
--      * UNIQUE (menu_id, key);
--      * UNIQUE NULLS NOT DISTINCT (menu_id, parent_id, position) DEFERRABLE
--        INITIALLY DEFERRED, so a reorder may swap positions inside one
--        transaction (add_menu_section / reorder_menu_sections compute them).
-- 3. A section moves to another menu only between drafts of one upload
--    (rule 10). A BEFORE UPDATE OF menu_id trigger first locks the house row
--    (the lock make_menu_current takes, so a make-live cannot activate the
--    target in between), refuses unless both menus are drafts of the same
--    house and the same read_together_id, and for the moved section itself
--    sets parent_id NULL, position to the end of the target's top level and
--    key to its own last segment. Its child sections and lines follow by
--    ON UPDATE CASCADE; a child keeps its parent and position and its key is
--    re-prefixed with the parent's new key. A key already used on the
--    target menu is refused by UNIQUE (menu_id, key) (23505).
-- 4. public.menu_section_changes (rule 6): one row per create, rename,
--    reorder, reparent, move, category edit, confirm and delete, with the
--    actor (-> users ON DELETE RESTRICT, so the account-delete pre-check
--    names it) and before/after jsonb. An UPDATE is refused by trigger. A
--    DELETE is not: a house's own hard delete cascades its log, and the sim
--    teardown deletes sim houses' rows (scripts/synth/teardown.py).
-- 5. New menu_items columns (rule 7): section_id ((menu_id, section_id) ->
--    menu_sections(menu_id, id); ON UPDATE CASCADE; ON DELETE SET NULL
--    (section_id) only, so a deleted section's lines go to Unsorted and keep
--    their menu), position, line_kind ('drink' | 'dish' | NULL = legacy or
--    undecided), drink_category (vocabulary; NULL on a dish), price (a
--    DISH's price) and kind_flag. The price CHECKs make the two price shapes
--    exclusive: a dish line has no bottle or glass price, and only a dish
--    line has a price, so no bottle_price reader can read a dish price.
-- 6. RLS on both new tables, ALL revoked from anon and authenticated, no
--    client policy; the gateway uses service_role (OD-72/94).
-- 7. The back-fill (rule 11; ADR 0340 F4: archived menus too). Every menu
--    gets one top-level section per distinct key of its lines' non-blank
--    category. Title: the display words for a vocabulary token (Turkish for
--    a house whose country reads as Turkey, else English), otherwise the most
--    frequent spelling. title_as_read NULL, drink_category = the token when
--    the key is one. Positions follow the lowest spelling, as /menu sorts
--    lines by category today (menus.service.ts:1745-1751). Then EVERY line
--    with such a category gets its section_id (an UPDATE, not insert-only;
--    menu_items has no updated_at trigger). line_kind stays NULL (the legacy
--    rule). A blank category, or one with no letter or digit, stays NULL:
--    Unsorted, never "Other". Nothing is split between kinds.
--
-- Re-runnable: the back-fill only adds a section a menu does not have and
-- only fills a NULL section_id.

-- ---------------------------------------------------------------------------
-- 1. The key of one heading.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.menu_section_key_part(p_heading text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT regexp_replace(lower(translate(btrim(coalesce(p_heading, '')), 'İIı', 'iii')),
                        '[^[:alnum:]]', '', 'g');
$$;

COMMENT ON FUNCTION public.menu_section_key_part(text) IS
  'ADR 0340 rule 6: the normalised slug of one menu heading (trimmed, dotted and dotless i folded to i, lowercased, letters and digits only). A section key is its parent''s key + ''/'' + this. Empty = the heading has no letter or digit.';

REVOKE ALL ON FUNCTION public.menu_section_key_part(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.menu_section_key_part(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.menu_section_key_part(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The sections.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.menu_sections (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id              uuid NOT NULL,
  menu_id                    uuid NOT NULL,
  parent_id                  uuid,
  position                   integer NOT NULL,
  title                      text NOT NULL,
  title_as_read              text,
  key                        text NOT NULL,
  drink_category             text,
  suggested_kind             text,
  suggested_category         text,
  suggestion_confidence      numeric(4,3),
  suggested_by               text,
  inherited_from_section_id  uuid,
  confirmed_by               uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  confirmed_at               timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_sections_menu_is_the_houses
    FOREIGN KEY (menu_id, restaurant_id)
    REFERENCES public.restaurant_menus (id, restaurant_id) ON DELETE CASCADE,
  CONSTRAINT menu_sections_menu_id_id_key UNIQUE (menu_id, id),
  CONSTRAINT menu_sections_id_restaurant_id_key UNIQUE (id, restaurant_id),
  CONSTRAINT menu_sections_parent_is_on_the_same_menu
    FOREIGN KEY (menu_id, parent_id)
    REFERENCES public.menu_sections (menu_id, id) ON UPDATE CASCADE,
  CONSTRAINT menu_sections_inherited_from_the_same_house
    FOREIGN KEY (inherited_from_section_id, restaurant_id)
    REFERENCES public.menu_sections (id, restaurant_id)
    ON DELETE SET NULL (inherited_from_section_id),
  CONSTRAINT menu_sections_menu_id_key_key UNIQUE (menu_id, key),
  CONSTRAINT menu_sections_one_section_per_place
    UNIQUE NULLS NOT DISTINCT (menu_id, parent_id, position)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT menu_sections_position_check CHECK (position >= 0),
  CONSTRAINT menu_sections_title_check CHECK (btrim(title) <> ''),
  CONSTRAINT menu_sections_key_check
    CHECK (key <> '' AND key !~ '^/' AND key !~ '/$' AND key !~ '//'),
  CONSTRAINT menu_sections_not_its_own_parent CHECK (parent_id IS DISTINCT FROM id),
  CONSTRAINT menu_sections_drink_category_check CHECK (
    drink_category IS NULL OR drink_category IN (
      'red', 'white', 'rose', 'sparkling', 'orange', 'dessert', 'fortified', 'beer',
      'cider', 'sake', 'cocktail', 'spirit', 'whiskey', 'soft drink', 'non-alcoholic')),
  CONSTRAINT menu_sections_suggested_kind_check CHECK (
    suggested_kind IS NULL OR suggested_kind IN ('beverage', 'food', 'desserts', 'unknown')),
  CONSTRAINT menu_sections_suggested_category_check CHECK (
    suggested_category IS NULL OR suggested_category IN (
      'red', 'white', 'rose', 'sparkling', 'orange', 'dessert', 'fortified', 'beer',
      'cider', 'sake', 'cocktail', 'spirit', 'whiskey', 'soft drink', 'non-alcoholic')),
  CONSTRAINT menu_sections_suggestion_confidence_check CHECK (
    suggestion_confidence IS NULL OR (suggestion_confidence >= 0 AND suggestion_confidence <= 1)),
  CONSTRAINT menu_sections_suggested_by_check CHECK (
    suggested_by IS NULL OR btrim(suggested_by) <> ''),
  CONSTRAINT menu_sections_a_tap_is_dated CHECK (confirmed_by IS NULL OR confirmed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_menu_sections_restaurant
  ON public.menu_sections (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_menu_sections_inherited_from
  ON public.menu_sections (inherited_from_section_id)
  WHERE inherited_from_section_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_menu_sections_confirmed_by
  ON public.menu_sections (confirmed_by)
  WHERE confirmed_by IS NOT NULL;

COMMENT ON TABLE public.menu_sections IS
  'ADR 0340 rule 6: a menu''s own sections, nested at most three levels, in the house''s order. Lines join through menu_items.section_id; NULL there = Unsorted. Written by service_role only.';
COMMENT ON COLUMN public.menu_sections.title_as_read IS
  'The heading as printed on the source, never changed once written. NULL for a section the ADR 0340 back-fill made from menu_items.category, so it never feeds the AI''s feedback signal.';
COMMENT ON COLUMN public.menu_sections.key IS
  'Path-scoped normalised key: the parent''s key + ''/'' + menu_section_key_part(heading). Unique per menu; used to carry a section''s layout to the next upload of the same kind.';
COMMENT ON COLUMN public.menu_sections.drink_category IS
  'ADR 0186 vocabulary token for the drinks under this section. NULL = inherit from the parent, or at the top level not mapped / not a drink section; the lines'' line_kind decides which, never this NULL.';

DROP TRIGGER IF EXISTS menu_sections_updated_at ON public.menu_sections;
CREATE TRIGGER menu_sections_updated_at
  BEFORE UPDATE ON public.menu_sections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 2b. No cycle, at most three levels; the printed heading never changes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.menu_section_keeps_its_shape()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_depth  integer := 1;
  v_parent uuid := NEW.parent_id;
  v_below  integer;
BEGIN
  IF tg_op = 'UPDATE' AND NEW.title_as_read IS DISTINCT FROM OLD.title_as_read THEN
    RAISE EXCEPTION 'menu_sections: the heading as read is kept as it was printed; rename the section''s title instead. Nothing was changed.'
      USING ERRCODE = '23514';
  END IF;

  IF tg_op = 'UPDATE' AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id
     AND NEW.menu_id IS NOT DISTINCT FROM OLD.menu_id THEN
    RETURN NEW;
  END IF;

  WHILE v_parent IS NOT NULL LOOP
    IF v_parent = NEW.id THEN
      RAISE EXCEPTION 'menu_sections: a section cannot sit inside itself or its own subsection. Nothing was changed.'
        USING ERRCODE = '23514';
    END IF;
    v_depth := v_depth + 1;
    IF v_depth > 3 THEN
      RAISE EXCEPTION 'menu_sections: sections nest at most three levels (for example Wines > Red > Turkey). Nothing was changed.'
        USING ERRCODE = '23514';
    END IF;
    SELECT parent_id INTO v_parent FROM public.menu_sections WHERE id = v_parent;
  END LOOP;

  IF tg_op = 'UPDATE' THEN
    WITH RECURSIVE below(id, lvl) AS (
      SELECT s.id, 1 FROM public.menu_sections s WHERE s.parent_id = NEW.id
      UNION ALL
      SELECT s.id, b.lvl + 1
        FROM public.menu_sections s JOIN below b ON s.parent_id = b.id
       WHERE b.lvl < 4
    )
    SELECT coalesce(max(lvl), 0) INTO v_below FROM below;
    IF v_depth + v_below > 3 THEN
      RAISE EXCEPTION 'menu_sections: with its subsections this section would sit deeper than three levels. Nothing was changed.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.menu_section_keeps_its_shape() FROM PUBLIC;

DROP TRIGGER IF EXISTS menu_sections_20_keep_their_shape ON public.menu_sections;
CREATE TRIGGER menu_sections_20_keep_their_shape
  BEFORE INSERT OR UPDATE ON public.menu_sections
  FOR EACH ROW EXECUTE FUNCTION public.menu_section_keeps_its_shape();

-- ---------------------------------------------------------------------------
-- 3. A section moves to another menu only between drafts of one upload.
--    (Named _10_ so it runs before the shape trigger, which then sees the
--    moved section at the target's top level.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.menu_section_moves_only_between_sibling_drafts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from        record;
  v_to          record;
  v_parent_key  text;
BEGIN
  IF NEW.menu_id IS NOT DISTINCT FROM OLD.menu_id THEN
    RETURN NEW;
  END IF;
  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id THEN
    RAISE EXCEPTION 'menu_sections: a section stays in its own house. Nothing was changed.'
      USING ERRCODE = '22023';
  END IF;

  -- The lock make_menu_current takes first: no make-live can activate either
  -- menu between this check and the end of the transaction.
  PERFORM 1 FROM public.restaurants WHERE id = NEW.restaurant_id FOR UPDATE;

  SELECT id, restaurant_id, status, read_together_id INTO v_from
    FROM public.restaurant_menus WHERE id = OLD.menu_id;
  SELECT id, restaurant_id, status, read_together_id INTO v_to
    FROM public.restaurant_menus WHERE id = NEW.menu_id;
  IF v_from.id IS NULL OR v_to.id IS NULL
     OR v_from.restaurant_id IS DISTINCT FROM NEW.restaurant_id
     OR v_to.restaurant_id IS DISTINCT FROM NEW.restaurant_id
     OR v_from.status IS DISTINCT FROM 'draft'
     OR v_to.status IS DISTINCT FROM 'draft'
     OR v_from.read_together_id IS NULL
     OR v_from.read_together_id IS DISTINCT FROM v_to.read_together_id THEN
    RAISE EXCEPTION 'menu_sections: a section moves to another kind only between drafts read together from one upload; a live or archived menu changes through a review. Nothing was changed.'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.parent_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.menu_sections p
                  WHERE p.id = NEW.parent_id AND p.menu_id = NEW.menu_id) THEN
    -- A child carried along by its parent's move (ON UPDATE CASCADE): it
    -- keeps its parent and position, and its key follows the parent's.
    SELECT key INTO v_parent_key FROM public.menu_sections WHERE id = NEW.parent_id;
    NEW.key := v_parent_key || '/' || regexp_replace(OLD.key, '^.*/', '');
  ELSE
    -- The section that was moved: to the end of the target's top level.
    NEW.parent_id := NULL;
    NEW.key := regexp_replace(OLD.key, '^.*/', '');
    SELECT coalesce(max(position) + 1, 0) INTO NEW.position
      FROM public.menu_sections
     WHERE menu_id = NEW.menu_id AND parent_id IS NULL;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.menu_section_moves_only_between_sibling_drafts() FROM PUBLIC;

DROP TRIGGER IF EXISTS menu_sections_10_move_only_between_sibling_drafts ON public.menu_sections;
CREATE TRIGGER menu_sections_10_move_only_between_sibling_drafts
  BEFORE UPDATE OF menu_id ON public.menu_sections
  FOR EACH ROW EXECUTE FUNCTION public.menu_section_moves_only_between_sibling_drafts();

-- ---------------------------------------------------------------------------
-- 4. The change log.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.menu_section_changes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  menu_id        uuid NOT NULL,
  section_id     uuid,
  actor          uuid NOT NULL REFERENCES public.users(user_id) ON DELETE RESTRICT,
  at             timestamptz NOT NULL DEFAULT now(),
  action         text NOT NULL,
  before         jsonb,
  after          jsonb,
  CONSTRAINT menu_section_changes_action_check CHECK (action IN (
    'create', 'rename', 'reorder', 'reparent', 'move', 'category', 'confirm', 'delete'))
);

CREATE INDEX IF NOT EXISTS idx_menu_section_changes_house_at
  ON public.menu_section_changes (restaurant_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_menu_section_changes_menu
  ON public.menu_section_changes (menu_id);
CREATE INDEX IF NOT EXISTS idx_menu_section_changes_actor
  ON public.menu_section_changes (actor);

COMMENT ON TABLE public.menu_section_changes IS
  'ADR 0340 rule 6: one row per create, rename, reorder, reparent, move, category edit, confirm and delete of a menu section, with who and before/after. menu_id and section_id carry no FK, so the row outlives a discarded draft. UPDATE is refused by trigger; DELETE is left to the house''s own hard delete and the sim teardown.';

CREATE OR REPLACE FUNCTION public.menu_section_changes_are_not_rewritten()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'menu_section_changes keeps what was done (ADR 0340): an UPDATE is refused. Record a new change instead.'
    USING ERRCODE = 'restrict_violation';
END
$$;

REVOKE ALL ON FUNCTION public.menu_section_changes_are_not_rewritten() FROM PUBLIC;

DROP TRIGGER IF EXISTS menu_section_changes_not_rewritten ON public.menu_section_changes;
CREATE TRIGGER menu_section_changes_not_rewritten
  BEFORE UPDATE ON public.menu_section_changes
  FOR EACH ROW EXECUTE FUNCTION public.menu_section_changes_are_not_rewritten();

-- ---------------------------------------------------------------------------
-- 5. A line joins a section and says what it is.
-- ---------------------------------------------------------------------------
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS section_id uuid,
  ADD COLUMN IF NOT EXISTS position integer,
  ADD COLUMN IF NOT EXISTS line_kind text,
  ADD COLUMN IF NOT EXISTS drink_category text,
  ADD COLUMN IF NOT EXISTS price numeric(10,2),
  ADD COLUMN IF NOT EXISTS kind_flag text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'menu_items_section_is_on_the_same_menu'
                    AND conrelid = to_regclass('public.menu_items')) THEN
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_section_is_on_the_same_menu
      FOREIGN KEY (menu_id, section_id)
      REFERENCES public.menu_sections (menu_id, id)
      ON UPDATE CASCADE
      ON DELETE SET NULL (section_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'menu_items_line_kind_check'
                    AND conrelid = to_regclass('public.menu_items')) THEN
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_line_kind_check
      CHECK (line_kind IS NULL OR line_kind IN ('drink', 'dish'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'menu_items_drink_category_check'
                    AND conrelid = to_regclass('public.menu_items')) THEN
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_drink_category_check
      CHECK (drink_category IS NULL OR drink_category IN (
        'red', 'white', 'rose', 'sparkling', 'orange', 'dessert', 'fortified', 'beer',
        'cider', 'sake', 'cocktail', 'spirit', 'whiskey', 'soft drink', 'non-alcoholic'));
  END IF;
  -- A dish has no drink category.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'menu_items_a_dish_has_no_drink_category'
                    AND conrelid = to_regclass('public.menu_items')) THEN
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_a_dish_has_no_drink_category
      CHECK (line_kind IS DISTINCT FROM 'dish' OR drink_category IS NULL);
  END IF;
  -- A dish line carries no bottle or glass price ...
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'menu_items_a_dish_has_no_drink_price'
                    AND conrelid = to_regclass('public.menu_items')) THEN
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_a_dish_has_no_drink_price
      CHECK (line_kind IS DISTINCT FROM 'dish' OR (bottle_price IS NULL AND by_glass_price IS NULL));
  END IF;
  -- ... and only a dish line carries a price (so a drink line never does).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'menu_items_only_a_dish_has_a_price'
                    AND conrelid = to_regclass('public.menu_items')) THEN
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_only_a_dish_has_a_price
      CHECK (price IS NULL OR (coalesce(line_kind = 'dish', false) AND price >= 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'menu_items_position_check'
                    AND conrelid = to_regclass('public.menu_items')) THEN
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_position_check
      CHECK (position IS NULL OR position >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'menu_items_kind_flag_says_why'
                    AND conrelid = to_regclass('public.menu_items')) THEN
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_kind_flag_says_why
      CHECK (kind_flag IS NULL OR btrim(kind_flag) <> '');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_menu_items_section
  ON public.menu_items (section_id)
  WHERE section_id IS NOT NULL;

COMMENT ON COLUMN public.menu_items.section_id IS
  'ADR 0340 rule 7: the line''s section on its own menu. NULL = Unsorted.';
COMMENT ON COLUMN public.menu_items.position IS
  'ADR 0340 rule 7: the line''s place in its section. NULL = sorted by name, as before.';
COMMENT ON COLUMN public.menu_items.line_kind IS
  'ADR 0340 rule 7: drink or dish, stored once decided (the owner''s tap, or rules that agree). NULL = a legacy or undecided line: a drink unless the legacy kitchen rule says otherwise, and Unsure on a new read.';
COMMENT ON COLUMN public.menu_items.drink_category IS
  'ADR 0340 rule 7: a per-line ADR 0186 token that overrides the section''s. NULL on a dish.';
COMMENT ON COLUMN public.menu_items.price IS
  'ADR 0340 rule 7 / F20: a DISH''s price. Only a dish line has one, and a dish line has no bottle_price or by_glass_price.';
COMMENT ON COLUMN public.menu_items.kind_flag IS
  'ADR 0340 rule 15: why the rules disagreed about this line''s kind (shown in Unsure). NULL = nothing to say.';

-- ---------------------------------------------------------------------------
-- 6. Locked down: the gateway's service role only.
-- ---------------------------------------------------------------------------
ALTER TABLE public.menu_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_section_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_sections FROM anon, authenticated;
REVOKE ALL ON public.menu_section_changes FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_sections TO service_role;
GRANT SELECT, INSERT, DELETE ON public.menu_section_changes TO service_role;

-- ---------------------------------------------------------------------------
-- 7. The back-fill: today's categories become each menu's sections.
-- ---------------------------------------------------------------------------
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
  SELECT mi.menu_id, m.restaurant_id,
         btrim(mi.category) AS spelling,
         public.menu_section_key_part(mi.category) AS key
    FROM public.menu_items mi
    JOIN public.restaurant_menus m ON m.id = mi.menu_id
   WHERE mi.category IS NOT NULL
     AND public.menu_section_key_part(mi.category) <> ''
),
spellings AS (
  SELECT menu_id, restaurant_id, key, spelling, count(*) AS n
    FROM lines
   GROUP BY menu_id, restaurant_id, key, spelling
),
sections AS (
  SELECT DISTINCT ON (s.menu_id, s.key)
         s.menu_id, s.restaurant_id, s.key,
         s.spelling AS most_used,
         (SELECT min(x.spelling) FROM spellings x
           WHERE x.menu_id = s.menu_id AND x.key = s.key) AS lowest
    FROM spellings s
   ORDER BY s.menu_id, s.key, s.n DESC, s.spelling
),
placed AS (
  SELECT sec.*,
         row_number() OVER (PARTITION BY sec.menu_id
                            ORDER BY lower(sec.lowest), sec.lowest, sec.key) - 1 AS position
    FROM sections sec
)
INSERT INTO public.menu_sections
  (restaurant_id, menu_id, parent_id, position, title, title_as_read, key, drink_category)
SELECT p.restaurant_id, p.menu_id, NULL,
       p.position
         + coalesce((SELECT max(e.position) + 1 FROM public.menu_sections e
                      WHERE e.menu_id = p.menu_id AND e.parent_id IS NULL), 0),
       CASE
         WHEN v.token IS NULL THEN p.most_used
         WHEN lower(btrim(coalesce(r.country, ''))) IN ('tr', 'tur', 'turkey', 'türkiye', 'turkiye')
           THEN v.tr
         ELSE v.en
       END,
       NULL,
       p.key,
       v.token
  FROM placed p
  JOIN public.restaurants r ON r.id = p.restaurant_id
  LEFT JOIN vocabulary v ON public.menu_section_key_part(v.token) = p.key
 WHERE NOT EXISTS (SELECT 1 FROM public.menu_sections e
                    WHERE e.menu_id = p.menu_id AND e.key = p.key);

UPDATE public.menu_items mi
   SET section_id = s.id
  FROM public.menu_sections s
 WHERE s.menu_id = mi.menu_id
   AND s.key = public.menu_section_key_part(mi.category)
   AND mi.section_id IS NULL
   AND mi.category IS NOT NULL
   AND public.menu_section_key_part(mi.category) <> '';

-- ---------------------------------------------------------------------------
-- Assertions: every line with a readable category has its section; no line
-- without one was given a section; the lock-down holds.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.menu_items
              WHERE section_id IS NULL
                AND category IS NOT NULL
                AND public.menu_section_key_part(category) <> '') THEN
    RAISE EXCEPTION 'a_menu_keeps_the_houses_own_sections: a line with a category was left without its section';
  END IF;
  IF EXISTS (SELECT 1 FROM public.menu_items mi
               JOIN public.menu_sections s ON s.id = mi.section_id
              WHERE s.title_as_read IS NULL
                AND s.key IS DISTINCT FROM public.menu_section_key_part(mi.category)) THEN
    RAISE EXCEPTION 'a_menu_keeps_the_houses_own_sections: a back-filled line sits in a section of another category';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.menu_sections'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.menu_section_changes'::regclass) THEN
    RAISE EXCEPTION 'a_menu_keeps_the_houses_own_sections: RLS is off on a new table';
  END IF;
  IF has_table_privilege('anon', 'public.menu_sections', 'SELECT')
     OR has_table_privilege('authenticated', 'public.menu_sections', 'SELECT')
     OR has_table_privilege('anon', 'public.menu_section_changes', 'SELECT')
     OR has_table_privilege('authenticated', 'public.menu_section_changes', 'SELECT') THEN
    RAISE EXCEPTION 'a_menu_keeps_the_houses_own_sections: a client role can read a new table';
  END IF;
END
$$;
