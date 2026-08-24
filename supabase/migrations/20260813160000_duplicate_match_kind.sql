-- Distinguish "certainly the same wine" from "one name contains the other".
--
-- THE RISK THE FIRST VERSION CARRIED
--
-- find_library_duplicates reuses match_library_wine, which is deliberately
-- forgiving: a menu printing "Fiano" must reach a library row named "Fiano
-- 'Irpinia'", so word_similarity scores the shorter name inside the longer at
-- 1.000. That is right for matching a menu line to a wine.
--
-- It is wrong for deciding whether two LIBRARY rows are one wine. Among the 30
-- pairs found, several differ only by a cuvee suffix:
--
--   CINCINNATO      BELLONE              vs  BELLONE "CASTORE"
--   CIRO PICARIELLO FIANO                vs  FIANO "IRPINIA"
--   ALDO VIOLA      NERELLO MASCALESE    vs  NERELLO MASCALESE MORETTO
--
-- "Castore" and "Irpinia" are single-vineyard bottlings. Those are plausibly
-- two different wines, and merging them destroys a real distinction and the
-- inventory attached to it. A merge is not reversible in the way a missed
-- merge is.
--
-- So the finder now says which kind of agreement it found:
--
--   identical      normalized name AND producer are equal. The rows differ
--                  only in punctuation, case or accents. Safe to merge.
--   name_extends   one name's words are a strict superset of the other's.
--                  Usually a cuvee, vineyard or bottling distinction. REVIEW.
--   fuzzy          neither; similar but not containing. REVIEW.
--
-- Only `identical` should ever be merged without a human looking.

DROP FUNCTION IF EXISTS public.find_library_duplicates(integer, integer);

CREATE OR REPLACE FUNCTION public.find_library_duplicates(
  p_min_confidence integer DEFAULT 85,
  p_limit          integer DEFAULT 500
)
RETURNS TABLE (
  keeper_id        uuid,
  keeper_producer  varchar,
  keeper_name      varchar,
  keeper_vintage   integer,
  loser_id         uuid,
  loser_producer   varchar,
  loser_name       varchar,
  loser_vintage    integer,
  confidence       integer,
  same_vintage     boolean,
  match_kind       text,
  safe_to_merge    boolean
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
           k.normalized_producer AS knp, l.normalized_producer AS lnp
    FROM ordered o
    JOIN public.master_wine_library k ON k.id = o.keeper_id
    JOIN public.master_wine_library l ON l.id = o.loser_id
  )
  SELECT c.keeper_id, c.kp, c.kn, c.kv,
         c.loser_id,  c.lp, c.ln, c.lv,
         c.confidence,
         (c.kv IS NOT DISTINCT FROM c.lv) AS same_vintage,
         kind.k,
         -- Only an exact normalized agreement, on the same vintage, is safe
         -- to collapse unattended.
         (kind.k = 'identical' AND c.kv IS NOT DISTINCT FROM c.lv)
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
  ORDER BY (kind.k = 'identical') DESC, c.confidence DESC, c.kp, c.kn
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.find_library_duplicates IS
  'Existing duplicate pairs, found with the same matcher the importer uses. '
  'match_kind separates rows that differ only in punctuation/case '
  '(identical, safe_to_merge) from ones where a cuvee or vineyard suffix may '
  'mean two genuinely different wines (name_extends / fuzzy — review). '
  'Keeper/loser ordering matches merge_library_wines'' precedence.';

GRANT EXECUTE ON FUNCTION public.find_library_duplicates
  TO authenticated, service_role;
