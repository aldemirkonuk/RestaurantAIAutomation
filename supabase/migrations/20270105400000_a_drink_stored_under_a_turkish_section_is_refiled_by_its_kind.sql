-- A DRINK STORED UNDER A TURKISH SECTION IS REFILED BY ITS KIND. F-1314
-- (sim S195; the founder approved this data migration in chat, 2026-10-11).
--
-- WHAT BROKE. Until F-1293 the menu import sent a Turkish section as written
-- ("Rakı", "Bira", "Kırmızı Şaraplar") to the library resolver, which stores
-- it as master_wine_library.data_enrichment.menu_category. The classifier,
-- wine_classify_beverage_kind() (20260817060000_beverage_kind_classification
-- .sql), reads English words only, so those rows got beverage_kind 'unknown',
-- and set_house_item_identity() (20270103900000) files an unknown library row
-- as a wine house item. F-1293 fixed new imports (menu-line-view.ts,
-- menuCategoryOf / DRINK_WORD_KINDS); the rows stored before it stayed wrong.
--
-- THE CHANGE. menu_kind_of_turkish_section() reads a stored section with the
-- import's own vocabulary (DRINK_WORD_KINDS, and FOOD_NOUNS from F-1317 so
-- "Kırmızı Et" is meat, not red wine). refile_drinks_by_their_turkish_section()
-- rewrites menu_category to the kind it names, keeps the heading as written
-- in menu_category_as_written, and lets trg_wine_beverage_kind recompute
-- beverage_kind. House items linked to a refiled row whose kind the trigger
-- or the backfill chose ('wine_library', 'backfill') take the new kind, as
-- 20270103900000's backfill did; a kind a person declared is left alone.
--
-- ONLY UNAMBIGUOUS ROWS. A row is touched only when it is still 'unknown',
-- its section names no food, and every Turkish drink word in it names the
-- same kind. "Beyaz ve Roze" (two kinds) and "Kırmızı Et" stay as they are and
-- are counted in the notice. Nothing is deleted. Idempotent: a refiled row
-- is no longer 'unknown', and its menu_category is now an English word the
-- reader does not match, so a second run changes nothing.
--
-- The two word lists below must stay the gateway's DRINK_WORD_KINDS and
-- FOOD_NOUNS (apps/api-gateway/src/menus/menu-line-view.ts);
-- refile-turkish-sections.spec.ts parses this file and holds them equal.

CREATE OR REPLACE FUNCTION public.menu_kind_of_turkish_section(p_section text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  WITH runs AS (
    -- The section as whole words, once per lower-casing, as the import's
    -- wordRuns(): "RAKI" is "rakı" only the Turkish way. Turkish capitals are
    -- folded by hand so the database's collation does not decide.
    SELECT ' ' || btrim(regexp_replace(
             lower(translate(coalesce(p_section, ''), x.f, x.t)),
             '[^a-zà-ÿçğıöşüâîû]+', ' ', 'g')) || ' ' AS run
    FROM (VALUES ('IİÇĞÖŞÜ', 'ıiçğöşü'), ('İÇĞÖŞÜ', 'içğöşü')) AS x(f, t)
  ),
  drink_word_kinds(word, kind) AS (
    VALUES
      ('tatlı şarap', 'dessert'),
      ('kırmızı', 'red'),
      ('beyaz', 'white'),
      ('roze', 'rose'),
      ('pembe', 'rose'),
      ('köpüklü', 'sparkling'),
      ('rakı', 'spirit'),
      ('bira', 'beer'),
      ('biralar', 'beer'),
      ('viski', 'whiskey'),
      ('kokteyl', 'cocktail'),
      ('kokteyller', 'cocktail'),
      ('alkolsüz', 'non-alcoholic')
  ),
  food_nouns(word) AS (
    VALUES
      ('et'), ('etler'), ('yemek'), ('yemekler'), ('yemekleri'), ('tavuk'),
      ('balık'), ('balıklar'), ('köfte'), ('kebap'), ('kebaplar'), ('meze'),
      ('mezeler'), ('salata'), ('salatalar'), ('çorba'), ('çorbalar'),
      ('ızgara'), ('ızgaralar')
  ),
  kinds AS (
    SELECT DISTINCT d.kind
    FROM drink_word_kinds d, runs r
    WHERE position(' ' || d.word || ' ' IN r.run) > 0
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM food_nouns f, runs r
                 WHERE position(' ' || f.word || ' ' IN r.run) > 0) THEN NULL
    WHEN (SELECT count(*) FROM kinds) = 1 THEN (SELECT kind FROM kinds)
    ELSE NULL
  END;
$function$;

COMMENT ON FUNCTION public.menu_kind_of_turkish_section(text) IS
  'The MENU_CATEGORY_VOCABULARY member a Turkish menu section names, by the '
  'import''s DRINK_WORD_KINDS (F-1293); NULL when it names food (FOOD_NOUNS, '
  'F-1317), no drink word, or two different kinds. F-1314.';

CREATE OR REPLACE FUNCTION public.refile_drinks_by_their_turkish_section()
RETURNS TABLE(library_rows integer, house_items integer, left_unknown integer)
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  WITH candidates AS (
    SELECT w.id,
           public.menu_kind_of_turkish_section(w.data_enrichment ->> 'menu_category') AS kind
    FROM public.master_wine_library w
    WHERE w.beverage_kind = 'unknown'
      AND coalesce(btrim(w.data_enrichment ->> 'menu_category'), '') <> ''
  ),
  refiled AS (
    UPDATE public.master_wine_library w
       SET data_enrichment = w.data_enrichment || jsonb_build_object(
             'menu_category', c.kind,
             'menu_category_as_written',
             coalesce(w.data_enrichment -> 'menu_category_as_written',
                      w.data_enrichment -> 'menu_category'))
      FROM candidates c
     WHERE c.id = w.id
       AND c.kind IS NOT NULL
    RETURNING w.id
  )
  SELECT coalesce(array_agg(id), '{}') INTO v_ids FROM refiled;
  library_rows := cardinality(v_ids);

  UPDATE public.restaurant_inventory ri
     SET kind = w.beverage_kind
    FROM public.master_wine_library w
   WHERE w.id = ri.master_wine_id
     AND w.id = ANY (v_ids)
     AND ri.kind = 'wine'
     AND ri.identity_provenance IN ('wine_library', 'backfill')
     AND w.beverage_kind IN ('beer', 'spirit', 'sake', 'cider',
                             'cocktail', 'non_alcoholic');
  GET DIAGNOSTICS house_items = ROW_COUNT;

  SELECT count(*)::integer INTO left_unknown
    FROM public.master_wine_library w
   WHERE w.beverage_kind = 'unknown'
     AND coalesce(btrim(w.data_enrichment ->> 'menu_category'), '') <> '';

  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.refile_drinks_by_their_turkish_section() IS
  'F-1314: refiles library rows still ''unknown'' under a Turkish section by '
  'the kind it names (menu_kind_of_turkish_section), keeps the heading in '
  'data_enrichment.menu_category_as_written, and moves their trigger-filed '
  'house items to that kind. Idempotent; deletes nothing. Returns the counts.';

REVOKE ALL ON FUNCTION public.refile_drinks_by_their_turkish_section() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refile_drinks_by_their_turkish_section() FROM anon, authenticated;

DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.refile_drinks_by_their_turkish_section();
  RAISE NOTICE 'F-1314 refile: % library row(s) refiled, % house item(s) moved off wine, % row(s) with a section still unknown',
    r.library_rows, r.house_items, r.left_unknown;
END
$$;
