-- Plan §2.1 / arch §4.2-§4.3: catalogue_items (the "everything" search
-- surface) and a small number of per-category views.
--
-- Deliberately NOT building all nine category views with extracted
-- type_attributes fields (mash_bill, chill_filtered, seimaibuai, ...) --
-- type_attributes is empty ('{}') on all 608 migrated rows today, since no
-- beverage-specific enrichment has run yet. A view extracting named keys
-- from an empty object is scaffolding for data that does not exist, the
-- exact anti-pattern this whole plan refuses elsewhere (arch §4.2, §9.4).
-- whiskey and beer are built as the worked examples -- largest populations
-- (272, 57) and the pattern the rest follow once each category earns real
-- attribute data. Adding a category is meant to be a small, mechanical
-- migration from this template, not a rethink.

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
  WHERE deleted_at IS NULL;

COMMENT ON VIEW public.catalogue_items IS
  'Search/display surface across wines and beverages -- one query, two '
  'physical tables, no duplicated rows (plan §2.1). Not for matching or '
  'merging: identity decisions stay per-table (arch §3).';

CREATE OR REPLACE VIEW public.whiskey AS
  SELECT
    id, name, display_name, producer, abv_pct, volume_ml, price_reference,
    age_years, cask_finish, expression, proof,
    -- Present, but will read NULL until a beverage-specific enrichment
    -- pass populates type_attributes -- honest about being unpopulated
    -- rather than omitted, so the column exists the moment data does.
    type_attributes ->> 'mash_bill' AS mash_bill,
    (type_attributes ->> 'chill_filtered')::boolean AS chill_filtered,
    type_attributes ->> 'barrel_type' AS barrel_type,
    identity_key, identity_status, created_at, updated_at
  FROM public.beverages
  WHERE beverage_type = 'whiskey' AND deleted_at IS NULL;

CREATE OR REPLACE VIEW public.beer AS
  SELECT
    id, name, display_name, producer, abv_pct, volume_ml, price_reference,
    type_attributes ->> 'style' AS style,
    (type_attributes ->> 'ibu')::numeric AS ibu,
    type_attributes ->> 'fermentation' AS fermentation,
    identity_key, identity_status, created_at, updated_at
  FROM public.beverages
  WHERE beverage_type = 'beer' AND deleted_at IS NULL;

COMMENT ON VIEW public.whiskey IS
  'Per-category view, arch §4 -- worked example. type_attributes fields '
  'read NULL until beverage-specific enrichment runs; the columns exist so '
  'population is additive, not a schema change.';
COMMENT ON VIEW public.beer IS
  'Per-category view, arch §4 -- worked example. Same caveat as whiskey.';

-- ---------------------------------------------------------------------
-- The invariant that keeps promotion possible (arch §4.3): nothing outside
-- a migration or a view body may read type_attributes directly. Enforced
-- here at the database layer -- REVOKE direct column access from the roles
-- application code runs as, GRANT only through the views, which are
-- SECURITY INVOKER by default and therefore still respect RLS.
-- ---------------------------------------------------------------------

REVOKE SELECT (type_attributes) ON public.beverages FROM authenticated;
GRANT SELECT (
  id, beverage_type, name, display_name, producer, brand, country, region,
  abv_pct, volume_ml, package_format, price_reference, barcode, sku, upc,
  ean, library_tier, review_status, signature_hash, normalized_name,
  normalized_producer, identity_key, identity_status, body, acidity,
  serving_temp_celsius, glass_type, age_years, cask_finish, expression,
  proof, observed_at, created_at, updated_at, deleted_at, superseded_by
) ON public.beverages TO authenticated;

COMMENT ON COLUMN public.beverages.type_attributes IS
  'Category-specific, descriptive-only JSONB. Column-level GRANT '
  'deliberately excludes this from the authenticated role -- read it '
  'through a category view (whiskey, beer, ...), never directly. This is '
  'what keeps a future promotion to a real per-category table (arch §4.3) '
  'a view-body swap instead of a multi-repo change: nothing outside this '
  'migration and view definitions may ever have depended on the column '
  'existing.';
