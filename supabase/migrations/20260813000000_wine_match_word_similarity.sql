-- Make library matching survive the two naming styles that actually exist,
-- and pin the SQL/TypeScript normalizers to one shared rule.
--
-- ---------------------------------------------------------------------------
-- 1. Why wine_normalize_text changes
-- ---------------------------------------------------------------------------
--
-- The previous version stripped only combining marks (U+0300-U+036F). The
-- TypeScript side uses JS `\p{Diacritic}`, which is broader — it also deletes
-- spacing diacritics like U+00B7 MIDDLE DOT. Cross-checking both
-- implementations over all 293 library rows found exactly one divergence, and
-- it is instructive: Catalan "Xarel·lo" became "xarello" in TypeScript and
-- "xarel lo" in SQL, because the lone middle dot survived to the
-- non-alphanumeric->space step.
--
-- `\p{Diacritic}` covers 659 codepoints this class does not, but every one of
-- them is Hebrew, Arabic, Indic, Thai, Tibetan, Burmese or CJK. Delete-vs-space
-- only changes the result when the character sits BETWEEN Latin alphanumerics;
-- for a run of non-Latin text the whole run collapses to spaces either way. So
-- the class below is the Latin/Greek subset that can actually alter a wine
-- name, and the TypeScript normalizer is changed to use the identical class
-- rather than `\p{Diacritic}`.
--
-- Parity is not assumed — wine-submissions.service.spec.ts runs the TypeScript
-- normalizer against this function over the whole library and fails on drift.
--
-- ---------------------------------------------------------------------------
-- 2. Why match_library_wine changes
-- ---------------------------------------------------------------------------
--
-- The library stores names in two styles, because it was populated by two
-- different importers:
--     verbose  "2022 olivier leflaive les setilles bourgogne france"
--     bare     "chardonnay"
-- An extractor emits one style, so half the library is unreachable by plain
-- trigram similarity(), which penalises the length difference:
--
--     probe "les setilles bourgogne"  ->  similarity 0.438,  word_similarity 1.000
--     probe "jeune blanc"             ->  similarity 0.235,  word_similarity 1.000
--     probe "setilles"                ->  similarity 0.188,  word_similarity 1.000
--
-- word_similarity() scores the best matching word-extent instead of the whole
-- string, which is exactly the bare-inside-verbose case. Measured on this
-- library the true matches score 1.000 and the best false candidate scores
-- 0.238, so the threshold sits in a wide empty band rather than being tuned.
--
-- Direction matters and we do not control which side is verbose, so name uses
-- GREATEST of both directions. That alone would be too loose — a bare library
-- name like "chardonnay" scores 1.000 against any verbose probe containing the
-- word. Precision therefore comes from the producer gate, which is a separate,
-- independent condition. Measured producer thresholds on this library:
--
--     true matches      0.733 - 1.000   (worst: "dom mandeliere" vs
--                                        "domaine de la mandeliere")
--     false candidates  0.048 - 0.571   (worst: "chateau musar" vs
--                                        "chateau de bligny" — shared trade word)
--
-- 0.70 separates them. The margin is not huge, which is why a wine must clear
-- BOTH gates: a shared "chateau" prefix cannot carry a match on its own.

CREATE OR REPLACE FUNCTION public.wine_normalize_text(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(
           btrim(
             regexp_replace(
               regexp_replace(
                 normalize(coalesce(value, ''), NFD),
                 -- Shared diacritic class. Mirrored verbatim in
                 -- WineSubmissionsService.DIACRITICS — change both together.
                 '[̀-ͯ᪰-᫿᷀-᷿︠-︯^`¨¯´·¸ʰ-˿ʹ͵ͺ΄΅]',
                 '', 'g'
               ),
               '[^a-zA-Z0-9]+', ' ', 'g'
             )
           )
         );
$$;

COMMENT ON FUNCTION public.wine_normalize_text(text) IS
  'SQL mirror of WineSubmissionsService.normalizeText. Parity is enforced by '
  'wine-submissions.service.spec.ts, which runs both over the live library.';

-- ---------------------------------------------------------------------------
-- Ranked match
-- ---------------------------------------------------------------------------
--
-- Tiers, highest first:
--   100  exact signature
--    90  name + producer + same vintage
--    80  name + producer, one side has no vintage (NV, or menu omitted it)
--    70  name + producer, different vintage      -- caller decides
--    50+ fuzzy: name AND producer both clear their gate
--
-- The caller applies its own floor. Returning near-misses rather than
-- filtering them here is deliberate: a 0.6-similarity candidate is the
-- difference between enriching an existing wine and paying for a web search.
DROP FUNCTION IF EXISTS public.match_library_wine(text, text, integer, text, text, text, real, integer);

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
  match_tier     integer,
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
  scored AS (
    SELECT m.id, m.name, m.producer, m.vintage, m.library_tier,
           m.signature_hash, m.normalized_name, m.normalized_producer,
           q.nn, q.np, q.sig,
           GREATEST(word_similarity(q.nn, m.normalized_name),
                    word_similarity(m.normalized_name, q.nn)) AS nsim,
           GREATEST(word_similarity(q.np, m.normalized_producer),
                    word_similarity(m.normalized_producer, q.np)) AS psim
    FROM public.master_wine_library m, q
    WHERE m.deleted_at IS NULL
      AND q.nn <> ''
      AND (
        m.signature_hash = q.sig
        OR (m.normalized_name = q.nn AND m.normalized_producer = q.np)
        -- `<%` is the word_similarity operator, and it is what lets the GIN
        -- trigram index serve this instead of scanning the table once per
        -- extracted wine. A 485-wine menu is 485 of these.
        OR (q.np <> '' AND q.nn <% m.normalized_name AND q.np <% m.normalized_producer)
        OR (q.np <> '' AND m.normalized_name <% q.nn AND m.normalized_producer <% q.np)
      )
  )
  SELECT s.id, s.name, s.producer, s.vintage, s.library_tier,
         CASE
           WHEN s.signature_hash = s.sig                          THEN 100
           WHEN s.normalized_name = s.nn
            AND s.normalized_producer = s.np
            AND s.vintage IS NOT DISTINCT FROM p_vintage          THEN 90
           WHEN s.normalized_name = s.nn
            AND s.normalized_producer = s.np
            AND (s.vintage IS NULL OR p_vintage IS NULL)          THEN 80
           WHEN s.normalized_name = s.nn
            AND s.normalized_producer = s.np                      THEN 70
           ELSE 50 + (LEAST(s.nsim, s.psim) * 19)::int
         END AS match_tier,
         s.nsim, s.psim
  FROM scored s
  WHERE s.signature_hash = s.sig
     OR (s.normalized_name = s.nn AND s.normalized_producer = s.np)
     OR (s.nsim >= p_min_name_sim AND s.psim >= p_min_producer_sim)
  -- Deterministic all the way down. The lookup this replaces was a bare
  -- LIMIT 1 with no ORDER BY, so which of three identical rows a menu linked
  -- to varied between imports of the same menu.
  ORDER BY match_tier DESC, s.nsim DESC, s.psim DESC,
           s.library_tier NULLS LAST, s.id
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.match_library_wine IS
  'Ranked library candidates for one extracted wine. Tier >= 80 is safe to '
  'auto-link; 50-79 is a review/enrichment candidate.';

GRANT EXECUTE ON FUNCTION public.match_library_wine TO authenticated, service_role, anon;

-- normalized_* were written by the previous migration under the narrower
-- diacritic class. One row differs ("Xarel·lo"); recompute all so the stored
-- keys and the function agree.
UPDATE public.master_wine_library
SET normalized_name     = public.wine_normalize_text(name),
    normalized_producer = public.wine_normalize_text(producer);
