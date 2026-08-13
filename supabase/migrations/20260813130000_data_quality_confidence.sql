-- Give the data-quality check a confidence level, and stop it crying wolf.
--
-- WHAT THE FIRST VERSION GOT WRONG
--
-- It flagged any long-form row whose producer did not appear in its own name,
-- and reported 45. Repairing the genuinely corrupt rows left 6 behind, and all
-- 6 are correct data:
--
--   Sevilen Wines        "2022 Aegean Sunset Dry Rose Aegean Coast Turkey"
--   Domaine Sainte Marie "2024 Vie Vette Provence France"
--   Spyros Hatziyiannis  "2023 Hatziyannis Assyrtiko Santorini GREECE"
--
-- The first two are ordinary: a cuvee name need not repeat its producer. The
-- third is a spelling variant — "Hatziyannis" against "Hatziyiannis" — which
-- an exact substring test cannot see but a trigram comparison can.
--
-- So the original 45 was an overstatement. The real corruption was 41 rows
-- across two producer values, and it is now repaired (wine_repair_log).
--
-- THE SIGNALS, RANKED BY WHAT THEY ACTUALLY PROVE
--
--   high   vintage disagrees with the year printed at the front of the name.
--          On a wine list that year IS the vintage, so a disagreement is a
--          misaligned column. Zero false positives observed across 195 rows —
--          every one of the 33 was genuine.
--
--   medium one producer value spread across more than five wines, none of
--          which name it. That is an importer applying one producer to a whole
--          page, which is exactly what happened here (38 wines under "Antonio
--          Facchin & Figli" named Chateau Latour, Vega Sicilia, Shafer...).
--
--   low    a single wine whose producer is absent from its name. Usually
--          nothing — most cuvee names do not repeat the producer.
--
-- The producer test now uses word_similarity rather than LIKE, so spelling
-- variants stop registering as contradictions.

DROP FUNCTION IF EXISTS public.library_data_quality_issues();

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
           -- Fuzzy, so "Hatziyannis" matches "Hatziyiannis". The producer is
           -- "present" if its distinctive words appear anywhere in the name.
           GREATEST(
             word_similarity(
               public.wine_strip_trade_words(m.normalized_producer),
               m.normalized_name),
             word_similarity(
               m.normalized_producer, m.normalized_name)
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
             WHEN w.name_year IS NOT NULL
              AND w.name_year IS DISTINCT FROM w.vintage        THEN 'high'
             WHEN w.producer_in_name_sim < 0.6
              AND w.group_size > 5
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
  'Library rows whose fields contradict each other, ranked by how much the '
  'signal actually proves. Defaults to medium+; pass ''low'' to include '
  'single rows whose producer is simply not repeated in the name, which is '
  'usually normal.';

GRANT EXECUTE ON FUNCTION public.library_data_quality_issues
  TO authenticated, service_role;

DO $$
DECLARE h integer; m integer; l integer;
BEGIN
  SELECT count(*) FILTER (WHERE confidence = 'high'),
         count(*) FILTER (WHERE confidence = 'medium'),
         count(*) FILTER (WHERE confidence = 'low')
  INTO h, m, l
  FROM public.library_data_quality_issues('low');
  RAISE NOTICE 'library data quality: % high, % medium, % low', h, m, l;
END $$;
