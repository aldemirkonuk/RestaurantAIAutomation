-- Run the trade-word helpers on normalized input, not raw.
--
-- THE BUG, CAUGHT BY THE INTEGRATION TEST
--
-- match_library_wine passed the RAW producer to wine_trade_words() and
-- wine_strip_trade_words(), while abbreviation expansion happens inside
-- wine_normalize_text(). So an abbreviated producer was invisible to both:
--
--   wine_trade_words('Dom. Foo')        -> {}          (should be {domaine})
--   wine_strip_trade_words('Dom. Foo')  -> 'Dom. Foo'  (should be 'Foo')
--
-- An empty trade-word set means "this side declares no family", which the
-- family guard reads as "no contradiction, allow the stripped comparison". So
-- a probe for "Dom. X" was compared core-to-core against "Bodega X" — the
-- exact pair the guard exists to separate — and linked to it over the correct
-- "Domaine X".
--
-- Reproduced by the integration test: probing "Dom. <suffix>" returned the
-- Bodega row rather than the Domaine row it created.
--
-- THE FIX
--
-- Both helpers now receive wine_normalize_text() output. That is strictly
-- better than teaching them the abbreviation table too: normalization is where
-- abbreviation expansion already lives, there is exactly one place to change
-- when the table grows, and on the library side the value is the stored
-- normalized_producer, so nothing is re-normalized per row.

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
           -- strip/classify AFTER normalizing, so "Dom." is already "domaine"
           public.wine_strip_trade_words(
             public.wine_normalize_text(p_producer))  AS np_core,
           public.wine_trade_words(
             public.wine_normalize_text(p_producer))  AS np_trade,
           public.wine_signature_hash(p_producer, p_name, p_vintage,
                                      p_country, p_region, p_grape_variety) AS sig
  ),
  candidate AS (
    SELECT m.id FROM public.master_wine_library m, q
    WHERE m.signature_hash = q.sig AND m.deleted_at IS NULL
    UNION
    SELECT m.id FROM public.master_wine_library m, q
    WHERE m.normalized_name = q.nn AND m.deleted_at IS NULL
    UNION
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
             ELSE GREATEST(
               word_similarity(q.np, m.normalized_producer),
               word_similarity(m.normalized_producer, q.np),
               CASE
                 WHEN cardinality(q.np_trade) = 0
                   OR cardinality(mt.trade) = 0
                   OR q.np_trade && mt.trade
                 THEN GREATEST(word_similarity(q.np_core, mc.core),
                               word_similarity(mc.core, q.np_core))
                 ELSE 0.0::real
               END
             )
           END AS psim
    FROM public.master_wine_library m
    JOIN candidate c ON c.id = m.id
    CROSS JOIN q
    -- normalized_producer is stored, so these are pure string work per
    -- candidate rather than a re-normalization of the whole table.
    CROSS JOIN LATERAL (
      SELECT public.wine_strip_trade_words(m.normalized_producer) AS core
    ) mc
    CROSS JOIN LATERAL (
      SELECT public.wine_trade_words(m.normalized_producer) AS trade
    ) mt
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
  ORDER BY confidence DESC, s.nsim DESC, s.psim DESC,
           s.library_tier NULLS LAST, s.id
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.match_library_wine TO authenticated, service_role, anon;
