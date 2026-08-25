-- Extend catalogue_items (20260817080000) to include cocktails, now that
-- plan §3's migration has moved them out of master_wine_library. Cocktails
-- have no library_tier/review_status/identity_status -- they are
-- restaurant-scoped recipes, not globally-deduplicated catalogue rows
-- (arch §2, "where scope genuinely is per-restaurant"), so those columns
-- are NULL in this branch rather than fabricated.

CREATE OR REPLACE VIEW public.catalogue_items AS
  SELECT
    id, 'wine'::text AS catalogue_kind, name, display_name, producer,
    country, region, price_reference, primary_type AS category,
    library_tier, review_status, identity_status, created_at, updated_at
  FROM public.master_wine_library
  WHERE deleted_at IS NULL
UNION ALL
  SELECT
    id, beverage_type AS catalogue_kind, name, display_name, producer,
    country, region, price_reference, beverage_type AS category,
    library_tier, review_status, identity_status, created_at, updated_at
  FROM public.beverages
  WHERE deleted_at IS NULL
UNION ALL
  SELECT
    id, 'cocktail'::text AS catalogue_kind, name, display_name,
    NULL::text AS producer, NULL::text AS country, NULL::text AS region,
    price AS price_reference, menu_section AS category,
    NULL::integer AS library_tier, NULL::text AS review_status,
    NULL::text AS identity_status, created_at, updated_at
  FROM public.cocktails
  WHERE deleted_at IS NULL;

COMMENT ON VIEW public.catalogue_items IS
  'Search/display surface across wines, beverages and cocktails -- one '
  'query, three physical tables, no duplicated rows (plan §2.1/§3). Not '
  'for matching or merging: identity decisions stay per-table (arch §3). '
  'Cocktails carry NULL producer/country/region/library_tier/review_status/'
  'identity_status -- they are restaurant-scoped recipes, not globally '
  'deduplicated catalogue rows.';
