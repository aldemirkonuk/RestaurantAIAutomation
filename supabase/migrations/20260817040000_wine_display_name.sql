-- Plan §1 (BEVERAGE_CATALOGUE_PLAN.md): derived display_name.
--
-- Three naming conventions coexist today: 198 rows lead with a year, 55 end
-- in the wine's own country written in ALLCAPS, 409 embed the producer
-- inside `name`. The same wine reads "2016 Gravner Ribolla
-- Friuli-Venezia Giulia" on one row and "RIBOLLA GIALLA" on another. The 22
-- groups this makes look like duplicates are not duplicates -- see plan §0 --
-- they are vintage variants that read identically because the UI renders
-- {wine.name} alone.
--
-- `name` itself is NOT touched. It feeds normalized_name, a match key, and
-- rewriting it toward a verbose style would reintroduce the exact bare-vs-
-- verbose split the matcher was built to survive. This adds a DERIVED
-- column instead: composition without mutation.
--
-- The suppression logic (does the name already say the producer?) mirrors
-- wineDisplayLabel() in apps/api-gateway/src/vendor-intel/wine-identity.ts
-- -- same algorithm, not literally the same code, because that function's
-- composition order (producer, name, vintage) and lack of a region slot
-- don't match this column's spec (vintage, producer, cuvee, region) or its
-- name-cleaning step. Reuses this schema's OWN normalizer
-- (wine_normalize_text) and OWN trade-word stripper (wine_strip_trade_words)
-- rather than porting the TS TRADE_WORDS set a third time -- two lists
-- already exist (TS TRADE_WORDS, this function's embedded regex); a third,
-- SQL-side and hand-copied, is exactly the "one fact, two homes" defect this
-- plan spent its whole build-out avoiding elsewhere. The one traceable
-- divergence from wine_strip_trade_words' own contract: it falls back to
-- the ORIGINAL string when every word is a trade word (correct for ITS job,
-- matching), which means an all-generic producer ("The Wine Company") is
-- treated as if it had distinctive words here. Rare in this data, and the
-- failure direction is a false SPLIT (producer shown when it technically
-- could be suppressed) -- not a wrong suppression, so it fails toward the
-- safe side of that trade-off, same principle as §3.4's identity key.

CREATE OR REPLACE FUNCTION public.wine_display_name(
  p_vintage  integer,
  p_producer text,
  p_name     text,
  p_region   text,
  p_country  text DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  WITH cleaned AS (
    SELECT
      -- Strip a leading 4-digit year: "2016 Ribolla" -> "Ribolla". Measured
      -- 198 rows this way, so this is the common case, not the exception.
      regexp_replace(
        -- Strip a trailing occurrence of the row's OWN country, case-
        -- insensitive, alpha-only (so "Friuli-Venezia Giulia," or "USA"
        -- punctuation doesn't block the match) -- and ONLY the country,
        -- never a generic trailing-ALLCAPS heuristic. An early draft of
        -- this used "any trailing run of capitalized words" and it
        -- destroyed short all-caps names ("BORDEAUX BLEND" -> "BORDEAUX",
        -- "BLANC DE NOIRS" -> "BLANC") that have nothing to do with a
        -- country suffix -- caught by testing against real rows before
        -- this shipped, not asserted.
        btrim(coalesce(p_name, '')),
        '(?i)\s+' || regexp_replace(coalesce(p_country, ''), '[^A-Za-z ]', '', 'g') || '\s*$',
        ''
      ) AS name_stage1
  ),
  cleaned2 AS (
    SELECT regexp_replace(name_stage1, '^\s*(19|20)\d{2}\s+', '') AS name_clean
    FROM cleaned
  ),
  norm AS (
    SELECT
      c.name_clean,
      public.wine_normalize_text(c.name_clean) AS nn,
      public.wine_normalize_text(p_producer)   AS np,
      public.wine_normalize_text(p_region)     AS nr
    FROM cleaned2 c
  ),
  words AS (
    SELECT
      n.*,
      array_remove(string_to_array(n.nn, ' '), '') AS name_words,
      array_remove(
        string_to_array(public.wine_strip_trade_words(n.np), ' '), ''
      ) AS producer_distinctive,
      array_remove(string_to_array(n.nr, ' '), '') AS region_words
    FROM norm n
  ),
  decide AS (
    SELECT
      w.name_clean,
      -- Suppress producer only when it has at least one distinctive word
      -- AND every one of them already appears in the name -- exact mirror
      -- of wineDisplayLabel's nameAlreadySaysProducer.
      (cardinality(w.producer_distinctive) > 0
         AND w.producer_distinctive <@ w.name_words) AS suppress_producer,
      -- Same idea for region: word-subset containment, not substring, so
      -- "Napa" inside "Napa Valley" still counts.
      (cardinality(w.region_words) > 0
         AND w.region_words <@ w.name_words) AS suppress_region
    FROM words w
  )
  SELECT nullif(
    btrim(regexp_replace(
      concat_ws(' ',
        nullif(p_vintage::text, ''),
        CASE WHEN NOT d.suppress_producer THEN nullif(btrim(p_producer), '') END,
        nullif(d.name_clean, ''),
        -- 'Unknown' is this schema's sentinel for "not populated" (340
        -- region rows, 252 country rows carry it literally) -- treated as
        -- absent, or every one of those rows would display the word
        -- "Unknown" as if it were a real place.
        CASE WHEN NOT d.suppress_region AND lower(btrim(coalesce(p_region, ''))) <> 'unknown'
             THEN nullif(btrim(p_region), '') END
      ),
      '\s+', ' ', 'g'
    )),
    ''
  )
  FROM decide d;
$function$;

COMMENT ON FUNCTION public.wine_display_name IS
  'Derived full descriptive name: "<vintage> <producer> <cuvee> <region>", '
  'suppressing producer/region when the cuvee already says them. Never '
  'rewrites name/producer/region themselves -- those still feed the match '
  'key. See plan §1 and this function''s header comment for the algorithm '
  'and its one known divergence from wine_strip_trade_words'' contract.';
