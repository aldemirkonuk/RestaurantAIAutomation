-- 0b (BEVERAGE_CATALOGUE_PLAN.md; arch §3.10, register A2): two rows that
-- were listed as separate lines on the SAME restaurant menu are, by
-- construction, different products -- a restaurant does not print one bottle
-- twice at two prices. That is the exact instrument arch §3.1 built the
-- 732,874-pair merge-identity gate on, and it applies just as directly here.
--
-- Measured against the live library before this migration:
--   find_library_duplicates(85) returns 289 proposals.
--   200 of them are pairs whose rows co-occur on a single source menu --
--   provably distinct products.
--   18 of those 200 are flagged safe_to_merge = true.
-- Nothing auto-runs this merge today, so this was a loaded gun, not a fired
-- one -- but it must not stay loaded. This migration adds the one predicate
-- that disarms it: co-occurrence on a menu forces safe_to_merge = false,
-- regardless of what match_kind says, and the reason is surfaced as its own
-- column rather than folded silently into the boolean.
--
-- `data_enrichment->'menus'` is a JSON array (menu-matched wines can and do
-- carry more than one -- a wine seen on sibling restaurants' menus has
-- several, which is a real and different signal: same-ownership overlap,
-- not same-bottle duplication). Overlap is checked across the FULL arrays,
-- not just index 0 -- an earlier ad-hoc check during investigation compared
-- only element 0 and would have missed most real co-occurrence.

DROP FUNCTION IF EXISTS public.find_library_duplicates(integer, integer);

CREATE OR REPLACE FUNCTION public.find_library_duplicates(
  p_min_confidence integer DEFAULT 85,
  p_limit          integer DEFAULT 500
)
RETURNS TABLE (
  keeper_id          uuid,
  keeper_producer    varchar,
  keeper_name        varchar,
  keeper_vintage     integer,
  loser_id           uuid,
  loser_producer     varchar,
  loser_name         varchar,
  loser_vintage      integer,
  confidence         integer,
  same_vintage       boolean,
  match_kind         text,
  co_occurs_on_menu  boolean,
  safe_to_merge      boolean
)
LANGUAGE sql
STABLE
AS $$
  WITH pairs AS (
    SELECT m.id AS a_id, c.id AS b_id, c.confidence,
           m.library_tier AS a_tier, c.library_tier AS b_tier,
           m.created_at   AS a_created,
           (SELECT x.created_at FROM public.master_wine_library x WHERE x.id = c.id) AS b_created
    FROM public.master_wine_library m
    CROSS JOIN LATERAL public.match_library_wine(
      m.name, m.producer, m.vintage, m.country, m.region, m.grape_variety,
      0.60, 0.70, 5
    ) c
    WHERE m.deleted_at IS NULL
      AND c.id <> m.id
      AND c.confidence >= p_min_confidence
  ),
  ordered AS (
    SELECT DISTINCT ON (least(a_id::text, b_id::text), greatest(a_id::text, b_id::text))
           CASE WHEN (coalesce(a_tier, 99), a_created, a_id)
                  <= (coalesce(b_tier, 99), b_created, b_id)
                THEN a_id ELSE b_id END AS keeper_id,
           CASE WHEN (coalesce(a_tier, 99), a_created, a_id)
                  <= (coalesce(b_tier, 99), b_created, b_id)
                THEN b_id ELSE a_id END AS loser_id,
           confidence
    FROM pairs
    ORDER BY least(a_id::text, b_id::text), greatest(a_id::text, b_id::text),
             confidence DESC
  ),
  classified AS (
    SELECT o.keeper_id, o.loser_id, o.confidence,
           k.producer AS kp, k.name AS kn, k.vintage AS kv,
           l.producer AS lp, l.name AS ln, l.vintage AS lv,
           k.normalized_name AS knn, l.normalized_name AS lnn,
           k.normalized_producer AS knp, l.normalized_producer AS lnp,
           k.data_enrichment AS k_enrich, l.data_enrichment AS l_enrich
    FROM ordered o
    JOIN public.master_wine_library k ON k.id = o.keeper_id
    JOIN public.master_wine_library l ON l.id = o.loser_id
  )
  SELECT c.keeper_id, c.kp, c.kn, c.kv,
         c.loser_id,  c.lp, c.ln, c.lv,
         c.confidence,
         (c.kv IS NOT DISTINCT FROM c.lv) AS same_vintage,
         kind.k,
         cooc.co_occurs,
         -- Exact normalized agreement, same vintage, AND never seen together
         -- on one menu. Any one of the three failing means a human looks.
         (kind.k = 'identical'
            AND c.kv IS NOT DISTINCT FROM c.lv
            AND NOT cooc.co_occurs)
  FROM classified c
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN c.knn = c.lnn AND c.knp = c.lnp THEN 'identical'
      -- strict word-superset in either direction: the extra words are a
      -- cuvee, vineyard or bottling that may make these different wines
      WHEN c.knp = c.lnp AND (
             string_to_array(c.knn, ' ') @> string_to_array(c.lnn, ' ')
          OR string_to_array(c.lnn, ' ') @> string_to_array(c.knn, ' ')
           ) THEN 'name_extends'
      ELSE 'fuzzy'
    END AS k
  ) kind
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(c.k_enrich -> 'menus'))
        &&
      ARRAY(SELECT jsonb_array_elements_text(c.l_enrich -> 'menus')),
      false
    ) AS co_occurs
  ) cooc
  ORDER BY (kind.k = 'identical') DESC, c.confidence DESC, c.kp, c.kn
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.find_library_duplicates IS
  'Existing duplicate pairs, found with the same matcher the importer uses. '
  'match_kind separates rows that differ only in punctuation/case '
  '(identical, safe_to_merge) from ones where a cuvee or vineyard suffix may '
  'mean two genuinely different wines (name_extends / fuzzy - review). '
  'co_occurs_on_menu is true when both rows were seen as separate lines on '
  'the same source menu - by construction two different products - and '
  'forces safe_to_merge=false regardless of match_kind (0b guard, '
  'BEVERAGE_CATALOGUE_ARCHITECTURE.md §3.10). '
  'Keeper/loser ordering matches merge_library_wines'' precedence.';

GRANT EXECUTE ON FUNCTION public.find_library_duplicates
  TO authenticated, service_role;
