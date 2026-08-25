-- Make menu-import wine matching work at all.
--
-- WHY THIS EXISTS
--
-- WineSubmissionsService.resolveOrCreateLibraryWine() matches an extracted
-- wine against master_wine_library on exactly two things:
--   1. signature_hash  (exact)
--   2. normalized_name + normalized_producer  (fallback)
-- and creates a provisional wine when neither hits.
--
-- Measured on the live library (293 rows): normalized_name and
-- normalized_producer are NULL on ALL 293. The fallback therefore compares a
-- value against a universally-NULL column and can never match. signature_hash
-- is set on only 92 rows, all of them synthetic sim seeds. So in practice
-- matching has never linked a real menu import to a real library wine — every
-- import creates a duplicate row instead. The library already shows the
-- damage: 14 (name, producer) groups hold 2-3 identical rows each.
--
-- This backfills both keys so old and new rows share one key space.
--
-- NORMALIZATION CONTRACT  (mirrors WineSubmissionsService.normalizeText)
--
--   value.normalize("NFD")
--        .replace(/\p{Diacritic}/gu, "")
--        .replace(/[^a-zA-Z0-9]+/g, " ")
--        .trim()
--        .toLowerCase()
--
-- The SQL below is that, step for step. Note this is deliberately NOT
-- unaccent(): unaccent is a dictionary fold with different coverage, it is not
-- installed on this project, and the order of operations matters. Stripping
-- combining marks must happen BEFORE non-alphanumerics become spaces —
-- otherwise NFD-decomposed "Château" turns into "cha teau" rather than
-- "chateau", because the lone U+0302 is itself non-alphanumeric.
--
-- SIGNATURE CONTRACT  (mirrors buildSignature)
--
--   producer|name|vintage-or-NV|country|region|grape_variety   -> sha256 hex
--
-- primary_type is deliberately absent. It used to occupy a slot, which split
-- the key space in two: submitWine() passed a value there and
-- resolveOrCreateLibraryWine() did not, so the same bottle hashed two
-- different ways depending on which door it came through. primary_type is a
-- derived classification rather than an identity attribute — a menu never
-- states it — so removing it is what makes the two paths agree. Every existing
-- hash is recomputed below for that reason.

-- ---------------------------------------------------------------------------
-- Normalization + signature helpers
-- ---------------------------------------------------------------------------

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
                 '[̀-ͯ]', '', 'g'      -- strip combining marks first
               ),
               '[^a-zA-Z0-9]+', ' ', 'g'
             )
           )
         );
$$;

COMMENT ON FUNCTION public.wine_normalize_text(text) IS
  'SQL mirror of WineSubmissionsService.normalizeText. Keep the two in step — '
  'they key the same columns.';

CREATE OR REPLACE FUNCTION public.wine_signature_hash(
  p_producer      text,
  p_name          text,
  p_vintage       integer,
  p_country       text,
  p_region        text,
  p_grape_variety text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  -- Core sha256(bytea), not pgcrypto's digest(): pgcrypto is installed into
  -- the `extensions` schema here, and depending on a schema-qualified
  -- extension function inside an IMMUTABLE index-backing function is a
  -- portability trap. sha256() is built into Postgres 11+, and convert_to(...,
  -- 'UTF8') matches what Node hashes — createHash().update(string) encodes
  -- UTF-8 by default — so the two sides produce identical hex.
  SELECT encode(
    sha256(
      convert_to(
        concat_ws('|',
          public.wine_normalize_text(p_producer),
          public.wine_normalize_text(p_name),
          COALESCE(p_vintage::text, 'NV'),
          public.wine_normalize_text(p_country),
          public.wine_normalize_text(p_region),
          public.wine_normalize_text(p_grape_variety)
        ),
        'UTF8'
      )
    ),
    'hex'
  );
$$;

COMMENT ON FUNCTION public.wine_signature_hash(text,text,integer,text,text,text) IS
  'SQL mirror of WineSubmissionsService.buildSignature + hashSignature.';

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- 1. normalized_name / normalized_producer for every row. Unconditional: all
--    293 are NULL today, and a row whose value disagrees with the current
--    normalizer is a row the fallback cannot find.
UPDATE public.master_wine_library
SET normalized_name     = public.wine_normalize_text(name),
    normalized_producer = public.wine_normalize_text(producer);

-- 2. signature_hash for every row, under the primary_type-free contract above.
--    Recomputed rather than filled-if-null: the 92 existing hashes were
--    written under the old contract and would sit in a key space nothing else
--    reaches.
--
--    Collisions are expected and meaningful — two rows that hash alike are the
--    duplicates this migration exists to expose. The partial unique index
--    allows only one, so the most canonical row claims the hash (lowest
--    library_tier, then oldest) and the losers are left NULL and reported.
--    Silently dropping them would hide exactly the data-quality problem we are
--    here to surface.
WITH ranked AS (
  SELECT id,
         public.wine_signature_hash(producer, name, vintage, country, region, grape_variety) AS h,
         ROW_NUMBER() OVER (
           PARTITION BY public.wine_signature_hash(producer, name, vintage, country, region, grape_variety)
           ORDER BY library_tier NULLS LAST, created_at NULLS LAST, id
         ) AS rn
  FROM public.master_wine_library
)
UPDATE public.master_wine_library m
SET signature_hash = CASE WHEN r.rn = 1 THEN r.h ELSE NULL END
FROM ranked r
WHERE m.id = r.id;

-- 3. Indexes.
--
--    The exact fallback now keys on (name, producer, vintage) rather than
--    (name, producer): without vintage, "Duckhorn Merlot 2018" and the 2019
--    resolve to whichever row LIMIT 1 happened to return, so a restaurant
--    carrying both vintages had them collapse into one library wine
--    non-deterministically.
CREATE INDEX IF NOT EXISTS idx_mwl_name_producer_vintage
  ON public.master_wine_library (normalized_name, normalized_producer, vintage);

--    Trigram indexes back the fuzzy tier below. At 1000 restaurants that
--    lookup runs once per wine per menu — a 485-wine list is 485 lookups, and
--    a sequential scan per lookup is what turns a 30-second import into a
--    30-minute one.
CREATE INDEX IF NOT EXISTS idx_mwl_normalized_name_trgm
  ON public.master_wine_library USING gin (normalized_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_mwl_normalized_producer_trgm
  ON public.master_wine_library USING gin (normalized_producer gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Match RPC
-- ---------------------------------------------------------------------------
--
-- Why an RPC instead of three PostgREST round trips per wine:
-- resolveOrCreateLibraryWine ran an exact lookup, then a fallback lookup, then
-- an insert. On RL Restaurant's 485-wine list that is ~1,500 round trips for
-- one import. This collapses the read half into one indexed query and returns
-- ranked candidates so the caller picks by confidence rather than by luck.
--
-- Tiers, highest first:
--   100  exact signature
--    90  name + producer + same vintage
--    80  name + producer, one side has no vintage (NV, or menu omitted it)
--    70  name + producer, different vintage      -- caller decides
--    50+ trigram-similar name AND producer       -- score scales with similarity
--
-- The caller applies its own floor. Returning the near-misses rather than
-- filtering them here is deliberate: a 0.6-similarity candidate is the
-- difference between enriching an existing wine and paying for a web search.
CREATE OR REPLACE FUNCTION public.match_library_wine(
  p_name          text,
  p_producer      text DEFAULT NULL,
  p_vintage       integer DEFAULT NULL,
  p_country       text DEFAULT NULL,
  p_region        text DEFAULT NULL,
  p_grape_variety text DEFAULT NULL,
  p_min_similarity real DEFAULT 0.55,
  p_limit         integer DEFAULT 5
)
RETURNS TABLE (
  id            uuid,
  name          varchar,
  producer      varchar,
  vintage       integer,
  library_tier  integer,
  match_tier    integer,
  similarity    real
)
LANGUAGE sql
STABLE
AS $$
  WITH q AS (
    SELECT public.wine_normalize_text(p_name)     AS nn,
           public.wine_normalize_text(p_producer) AS np,
           public.wine_signature_hash(p_producer, p_name, p_vintage,
                                      p_country, p_region, p_grape_variety) AS sig
  )
  SELECT m.id, m.name, m.producer, m.vintage, m.library_tier,
         CASE
           WHEN m.signature_hash = q.sig                          THEN 100
           WHEN m.normalized_name = q.nn
            AND m.normalized_producer = q.np
            AND m.vintage IS NOT DISTINCT FROM p_vintage          THEN 90
           WHEN m.normalized_name = q.nn
            AND m.normalized_producer = q.np
            AND (m.vintage IS NULL OR p_vintage IS NULL)          THEN 80
           WHEN m.normalized_name = q.nn
            AND m.normalized_producer = q.np                      THEN 70
           ELSE 50 + (
             LEAST(similarity(m.normalized_name, q.nn),
                   similarity(m.normalized_producer, q.np)) * 20
           )::int
         END AS match_tier,
         LEAST(similarity(m.normalized_name, q.nn),
               similarity(m.normalized_producer, q.np)) AS similarity
  FROM public.master_wine_library m, q
  WHERE m.deleted_at IS NULL
    AND q.nn <> ''
    AND (
      m.signature_hash = q.sig
      OR (m.normalized_name = q.nn AND m.normalized_producer = q.np)
      OR (
        q.np <> ''
        AND m.normalized_name % q.nn
        AND m.normalized_producer % q.np
        AND similarity(m.normalized_name, q.nn) >= p_min_similarity
        AND similarity(m.normalized_producer, q.np) >= p_min_similarity
      )
    )
  -- Deterministic all the way down. The old LIMIT 1 had no ORDER BY at all, so
  -- which of three identical rows a menu linked to varied between imports.
  ORDER BY match_tier DESC, m.library_tier NULLS LAST, m.created_at NULLS LAST, m.id
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.match_library_wine IS
  'Ranked library candidates for one extracted wine. Tier >= 80 is safe to '
  'auto-link; 50-79 is a review/enrichment candidate.';

GRANT EXECUTE ON FUNCTION public.match_library_wine TO authenticated, service_role, anon;

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  total     integer;
  keyed     integer;
  collided  integer;
BEGIN
  SELECT count(*), count(signature_hash) INTO total, keyed
  FROM public.master_wine_library;
  collided := total - keyed;

  RAISE NOTICE 'wine match backfill: % row(s), % keyed, % collided', total, keyed, collided;

  IF collided > 0 THEN
    RAISE NOTICE
      'The % collided row(s) are duplicates that were invisible until now — '
      'they need a human merge decision. Find them with: SELECT id, producer, '
      'name, vintage FROM master_wine_library WHERE signature_hash IS NULL;',
      collided;
  END IF;
END $$;
