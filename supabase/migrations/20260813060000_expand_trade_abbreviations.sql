-- Expand the trade abbreviations menus actually print.
--
-- THE MEASUREMENT
--
-- Probing every library producer that starts with an abbreviable trade word,
-- rewritten the way a menu prints it, auto-link recall was 0 of 27:
--
--     dom. faiveley            vs Domaine Faiveley             conf   0  (no candidate)
--     dom. de la mandeliere    vs Domaine de la Mandelière     conf  75
--     ch. clerc milon          vs Chateau Clerc Milon          conf  76
--     wgt. schloss gobelsburg  vs Weingut Schloss Gobelsburg   conf  73
--     ten. di arceno           vs Tenuta di Arceno             conf  62
--     az. agr. gini            vs Azienda Agricola Gini        conf   0  (no candidate)
--
-- Every one below the 85 auto-link floor, so every one silently created a
-- duplicate. Trigram similarity is the wrong tool for a prefix truncation:
-- "dom" against "domaine" shares two trigrams out of five and the score
-- collapses, no matter how exactly the rest of the name agrees. Lowering the
-- producer gate to reach 62 would admit "chateau musar" vs "chateau de
-- bligny" (0.571) and every other shared-trade-word false positive.
--
-- So this is fixed where it is actually broken — in normalization, not in the
-- threshold. "dom." and "domaine" are the same word, and the normalizer should
-- say so.
--
-- WHY THE PERIOD IS REQUIRED
--
-- Bare "dom" is not an abbreviation: Dom Pérignon is a wine, and expanding it
-- to "Domaine Pérignon" would invent a producer that does not exist. Every
-- pattern below requires the period a menu actually prints, so "Dom Perignon"
-- passes through untouched while "Dom. Mandelière" expands.
--
-- ORDER OF OPERATIONS
--
-- Expansion has to happen while the period is still there, which means it must
-- run before non-alphanumerics become spaces, and it needs lowercase input to
-- match case-insensitively. lower() therefore moves earlier in the chain. That
-- is equivalent for every input without an abbreviation — lowercasing ASCII
-- does not change which characters are alphanumeric — so nothing else shifts.
--
-- Multi-token patterns run first: "az. agr." must expand as a unit before
-- anything tries to treat "az." alone.
--
-- The TypeScript mirror in WineSubmissionsService.normalizeText carries the
-- identical list, and wine-submissions.service.spec.ts fails on drift.

CREATE OR REPLACE FUNCTION public.wine_normalize_text(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
        lower(
          regexp_replace(
            normalize(coalesce(value, ''), NFD),
            -- Shared diacritic class. Mirrored verbatim in
            -- WineSubmissionsService.DIACRITICS — change both together.
            '[̀-ͯ᪰-᫿᷀-᷿︠-︯^`¨¯´·¸ʰ-˿ʹ͵ͺ΄΅]', '', 'g'
          )
        ),
        '\maz\.\s*agr\.\s*', 'azienda agricola ', 'g'),
        '\mdom\.\s*',        'domaine ',          'g'),
        '\mch\.\s*',         'chateau ',          'g'),
        '\mcht\.\s*',        'chateau ',          'g'),
        '\mbod\.\s*',        'bodegas ',          'g'),
        '\mwgt\.\s*',        'weingut ',          'g'),
        '\mten\.\s*',        'tenuta ',           'g'),
        '\mfatt\.\s*',       'fattoria ',         'g'),
        '\mcant\.\s*',       'cantina ',          'g'),
        '\mmarch\.\s*',      'marchesi ',         'g'),
        '\mste\.\s*',        'sainte ',           'g'),
        '\mst\.\s*',         'saint ',            'g'),
        '\mmt\.\s*',         'monte ',            'g'),
      -- everything that is not a letter or digit becomes a single space
      '[^a-z0-9]+', ' ', 'g')
  );
$$;

COMMENT ON FUNCTION public.wine_normalize_text(text) IS
  'SQL mirror of WineSubmissionsService.normalizeText, including trade-'
  'abbreviation expansion. Parity is enforced by '
  'wine-submissions.service.spec.ts, which runs both over the live library.';

-- Both stored keys change for any row containing an abbreviation, so both are
-- recomputed. signature_hash is derived from the normalizer, so it moves too;
-- recomputing it keeps the column in the same key space the matcher queries.
UPDATE public.master_wine_library
SET normalized_name     = public.wine_normalize_text(name),
    normalized_producer = public.wine_normalize_text(producer);

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

DO $$
DECLARE
  collided integer;
BEGIN
  SELECT count(*) INTO collided
  FROM public.master_wine_library WHERE signature_hash IS NULL;
  IF collided > 0 THEN
    RAISE NOTICE
      'trade-abbreviation expansion revealed % further duplicate(s) — merge '
      'with SELECT * FROM merge_library_wines(keeper, loser, false);', collided;
  ELSE
    RAISE NOTICE 'trade-abbreviation expansion: no new duplicates';
  END IF;
END $$;
