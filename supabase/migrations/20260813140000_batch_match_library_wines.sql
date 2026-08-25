-- Match a whole menu in one round trip instead of one per wine.
--
-- THE COST
--
-- resolveOrCreateLibraryWine calls match_library_wine once per extracted wine.
-- Measured against this project's pooler, each call is ~235ms median / ~320ms
-- p95, almost all of it network. RL Restaurant extracts 485 wines:
--
--     sequential            485 x 235ms  = 114s
--     at concurrency 8                   = ~14s
--     one batched call                   = ~1s
--
-- The query itself is not the problem — EXPLAIN shows index scans on all three
-- branches and single-digit milliseconds. The round trips are the problem, and
-- no amount of index work fixes those.
--
-- WHY IT RETURNS ONE ROW PER INPUT
--
-- The per-wine function returns ranked candidates so a reviewer can see near
-- misses. The batch form is for the import path, which only needs the decision:
-- link, review, or create. Returning five candidates for each of 485 wines
-- would be 2,425 rows to ship and re-sort client-side for no gain. The best
-- candidate's confidence is enough to route, and a reviewer can call the
-- per-wine function for the one wine they are actually looking at.
--
-- Ordinality preserves input order so the caller can zip results back onto its
-- array without matching on name — names are not unique within a menu (the
-- same wine appears by-the-glass and by-the-bottle), so zipping on position is
-- the only correct join.

CREATE OR REPLACE FUNCTION public.match_library_wines_batch(
  p_wines            jsonb,
  p_min_name_sim     real DEFAULT 0.60,
  p_min_producer_sim real DEFAULT 0.70
)
RETURNS TABLE (
  input_index    integer,
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
  SELECT (w.ord - 1)::int AS input_index,
         b.id, b.name, b.producer, b.vintage, b.library_tier,
         b.confidence, b.name_sim, b.producer_sim
  FROM jsonb_array_elements(p_wines) WITH ORDINALITY AS w(item, ord)
  LEFT JOIN LATERAL (
    SELECT *
    FROM public.match_library_wine(
      w.item ->> 'name',
      w.item ->> 'producer',
      -- A vintage arrives as "2019", 2019, "NV" or absent depending on the
      -- extractor. Anything that is not four digits becomes NULL rather than
      -- raising, because one unparseable vintage must not fail a 485-wine
      -- import.
      CASE WHEN (w.item ->> 'vintage') ~ '^\s*(19|20)\d{2}'
           THEN substring(w.item ->> 'vintage' from '((?:19|20)\d{2})')::int
      END,
      w.item ->> 'country',
      w.item ->> 'region',
      w.item ->> 'grape_variety',
      p_min_name_sim,
      p_min_producer_sim,
      1
    )
  ) b ON true
  ORDER BY w.ord;
$$;

COMMENT ON FUNCTION public.match_library_wines_batch IS
  'Best library candidate for each wine in a JSON array, one row per input, in '
  'input order. For the import path; use match_library_wine for the ranked '
  'candidate list behind a single review decision.';

GRANT EXECUTE ON FUNCTION public.match_library_wines_batch
  TO authenticated, service_role, anon;
