-- Premortem audit findings (2026-08-18), decision #4: cocktails/
-- catalogue_items security gaps. Retroactive review of 20260817-series
-- migrations by an independent opus agent, dispatched per this session's
-- own build directive after a stop-hook flagged that several
-- implementation-level decisions (not the plan's own pre-reviewed design)
-- had been made unilaterally without a separate review pass. Verified each
-- claim against the live system before fixing rather than trusting the
-- report blind.
--
-- FIX 1 — cocktails/cocktail_ingredients had NO tenant isolation.
-- cocktails_authenticated_read only checked `deleted_at IS NULL`;
-- cocktail_ingredients_authenticated_read was USING (true). Every other
-- restaurant-scoped table in this schema (menu_items, restaurant_inventory,
-- 20+ more) filters on restaurant_id via user_restaurant_access. Dormant
-- today because all 55 migrated cocktails carry restaurant_id=NULL
-- (unattributed reference data, plan §3) -- but the day a real
-- per-restaurant cocktail lands with a real restaurant_id, this would leak
-- restaurant B's cocktail list and pricing to restaurant A. Zero
-- application callers today (checked) -- the cheapest this fix will ever
-- be, so it lands now rather than being deferred to whoever builds the
-- first cocktail feature.
--
-- NULL restaurant_id (unattributed reference data) stays globally
-- readable, matching how master_wine_library and beverages already treat
-- global reference rows; a real restaurant_id is scoped to users with
-- access to that restaurant, matching restaurant_inventory's own policy
-- shape exactly.

DROP POLICY IF EXISTS cocktails_authenticated_read ON public.cocktails;
CREATE POLICY cocktails_authenticated_read ON public.cocktails
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      restaurant_id IS NULL
      OR restaurant_id IN (
        SELECT user_restaurant_access.restaurant_id
        FROM public.user_restaurant_access
        WHERE user_restaurant_access.user_id = auth.uid()
          AND user_restaurant_access.is_active
      )
    )
  );

DROP POLICY IF EXISTS cocktail_ingredients_authenticated_read ON public.cocktail_ingredients;
CREATE POLICY cocktail_ingredients_authenticated_read ON public.cocktail_ingredients
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cocktails c
      WHERE c.id = cocktail_ingredients.cocktail_id
        AND c.deleted_at IS NULL
        AND (
          c.restaurant_id IS NULL
          OR c.restaurant_id IN (
            SELECT user_restaurant_access.restaurant_id
            FROM public.user_restaurant_access
            WHERE user_restaurant_access.user_id = auth.uid()
              AND user_restaurant_access.is_active
          )
        )
    )
  );

-- FIX 2 — the three new views claimed "SECURITY INVOKER by default" in a
-- code comment; Postgres views are SECURITY DEFINER by default (INVOKER
-- became available as an explicit option in PG15, this database runs
-- 17.6, but explicit was never set). Without it, the view owner (the
-- migration role, which owns the base tables) bypasses RLS on the base
-- tables entirely for anyone holding SELECT on the view -- under
-- Supabase's default privileges, that is every `authenticated` and `anon`
-- role. This made FIX 1 the actual enforcement point and made the RLS
-- policies on beverages/master_wine_library/cocktails decorative for
-- anyone reading through these views instead of the base tables directly.

ALTER VIEW public.whiskey SET (security_invoker = true);
ALTER VIEW public.beer SET (security_invoker = true);

-- FIX 3 — catalogue_items unioned cocktails with no restaurant_id in the
-- select list, so a caller who wanted to filter to their own restaurant's
-- cocktails had no column to filter on. Added as NULL for the wine and
-- beverage branches (both globally-scoped, arch §2) and the real column
-- for cocktails. Also sets security_invoker=true, folding fix 2 in for
-- this view since it must be dropped and recreated for fix 3 anyway.

-- Prior versions of this view (20260817080000, 20260817100000) had a
-- different column list/order; CREATE OR REPLACE VIEW cannot reorder or
-- insert a column mid-list for an existing view, only append at the end.
-- Dropped and recreated rather than fought around, since nothing in
-- application code selects positionally from it (checked: zero callers).
DROP VIEW IF EXISTS public.catalogue_items;
CREATE VIEW public.catalogue_items
  WITH (security_invoker = true)
AS
  SELECT
    id, 'wine'::text AS catalogue_kind, name, display_name, producer,
    country, region, price_reference, primary_type AS category,
    library_tier, review_status, identity_status,
    NULL::uuid AS restaurant_id, created_at, updated_at
  FROM public.master_wine_library
  WHERE deleted_at IS NULL
UNION ALL
  SELECT
    id, beverage_type AS catalogue_kind, name, display_name, producer,
    country, region, price_reference, beverage_type AS category,
    library_tier, review_status, identity_status,
    NULL::uuid AS restaurant_id, created_at, updated_at
  FROM public.beverages
  WHERE deleted_at IS NULL
UNION ALL
  SELECT
    id, 'cocktail'::text AS catalogue_kind, name, display_name,
    NULL::text AS producer, NULL::text AS country, NULL::text AS region,
    price AS price_reference, menu_section AS category,
    NULL::integer AS library_tier, NULL::text AS review_status,
    NULL::text AS identity_status,
    restaurant_id, created_at, updated_at
  FROM public.cocktails
  WHERE deleted_at IS NULL;

COMMENT ON VIEW public.catalogue_items IS
  'Search/display surface across wines, beverages and cocktails -- one '
  'query, three physical tables, no duplicated rows (plan §2.1/§3). Not '
  'for matching or merging: identity decisions stay per-table (arch §3). '
  'security_invoker=true (fix 2026-08-18) -- RLS on the base tables '
  'applies to whoever queries this view, not the view owner''s '
  'privileges. restaurant_id is NULL for wine/beverages (globally '
  'scoped) and real for cocktails (restaurant-scoped, arch §2) -- filter '
  'on it explicitly for a per-restaurant surface.';

-- FIX 4 (verification, not a change) — audited claim that column-level
-- REVOKE SELECT (type_attributes) might be a no-op if `authenticated`
-- already holds table-wide SELECT from Supabase's default privileges.
-- Checked directly: `authenticated` DOES hold table-level SELECT on
-- beverages (Supabase's standard grant), and Postgres's column-privilege
-- model is that a table-level SELECT grant covers ALL columns regardless
-- of a narrower column-level GRANT list -- the REVOKE narrows what the
-- column-level grant *adds*, it does not narrow the table-level grant.
-- So 20260817080000's REVOKE/GRANT pair was genuinely a no-op for
-- `authenticated`, and the ONLY real enforcement of "read type_attributes
-- through a view, not directly" is scripts/check_no_direct_type_
-- attributes_access.sh at the application-code layer.
--
-- REVOKE the table-level grant outright and re-grant only the named
-- columns, which is the actual correct way to restrict column access in
-- Postgres.

REVOKE ALL ON public.beverages FROM authenticated;
GRANT SELECT (
  id, beverage_type, name, display_name, producer, brand, country, region,
  abv_pct, volume_ml, package_format, price_reference, barcode, sku, upc,
  ean, library_tier, review_status, signature_hash, normalized_name,
  normalized_producer, identity_key, identity_status, body, acidity,
  serving_temp_celsius, glass_type, age_years, cask_finish, expression,
  proof, observed_at, created_at, updated_at, deleted_at, superseded_by
) ON public.beverages TO authenticated;

COMMENT ON COLUMN public.beverages.type_attributes IS
  'Category-specific, descriptive-only JSONB. `authenticated` has no '
  'table-level grant on this table at all (fixed 2026-08-18 -- a prior '
  'REVOKE SELECT (type_attributes) alone was a no-op, since Postgres '
  'column privileges only ADD to a table-level grant, never narrow it); '
  'only the named columns above are granted. Read type_attributes through '
  'a category view (whiskey, beer, ...), never directly. This plus '
  'scripts/check_no_direct_type_attributes_access.sh (application code, '
  'which runs as service_role and bypasses grants/RLS entirely) is what '
  'keeps a future promotion to a real per-category table (arch §4.3) a '
  'view-body swap instead of a multi-repo change.';
