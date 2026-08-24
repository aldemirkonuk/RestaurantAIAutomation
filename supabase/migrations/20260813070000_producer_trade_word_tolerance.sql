-- Compare producers on their distinctive words as well as their full form.
--
-- THE CASE
--
-- A menu prints "Alban" for "Alban Vineyards", "Kavaklıdere Co." for
-- "Kavaklıdere Wines Co.", "Massican" for "Massican Winery". Measured, the
-- last of those already worked (word_similarity finds "massican" inside
-- "massican winery") but the first two scored 0.80 — under the 85 auto-link
-- floor, so they went to review and, in production, created a duplicate.
--
-- WHY NOT JUST LOWER THE GATE
--
-- Because the same trade words are what produce the WORST false positives.
-- "chateau musar" scores 0.571 against "chateau de bligny" purely on the
-- shared "chateau". Lowering the producer gate to admit 0.80 walks toward
-- that, and admitting shared-trade-word matches is exactly wrong: those words
-- identify a kind of wine business, they do not distinguish one.
--
-- SO STRIP THEM AND COMPARE AGAIN
--
-- The core form drops trade words and compares what is left. It makes the
-- true cases match — "alban" vs "alban", "kavaklidere co" vs "kavaklidere co"
-- — and simultaneously makes the false ones WORSE, which is the useful part:
-- "chateau musar" and "chateau de bligny" become "musar" and "de bligny",
-- which share nothing. Precision and recall move the same direction, so this
-- is not a threshold trade.
--
-- The matcher takes the better of the two comparisons, so a producer whose
-- distinctive words are its trade words ("The Wine Company" strips to nothing)
-- falls back to the full-form score rather than matching everything.
--
-- The word list mirrors TRADE_WORDS in vendor-intel/wine-identity.ts, which
-- solves the same problem for vendor price matching.

CREATE OR REPLACE FUNCTION public.wine_strip_trade_words(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
           -- Everything was a trade word. Keep the original: a producer with
           -- no distinctive words is not a licence to match every other one.
           WHEN btrim(stripped) = '' THEN value
           ELSE btrim(stripped)
         END
  FROM (
    SELECT regexp_replace(
             regexp_replace(
               coalesce(value, ''),
               '\m(vineyards?|wineries|winery|estates?|cellars?|wines?|'
               'domaines?|chateaux|chateau|bodegas?|weingut|weinguter|'
               'tenuta|tenute|azienda|aziende|agricola|agricole|cantina|'
               'cantine|maison|champagne|fattoria|marchesi|pince|'
               'company|co|inc|ltd|llc|the|family|brothers|bros|and|'
               'vinicola|vinos|vina|vinas|quinta|herdade|casa|clos)\M',
               ' ', 'gi'
             ),
             '\s+', ' ', 'g'
           ) AS stripped
  ) s;
$$;

COMMENT ON FUNCTION public.wine_strip_trade_words(text) IS
  'Producer reduced to its distinctive words. Returns the input unchanged when '
  'nothing distinctive remains, so an all-generic name cannot match everything. '
  'Mirrors TRADE_WORDS in vendor-intel/wine-identity.ts.';

-- ---------------------------------------------------------------------------

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
             public.wine_strip_trade_words(p_producer))   AS np_core,
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
               -- full form
               word_similarity(q.np, m.normalized_producer),
               word_similarity(m.normalized_producer, q.np),
               -- distinctive words only
               word_similarity(q.np_core, mc.core),
               word_similarity(mc.core, q.np_core)
             )
           END AS psim
    FROM public.master_wine_library m
    JOIN candidate c ON c.id = m.id
    CROSS JOIN q
    CROSS JOIN LATERAL (
      SELECT public.wine_normalize_text(
               public.wine_strip_trade_words(m.producer)) AS core
    ) mc
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

COMMENT ON FUNCTION public.match_library_wine IS
  'Ranked library candidates for one extracted wine, scored 0-100. >= 85 is '
  'safe to auto-link; 60-84 is a review/enrichment candidate; below 60 is not '
  'returned. Producers are compared both in full and reduced to their '
  'distinctive words.';

GRANT EXECUTE ON FUNCTION public.match_library_wine TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.wine_strip_trade_words TO authenticated, service_role, anon;
