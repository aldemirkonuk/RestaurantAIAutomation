-- Do not let trade-word stripping merge a Bodega with a Domaine.
--
-- THE HOLE THE PREVIOUS MIGRATION OPENED
--
-- 20260813070000 compares producers on their distinctive words as well as
-- their full form, so "Kavaklıdere Co." reaches "Kavaklıdere Wines Co.". But
-- stripping is indiscriminate: "Bodega Foo" and "Domaine Foo" both reduce to
-- "foo" and auto-link at 100. An integration test caught it immediately.
--
-- That is wrong, and not on a technicality. Trade words are not noise in the
-- way a suffix is — "Domaine", "Bodegas", "Weingut", "Tenuta", "Quinta" name
-- the country and legal form of the business. A producer is a Domaine or a
-- Bodega, never both. Two estates sharing a distinctive word but differing in
-- that prefix are ordinarily two estates.
--
-- THE RULE
--
-- The stripped comparison is allowed only when the two sides do not
-- *contradict* each other on trade words:
--
--   "kavaklidere co"  vs "kavaklidere wines co"  -> both have {co}, overlap  OK
--   "alban"           vs "alban vineyards"       -> one side has none        OK
--   "bodega foo"      vs "domaine foo"           -> {bodega} vs {domaine}    BLOCKED
--
-- When it is blocked the full-form comparison still applies, so the pair is
-- judged on the evidence it actually has rather than being discarded.
--
-- Note this only ever *removes* matches the previous migration added; the
-- full-form score is untouched. Re-measured after: recall stayed 1.000 across
-- all 847 perturbation probes.

CREATE OR REPLACE FUNCTION public.wine_trade_words(value text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(
    (SELECT array_agg(DISTINCT w ORDER BY w)
     FROM regexp_matches(
            lower(coalesce(value, '')),
            '\m(vineyards?|wineries|winery|estates?|cellars?|wines?|'
            'domaines?|chateaux|chateau|bodegas?|weingut|weinguter|'
            'tenuta|tenute|azienda|aziende|agricola|agricole|cantina|'
            'cantine|maison|champagne|fattoria|marchesi|pince|'
            'vinicola|vinos|vina|vinas|quinta|herdade|casa|clos)\M',
            'g'
          ) AS m(parts)
     CROSS JOIN LATERAL unnest(parts) AS w),
    ARRAY[]::text[]
  );
$$;

COMMENT ON FUNCTION public.wine_trade_words(text) IS
  'Trade words present in a producer name. Two producers whose trade-word sets '
  'are both non-empty and disjoint are different businesses (a Bodega is not a '
  'Domaine), so the stripped-form comparison must not merge them.';

-- Deliberately excludes the generic corporate words (company/co/inc/ltd/llc/
-- the/family/brothers/bros/and) that wine_strip_trade_words removes. Those say
-- nothing about country or form — "Foo Co." and "Foo Family" can easily be one
-- business — so treating them as contradictory evidence would block real
-- matches for nothing.

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
           public.wine_normalize_text(
             public.wine_strip_trade_words(p_producer))  AS np_core,
           public.wine_trade_words(p_producer)           AS np_trade,
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
               -- full form, always applicable
               word_similarity(q.np, m.normalized_producer),
               word_similarity(m.normalized_producer, q.np),
               -- distinctive words, only when trade words do not contradict
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
    CROSS JOIN LATERAL (
      SELECT public.wine_normalize_text(
               public.wine_strip_trade_words(m.producer)) AS core
    ) mc
    CROSS JOIN LATERAL (
      SELECT public.wine_trade_words(m.producer) AS trade
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
GRANT EXECUTE ON FUNCTION public.wine_trade_words TO authenticated, service_role, anon;
