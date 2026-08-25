-- Recalibrate the data-quality checker for a library ten times bigger, and
-- fix the three rows whose name is only a year.
--
-- WHY THE MEDIUM SIGNAL NOW OVER-FIRES
--
-- The rule was "one producer value on more than five wines, none of which name
-- it". It was written against a 195-row library where the only instance was
-- pathological: 38 wines filed under "Antonio Facchin & Figli" whose names said
-- Chateau Latour, Vega Sicilia and Shafer — an importer stamping one producer
-- across a whole page.
--
-- At 2,443 rows it flags 104, and they are almost all correct data:
--
--     Domaine de la Romanee-Conti   8 wines   Romanee-Conti, La Tache, Richebourg
--     Gaja                          8 wines
--     Tissot                        9 wines
--
-- A serious producer sells several cuvees, and a cuvee name does not repeat the
-- estate. Five was never a meaningful boundary — it was simply below 38.
--
-- Raising it to 20 keeps the signal aimed at what it was built to catch (a
-- whole page misattributed) and stops it reporting every good producer in the
-- book. This is a heuristic for finding importer errors, not an audit of every
-- producer, and it should say so.
--
-- ALSO: EXCLUDE NON-WINES FROM THE VINTAGE CHECK
--
-- "Don Julio 1942" is a tequila whose product NAME is 1942. The high-confidence
-- rule reads that as a vintage contradicting a NULL vintage column and reports
-- it. The corpus load put 342 non-wine items in the library — amari, beers,
-- spirits — which are legitimately there, so the check has to know they exist.

CREATE OR REPLACE FUNCTION public.library_data_quality_issues(
  p_min_confidence text DEFAULT 'medium'
)
RETURNS TABLE (
  id             uuid,
  producer       varchar,
  name           varchar,
  vintage        integer,
  name_year      integer,
  source         varchar,
  confidence     text,
  reason         text
)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT m.id, m.producer, m.name, m.vintage, m.source,
           substring(m.name from '^\s*((?:19|20)\d{2})')::int AS name_year,
           -- A spirit or amaro has no vintage and often carries a number in its
           -- name; the vintage rule does not apply to it.
           coalesce((m.data_enrichment ->> 'is_wine')::boolean, true) AS is_wine,
           GREATEST(
             word_similarity(
               public.wine_strip_trade_words(m.normalized_producer),
               m.normalized_name),
             word_similarity(m.normalized_producer, m.normalized_name)
           ) AS producer_in_name_sim
    FROM public.master_wine_library m
    WHERE m.deleted_at IS NULL AND m.producer <> '' AND m.name <> ''
  ),
  with_group AS (
    SELECT b.*,
           count(*) FILTER (WHERE b.producer_in_name_sim < 0.6)
             OVER (PARTITION BY b.producer) AS absent_in_group,
           count(*) OVER (PARTITION BY b.producer) AS group_size
    FROM base b
  ),
  scored AS (
    SELECT w.*,
           CASE
             WHEN w.is_wine
              AND w.name_year IS NOT NULL
              AND w.name_year IS DISTINCT FROM w.vintage        THEN 'high'
             WHEN w.producer_in_name_sim < 0.6
              AND w.group_size > 20
              AND w.absent_in_group = w.group_size              THEN 'medium'
             WHEN w.producer_in_name_sim < 0.6
              AND w.name ~ '^\s*(19|20)\d{2}\s'                 THEN 'low'
           END AS confidence
    FROM with_group w
  )
  SELECT s.id, s.producer, s.name, s.vintage, s.name_year, s.source,
         s.confidence,
         CASE s.confidence
           WHEN 'high'   THEN format('vintage %s contradicts the year %s printed in the name',
                                     coalesce(s.vintage::text, 'NULL'), s.name_year)
           WHEN 'medium' THEN format('producer used on %s wines, none of which name it',
                                     s.group_size)
           ELSE                format('producer not found in name (similarity %.2f)',
                                     s.producer_in_name_sim)
         END
  FROM scored s
  WHERE s.confidence IS NOT NULL
    AND CASE p_min_confidence
          WHEN 'high'   THEN s.confidence = 'high'
          WHEN 'medium' THEN s.confidence IN ('high', 'medium')
          ELSE true
        END
  ORDER BY array_position(ARRAY['high','medium','low'], s.confidence),
           s.producer, s.name;
$$;

COMMENT ON FUNCTION public.library_data_quality_issues IS
  'Library rows whose fields contradict each other, ranked by what the signal '
  'proves. high = vintage disagrees with the year in the name (wines only). '
  'medium = one producer on 20+ wines that never name it, the signature of an '
  'importer stamping a whole page. Defaults to medium+.';

GRANT EXECUTE ON FUNCTION public.library_data_quality_issues
  TO authenticated, service_role;

-- The two first-growths whose `name` came back as nothing but the vintage.
-- For a single-estate Bordeaux there is no separable cuvee, so the convention
-- the extraction prompt already uses applies: name equals producer.
UPDATE public.master_wine_library m
SET name            = m.producer,
    vintage         = substring(m.name from '^\s*((?:19|20)\d{2})')::int,
    normalized_name = public.wine_normalize_text(m.producer),
    signature_hash  = public.wine_signature_hash(
                        m.producer, m.producer,
                        substring(m.name from '^\s*((?:19|20)\d{2})')::int,
                        m.country, m.region, m.grape_variety),
    updated_at      = now()
WHERE m.name ~ '^\s*(19|20)\d{2}\s*$'
  AND coalesce((m.data_enrichment ->> 'is_wine')::boolean, true)
  AND NOT EXISTS (
    SELECT 1 FROM public.master_wine_library x
    WHERE x.signature_hash = public.wine_signature_hash(
            m.producer, m.producer,
            substring(m.name from '^\s*((?:19|20)\d{2})')::int,
            m.country, m.region, m.grape_variety)
  );

DO $$
DECLARE h integer; md integer; l integer;
BEGIN
  SELECT count(*) FILTER (WHERE confidence='high'),
         count(*) FILTER (WHERE confidence='medium'),
         count(*) FILTER (WHERE confidence='low')
  INTO h, md, l FROM public.library_data_quality_issues('low');
  RAISE NOTICE 'library data quality: % high, % medium, % low', h, md, l;
END $$;
