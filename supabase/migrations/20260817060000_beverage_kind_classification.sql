-- Plan §2.0 / arch §6 (register A4): `is_wine` conflates "not a wine" with
-- "the model could not classify it". load_enriched_wines.py:212 sets
-- is_wine = bool(primary_type) -- computes ENRICHMENT SUCCESS, not
-- classification. Proof: every is_wine=false row carries
-- primary_type='unknown', without exception, at every count taken during
-- this build (202, then 671 after further concurrent enrichment activity
-- moved rows in this live, shared database -- the mechanism is what's
-- wrong, not a fixed row count, which is why this fix is a classifier, not
-- a one-time correction of specific rows). Freshly measured before this
-- migration: 8 real wines are mistagged is_wine=false today (BonAnno, Duc
-- des Nauves, Felsina Vin Santo Chianti Classico, Frank Family Vineyards,
-- Heitz Cellar, Ink Grade, My Favorite Neighbor, Renaissance Vineyard --
-- Vin Santo is the eighth, not caught by an earlier "7" count taken before
-- this data moved).
--
-- Fix: replace the one overloaded boolean with two separate facts, neither
-- of which application code sets directly -- both computed by a trigger
-- from data actually present on the row, same posture as
-- enrichment_observed_at (20260817010000) and identity_status
-- (20260817030000) before this. is_wine itself is left in place inside
-- data_enrichment (untouched, for backward read compatibility) but MUST
-- NOT be used as a migration predicate ever again -- beverage_kind is that
-- predicate now.
--
-- classification_status: did enrichment produce anything at all.
-- beverage_kind: what the wine/beverage actually IS, decided by precedence
--   1. primary_type, if it is a real wine style (never 'unknown'/blank) --
--      primary_type has only ever held wine-style values in this schema
--      (red/white/rose/sparkling/orange/fortified/dessert), so a real value
--      here is authoritative and wins over everything else.
--   2. the menu's OWN section header (menu_category) -- restaurant-authored
--      ground truth, present on every corpus row, and exactly the signal
--      that catches the 8 mistags: a row filed under "red" with no
--      primary_type is still a red wine as far as the menu is concerned.
--   3. unknown -- honest, not a guess.

ALTER TABLE public.master_wine_library
  ADD COLUMN IF NOT EXISTS classification_status text NOT NULL DEFAULT 'unclassified'
    CHECK (classification_status IN ('classified', 'unclassified')),
  ADD COLUMN IF NOT EXISTS beverage_kind text NOT NULL DEFAULT 'unknown'
    CHECK (beverage_kind IN (
      'wine', 'beer', 'spirit', 'sake', 'cider', 'cocktail',
      'non_alcoholic', 'unknown'
    ));

COMMENT ON COLUMN public.master_wine_library.classification_status IS
  'classified: enrichment produced a usable primary_type OR the menu''s own '
  'section header was recognisable. unclassified: neither. Separate from '
  'beverage_kind on purpose -- is_wine conflated "not a wine" with "could '
  'not classify", which is the exact bug this pair exists to split apart.';
COMMENT ON COLUMN public.master_wine_library.beverage_kind IS
  'What this row actually is, by precedence: real primary_type > menu''s '
  'own section header > unknown. THE migration predicate for moving rows '
  'to beverages (plan §2) -- is_wine (inside data_enrichment) must never be '
  'used for that again; it is a null-flag wearing a classification''s name '
  '(arch §6). Auto-maintained by trg_wine_beverage_kind, never set by '
  'application code.';

CREATE OR REPLACE FUNCTION public.wine_classify_beverage_kind(
  p_primary_type  text,
  p_menu_category text
)
RETURNS TABLE(kind text, status text)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  WITH pt AS (
    SELECT lower(btrim(coalesce(p_primary_type, ''))) AS v
  ),
  mc AS (
    -- Parens are literal characters in some source strings ("whisk(e)y"),
    -- not regex groups -- stripped before matching so a keyword regex can't
    -- be defeated by punctuation the extractor happened to keep.
    SELECT regexp_replace(lower(btrim(coalesce(p_menu_category, ''))), '[()]', '', 'g') AS v
  )
  SELECT
    CASE
      -- 1. A real primary_type. primary_type has only ever held wine-style
      -- values in this schema (red/white/rose/sparkling/orange/fortified/
      -- dessert) -- never 'beer' or 'spirit' -- so any non-empty,
      -- non-'unknown' value here means wine, unconditionally.
      WHEN pt.v <> '' AND pt.v <> 'unknown' THEN 'wine'

      -- 2. The menu's own section header. Ordered most-specific-first where
      -- two patterns could both match (e.g. a "spirit-free cocktail"
      -- section matches both \mcocktail\M and \mspirit\M -- cocktail wins
      -- because it is checked first).
      WHEN mc.v ~ '\m(sake|junmai|ginjo|daiginjo|honjozo)\M' THEN 'sake'
      WHEN mc.v ~ '\m(beer|birra|lager|pilsner|ipa|ale|stout|porter|hefeweizen)\M' THEN 'beer'
      WHEN mc.v ~ '\mcider\M' THEN 'cider'
      WHEN mc.v ~ '\m(cocktail|cocktails)\M' THEN 'cocktail'
      WHEN mc.v ~ '\m(zero.?proof|spirit.?free|non.?alcoholic|nonalcoholic|na)\M' THEN 'non_alcoholic'
      WHEN mc.v ~ ('\m(whiskeys?|whiskys?|whiskies|scotch|bourbon|rye|tequila|mezcal|' ||
                    'agave|vodka|gin|rum|brandy|cognac|armagnac|grappa|calvados|arak|' ||
                    'cane|amari|amaro|cordials?|liqueurs?|digestifs?|digestivi|' ||
                    'apertivi|aperitifs?|vermouth|spirits?)\M') THEN 'spirit'
      WHEN mc.v ~ ('\m(red|white|ros[eé]|sparkling|champagne|orange|dessert|' ||
                    'fortified|port|blend|pinot|cabernet|chardonnay|sauvignon|' ||
                    'zinfandel|merlot|shiraz|syrah|sherry)\M') THEN 'wine'
      ELSE 'unknown'
    END AS kind,
    CASE
      WHEN (pt.v <> '' AND pt.v <> 'unknown') OR mc.v <> '' THEN 'classified'
      ELSE 'unclassified'
    END AS status
  FROM pt, mc;
$function$;

COMMENT ON FUNCTION public.wine_classify_beverage_kind IS
  'Precedence classifier: real primary_type > the menu''s own section '
  'header > unknown. See beverage_kind''s column comment. Pure function, '
  'no table access -- safe to call from a trigger or a one-off query alike.';

CREATE OR REPLACE FUNCTION public.set_wine_beverage_kind()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.wine_classify_beverage_kind(
    NEW.primary_type, NEW.data_enrichment ->> 'menu_category'
  );
  NEW.beverage_kind := r.kind;
  NEW.classification_status := r.status;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_wine_beverage_kind() IS
  'Auto-maintains beverage_kind/classification_status on every insert or '
  'update from primary_type and data_enrichment->menu_category, so they '
  'can never drift out of sync with the columns they are computed from -- '
  'same posture as trg_wine_identity_status and '
  'trg_wine_enrichment_observed_at.';

DROP TRIGGER IF EXISTS trg_wine_beverage_kind ON public.master_wine_library;
CREATE TRIGGER trg_wine_beverage_kind
  BEFORE INSERT OR UPDATE ON public.master_wine_library
  FOR EACH ROW
  EXECUTE FUNCTION public.set_wine_beverage_kind();

-- Backfill: every live row needs beverage_kind computed once. Unlike the
-- identity_status backfill (targeted, ~334 of 4,160), every row's
-- beverage_kind changes from the DEFAULT ('unknown') to a real computed
-- value here, so touching all of them is correct, not collateral damage --
-- same reasoning as the display_name column backfill.
UPDATE public.master_wine_library
   SET updated_at = updated_at
 WHERE deleted_at IS NULL;
