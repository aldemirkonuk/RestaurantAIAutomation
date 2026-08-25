-- Find duplicates that already exist in the library.
--
-- WHY THIS IS NOT THE SAME AS THE SIGNATURE INDEX
--
-- signature_hash catches only EXACT duplicates — same producer, name, vintage,
-- country, region and grape after normalization. That is the right key for
-- preventing new duplicates, and it is why the unique index exists. It is
-- useless for finding the ones already in the table, because a duplicate that
-- survived did so precisely by differing somewhere: "Massican" and "Massican
-- Winery", "Chateau Musar" with and without the vintage glued into the name.
--
-- So this reuses match_library_wine — the same trigram/abbreviation/trade-word
-- logic the importer uses. That matters beyond convenience: if the duplicate
-- finder used different rules from the importer, it would either report pairs
-- the importer will never merge, or miss the pairs the importer keeps
-- creating. One matcher, one answer.
--
-- WHY IT IS BOUNDED
--
-- Naively this is O(n^2) — 282 rows is 79k comparisons today, but at 1000
-- restaurants the library is ~300k rows and the pairwise form is 45 billion.
-- Instead each row is matched with match_library_wine, which is index-driven
-- and returns at most a handful of candidates, making the whole scan O(n) index
-- lookups. p_limit caps the work regardless.
--
-- Pairs are emitted once, ordered so the more canonical row (lower
-- library_tier, then older) is the keeper — the same precedence
-- merge_library_wines uses, so the output can be fed straight into it.

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
  same_vintage     boolean
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
      AND c.id <> m.id                    -- a row always matches itself
      AND c.confidence >= p_min_confidence
  ),
  -- Each duplicate pair surfaces twice, once from each side. Keep one copy,
  -- with the more canonical row as keeper so the result feeds straight into
  -- merge_library_wines(keeper, loser).
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
  )
  SELECT o.keeper_id, k.producer, k.name, k.vintage,
         o.loser_id,  l.producer, l.name, l.vintage,
         o.confidence,
         (k.vintage IS NOT DISTINCT FROM l.vintage)
  FROM ordered o
  JOIN public.master_wine_library k ON k.id = o.keeper_id
  JOIN public.master_wine_library l ON l.id = o.loser_id
  ORDER BY o.confidence DESC, k.producer, k.name
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.find_library_duplicates IS
  'Existing duplicate pairs in master_wine_library, found with the same '
  'matcher the importer uses. Keeper/loser ordering matches '
  'merge_library_wines'' precedence, so rows can be fed straight to it. '
  'same_vintage=false means the pair differs on vintage and is probably two '
  'genuine bottles — review before merging.';

GRANT EXECUTE ON FUNCTION public.find_library_duplicates
  TO authenticated, service_role;
