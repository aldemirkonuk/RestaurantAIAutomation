-- Backfill the match keys that make menu-import wine matching work at all.
--
-- WHY THIS EXISTS
--
-- WineSubmissionsService.resolveOrCreateLibraryWine() matches an extracted
-- wine against master_wine_library on exactly two things:
--   1. signature_hash  (exact)
--   2. normalized_name + normalized_producer  (fallback)
-- and creates a provisional tier-3 wine when neither hits.
--
-- Measured on the live library: 201 of 293 wines have BOTH columns NULL. Those
-- wines are unmatchable by construction — every menu import that references
-- one creates a duplicate provisional row instead of linking to it. The 92
-- that do carry a signature_hash are the synthetic sim-seeded wines, so in
-- practice matching has never worked for real inventory.
--
-- This backfills both keys for existing rows using the same normalization the
-- TypeScript path uses, so old and new rows land in the same key space.
--
-- Normalization contract (mirrors WineSubmissionsService.normalizeText):
--   NFD-decompose -> strip diacritics -> non-alphanumeric to space -> trim ->
--   lowercase
--
-- Signature contract (mirrors buildSignature as called by
-- resolveOrCreateLibraryWine — note it passes NO primaryType, so that slot is
-- the empty string):
--   producer|name|vintage-or-NV|country|region||grape_variety
--   then sha256, hex-encoded.

CREATE EXTENSION IF NOT EXISTS unaccent;

-- Mirror of the TS normalizeText(). IMMUTABLE so it can back an index.
-- unaccent() is itself only STABLE, so it is wrapped rather than called
-- directly in an index expression.
CREATE OR REPLACE FUNCTION public.wine_normalize_text(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(
           btrim(
             regexp_replace(
               public.unaccent('public.unaccent'::regdictionary, coalesce(value, '')),
               '[^a-zA-Z0-9]+', ' ', 'g'
             )
           )
         );
$$;

-- Mirror of buildSignature() + hashSignature() for the resolve path.
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
  SELECT encode(
    digest(
      concat_ws('|',
        public.wine_normalize_text(p_producer),
        public.wine_normalize_text(p_name),
        COALESCE(p_vintage::text, 'NV'),
        public.wine_normalize_text(p_country),
        public.wine_normalize_text(p_region),
        '',                                    -- primaryType: not passed on the resolve path
        public.wine_normalize_text(p_grape_variety)
      ),
      'sha256'
    ),
    'hex'
  );
$$;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- 1. normalized_name / normalized_producer for every row missing them.
UPDATE public.master_wine_library
SET normalized_name     = public.wine_normalize_text(name),
    normalized_producer = public.wine_normalize_text(producer)
WHERE normalized_name IS NULL
   OR normalized_producer IS NULL;

-- 2. signature_hash where absent. Conflicts are possible: two existing rows
--    can normalize to the same signature (genuine duplicates that were never
--    detectable before). Fill only the rows whose computed hash is still
--    unclaimed, so the partial unique index cannot be violated; leftovers are
--    reported below for manual merge rather than silently dropped.
WITH candidate AS (
  SELECT id,
         public.wine_signature_hash(producer, name, vintage, country, region, grape_variety) AS h,
         ROW_NUMBER() OVER (
           PARTITION BY public.wine_signature_hash(producer, name, vintage, country, region, grape_variety)
           ORDER BY created_at NULLS LAST, id
         ) AS rn
  FROM public.master_wine_library
  WHERE signature_hash IS NULL
)
UPDATE public.master_wine_library m
SET signature_hash = c.h
FROM candidate c
WHERE m.id = c.id
  AND c.rn = 1
  AND NOT EXISTS (
    SELECT 1 FROM public.master_wine_library x WHERE x.signature_hash = c.h
  );

-- 3. Trigram index on the normalized fields so the fuzzy fallback (and any
--    future similarity search) does not table-scan 293+ rows per extracted
--    wine. At 1000 restaurants that lookup runs on every wine of every menu.
CREATE INDEX IF NOT EXISTS idx_mwl_normalized_name_trgm
  ON public.master_wine_library USING gin (normalized_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_mwl_normalized_producer_trgm
  ON public.master_wine_library USING gin (normalized_producer gin_trgm_ops);

-- Composite index backing the exact name+producer fallback lookup.
CREATE INDEX IF NOT EXISTS idx_mwl_normalized_name_producer
  ON public.master_wine_library (normalized_name, normalized_producer);

-- ---------------------------------------------------------------------------
-- Report: rows still unmatchable after the backfill (collided signatures).
-- These are pre-existing duplicates that were invisible until now — they need
-- a human merge decision, so they are surfaced rather than auto-resolved.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  remaining integer;
BEGIN
  SELECT count(*) INTO remaining
  FROM public.master_wine_library
  WHERE signature_hash IS NULL;

  IF remaining > 0 THEN
    RAISE NOTICE
      'wine match backfill: % row(s) still without signature_hash — these '
      'collide with an existing signature and are likely duplicates needing a '
      'manual merge. Find them with: SELECT id, producer, name, vintage FROM '
      'master_wine_library WHERE signature_hash IS NULL;', remaining;
  END IF;
END $$;
