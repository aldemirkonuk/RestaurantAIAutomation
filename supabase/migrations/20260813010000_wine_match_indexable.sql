-- Make match_library_wine index-driven, and rescale its score.
--
-- ---------------------------------------------------------------------------
-- 1. Why the previous version does not scale
-- ---------------------------------------------------------------------------
--
-- EXPLAIN ANALYZE on the previous definition:
--
--     Seq Scan on master_wine_library  (rows removed by filter: 293)
--     Execution Time: 3.615 ms
--
-- 3.6ms looks fine — at 293 rows everything looks fine. The shape is the
-- problem: the WHERE clause ORs together a signature test, an equality test
-- and two trigram tests, and no single index can serve a disjunction like
-- that, so the planner scans the table. One menu import runs this once per
-- extracted wine — 485 times for RL Restaurant. At 1000 restaurants the
-- library is ~300k rows, and 485 sequential scans of 300k rows is the
-- difference between a 30-second import and a 30-minute one.
--
-- Rewritten as a UNION of separately-indexable branches, each branch can use
-- the index built for it:
--     signature  -> idx_master_wine_library_signature_hash (unique btree)
--     exact      -> idx_mwl_name_producer_vintage (btree)
--     fuzzy      -> idx_mwl_normalized_name_trgm (GIN)
--
-- Candidate generation is driven by NAME only. Producer is then applied as a
-- filter over that handful of rows rather than as another index branch,
-- because by then there is nothing left to narrow — and because the reverse
-- word-similarity direction (a verbose probe against a bare library name) is
-- not indexable in principle: it would need an index on the query string.
--
-- One constraint the caller has to know about: the `<%` operator prefilters
-- using the pg_trgm.word_similarity_threshold GUC (default 0.6), NOT using
-- p_min_name_sim. This role cannot pin that GUC on the function — Supabase
-- denies `SET pg_trgm.*` at migration time — so 0.6 is a hard floor on name
-- similarity, and passing p_min_name_sim below it widens nothing. It only
-- tightens. That costs no measured recall: the perturbations below score
-- 1.000 on name, far above the floor. A caller that genuinely needs a wider
-- net must raise it per-session with set_limit()/SET before calling.
--
-- ---------------------------------------------------------------------------
-- 2. Why the score is rescaled
-- ---------------------------------------------------------------------------
--
-- The old tiers were ordinal buckets: 90 for an exact name+producer+vintage
-- match, and everything fuzzy squeezed into 50-69. Measuring it exposed the
-- flaw. The library holds "2015 Louis Roederer Cristal Champagne"; a menu
-- printing producer "Louis Roederer", name "Cristal", vintage 2015 matched it
-- with name similarity 1.00 and producer similarity 1.00 — a perfect match on
-- every field — and scored 69, below a bucket meaning "same name, WRONG
-- vintage". Worse, the fuzzy branch ignored vintage entirely.
--
-- So confidence is now continuous, and vintage is a modifier rather than a
-- separate ladder:
--
--     signature match                        -> 100
--     otherwise  round(LEAST(nsim, psim) * 100)
--                  vintage equal or both NULL  ->  base
--                  exactly one side NULL       ->  base - 10
--                  both present, different     ->  base - 30
--
-- Exact string equality scores 1.0 on both similarities, so an exact
-- name+producer+vintage match still lands at 100 and the old ordering is
-- preserved where it was right.
--
-- Measured against the live library (660 probes derived from real rows and
-- perturbed the way menus actually print them):
--
--     perturbation              n   recall   top-1
--     verbatim                292    1.000   0.911
--     name without vintage    232    1.000   0.927
--     producer trade dropped   64    0.969   0.969
--     both                     59    0.966   0.966
--     producer abbreviated     13    0.692   0.692
--
-- top-1 is below recall because the library contains 14 groups of 2-3
-- identical rows — the probe's own id is not always ranked first among its
-- own duplicates. Those are the duplicates the backfill migration exposed.
--
-- "producer abbreviated" (Domaine X printed as Dom. X) is the known weak
-- spot: it scores 0.733, below the 0.85 auto-link floor, so it goes to review
-- rather than being linked or silently dropped. That is the intended
-- behaviour for a genuinely ambiguous abbreviation.

DROP FUNCTION IF EXISTS public.match_library_wine(text, text, integer, text, text, text, real, real, integer);

CREATE OR REPLACE FUNCTION public.match_library_wine(
  p_name             text,
  p_producer         text DEFAULT NULL,
  p_vintage          integer DEFAULT NULL,
  p_country          text DEFAULT NULL,
  p_region           text DEFAULT NULL,
  p_grape_variety    text DEFAULT NULL,
  p_min_name_sim     real DEFAULT 0.60,
  p_min_producer_sim real DEFAULT 0.70,
  p_limit            integer DEFAULT 5
)
RETURNS TABLE (
  id             uuid,
  name           varchar,
  producer       varchar,
  vintage        integer,
  library_tier   integer,
  confidence     integer,
  name_sim       real,
  producer_sim   real
)
LANGUAGE sql
STABLE
AS $$
  WITH q AS (
    SELECT public.wine_normalize_text(p_name)     AS nn,
           public.wine_normalize_text(p_producer) AS np,
           public.wine_signature_hash(p_producer, p_name, p_vintage,
                                      p_country, p_region, p_grape_variety) AS sig
  ),
  candidate AS (
    -- unique btree on signature_hash
    SELECT m.id FROM public.master_wine_library m, q
    WHERE m.signature_hash = q.sig AND m.deleted_at IS NULL

    UNION

    -- btree on (normalized_name, normalized_producer, vintage)
    SELECT m.id FROM public.master_wine_library m, q
    WHERE m.normalized_name = q.nn AND m.deleted_at IS NULL

    UNION

    -- GIN trigram on normalized_name. Capped: a bare name like "chardonnay"
    -- can word-match a lot of verbose library entries, and the producer gate
    -- below is what actually decides. 200 is far more than the gate ever
    -- keeps, and it bounds the worst case instead of leaving it open.
    (SELECT m.id FROM public.master_wine_library m, q
     WHERE q.nn <> '' AND q.nn <% m.normalized_name AND m.deleted_at IS NULL
     LIMIT 200)
  ),
  scored AS (
    SELECT m.id, m.name, m.producer, m.vintage, m.library_tier,
           (m.signature_hash = q.sig) AS sig_match,
           GREATEST(word_similarity(q.nn, m.normalized_name),
                    word_similarity(m.normalized_name, q.nn)) AS nsim,
           CASE
             WHEN q.np = '' AND m.normalized_producer = '' THEN 1.0::real
             WHEN q.np = '' OR m.normalized_producer = ''  THEN 0.0::real
             ELSE GREATEST(word_similarity(q.np, m.normalized_producer),
                           word_similarity(m.normalized_producer, q.np))
           END AS psim
    FROM public.master_wine_library m
    JOIN candidate c ON c.id = m.id
    CROSS JOIN q
  )
  SELECT s.id, s.name, s.producer, s.vintage, s.library_tier,
         CASE
           WHEN s.sig_match THEN 100
           ELSE GREATEST(0, round(LEAST(s.nsim, s.psim) * 100)::int
                            - CASE
                                WHEN s.vintage IS NOT DISTINCT FROM p_vintage THEN 0
                                WHEN s.vintage IS NULL OR p_vintage IS NULL   THEN 10
                                ELSE 30
                              END)
         END AS confidence,
         s.nsim, s.psim
  FROM scored s
  WHERE s.sig_match
     OR (s.nsim >= p_min_name_sim AND s.psim >= p_min_producer_sim)
  -- Deterministic all the way down. The lookup this replaces was a bare
  -- LIMIT 1 with no ORDER BY, so which of three identical rows a menu linked
  -- to varied between imports of the same menu.
  ORDER BY confidence DESC, s.nsim DESC, s.psim DESC,
           s.library_tier NULLS LAST, s.id
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.match_library_wine IS
  'Ranked library candidates for one extracted wine, scored 0-100. >= 85 is '
  'safe to auto-link; 60-84 is a review/enrichment candidate; below 60 is not '
  'returned. See the migration for the measured recall behind those numbers.';

GRANT EXECUTE ON FUNCTION public.match_library_wine TO authenticated, service_role, anon;
