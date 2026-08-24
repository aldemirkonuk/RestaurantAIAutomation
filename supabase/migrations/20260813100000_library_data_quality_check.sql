-- Surface library rows whose own fields contradict each other.
--
-- WHY
--
-- Adversarial precision testing of match_library_wine bottomed out at 0.9981,
-- and the single failing case turned out not to be a matcher defect at all:
--
--   library row: producer "Antonio Facchin & Figli"
--                name     "2010 Guiseppe Rinaldi Brunate Barolo"
--
-- Those name two different producers. 39 rows share that one producer value
-- while their names say Chateau Latour, Vega Sicilia, Shafer, Dal Forno
-- Romano — the wineops_basic_v1 seed importer appears to have applied one
-- producer across a whole page, and misaligned the vintage column with it.
--
-- Measured over the 195 long-form rows from that source (the ones whose name
-- begins with a year, meaning the importer glued the full printed designation
-- into `name`, so the producer SHOULD appear there):
--
--   45 (23.1%) have a producer that appears nowhere in their own name
--   33          have a vintage that disagrees with the year in their own name
--   33          have both, i.e. every vintage error is also a producer error
--
-- No matcher can be more correct than its inputs. This is the ceiling on
-- library accuracy until the seed is re-imported, and it is worth knowing
-- about rather than absorbing as unexplained match noise.
--
-- WHY THIS ONLY REPORTS
--
-- The vintage half is mechanically fixable — the year printed at the front of
-- the name is the source of truth. The producer half is not: recovering
-- "Guiseppe Rinaldi" from "2010 Guiseppe Rinaldi Brunate Barolo" means
-- guessing how many leading words are the producer, and guessing wrong writes
-- a false producer into the canonical library. So this function reports and
-- leaves the correction to a human or to a re-import.
--
-- Bare-style rows are excluded deliberately. A row named "CHARDONNAY" with
-- producer "CANUS" is correct and simply does not embed its producer; counting
-- those flags 96% of the sim seed and makes the number useless.

CREATE OR REPLACE FUNCTION public.library_data_quality_issues()
RETURNS TABLE (
  id             uuid,
  producer       varchar,
  name           varchar,
  vintage        integer,
  name_year      integer,
  source         varchar,
  producer_wrong boolean,
  vintage_wrong  boolean
)
LANGUAGE sql
STABLE
AS $$
  SELECT m.id, m.producer, m.name, m.vintage,
         substring(m.name from '^\s*((?:19|20)\d{2})')::int,
         m.source,
         NOT EXISTS (
           SELECT 1
           FROM unnest(string_to_array(
                  public.wine_normalize_text(
                    public.wine_strip_trade_words(m.producer)), ' ')) AS w
           WHERE length(w) > 2
             AND public.wine_normalize_text(m.name) LIKE '%' || w || '%'
         ),
         substring(m.name from '^\s*((?:19|20)\d{2})')::int
           IS DISTINCT FROM m.vintage
  FROM public.master_wine_library m
  WHERE m.deleted_at IS NULL
    AND m.producer <> '' AND m.name <> ''
    -- long-form rows only: the name carries the full printed designation
    AND m.name ~ '^\s*(19|20)\d{2}\s'
    AND (
      NOT EXISTS (
        SELECT 1
        FROM unnest(string_to_array(
               public.wine_normalize_text(
                 public.wine_strip_trade_words(m.producer)), ' ')) AS w
        WHERE length(w) > 2
          AND public.wine_normalize_text(m.name) LIKE '%' || w || '%'
      )
      OR substring(m.name from '^\s*((?:19|20)\d{2})')::int
           IS DISTINCT FROM m.vintage
    )
  ORDER BY m.source, m.producer, m.name;
$$;

COMMENT ON FUNCTION public.library_data_quality_issues IS
  'Library rows whose producer or vintage contradicts their own name. Reports '
  'only — the producer half cannot be corrected without guessing how many '
  'leading words of the name are the producer.';

GRANT EXECUTE ON FUNCTION public.library_data_quality_issues
  TO authenticated, service_role;

DO $$
DECLARE
  bad_producer integer;
  bad_vintage  integer;
BEGIN
  SELECT count(*) FILTER (WHERE producer_wrong),
         count(*) FILTER (WHERE vintage_wrong)
  INTO bad_producer, bad_vintage
  FROM public.library_data_quality_issues();

  RAISE NOTICE
    'library data quality: % row(s) with a contradicting producer, % with a '
    'contradicting vintage. Inspect with: SELECT * FROM '
    'library_data_quality_issues();', bad_producer, bad_vintage;
END $$;
