-- Pick which submissions are worth spending a web search on.
--
-- WHY THIS EXISTS
--
-- The existing /api/v1/research/trigger batch mode selects "any submission
-- with last_research_run_at IS NULL". That was defensible when nothing matched
-- and every submission was a fresh stub. It is not defensible now: since the
-- matcher works, a menu import creates a submission for EVERY wine, including
-- the ones that auto-linked to a fully-populated canonical row. Enriching
-- those spends real money re-deriving facts the library already holds.
--
-- Research is billed per record ($0.04 ceiling, $5/day cap), so selection is
-- the cost control. The wines that actually need enrichment are the ones
-- matching could not resolve: provisional rows created by the import path,
-- which carry library_tier = 3 and primary_type = 'unknown' precisely because
-- nothing was known about them.
--
-- ORDERING IS THE BUDGET
--
-- With a daily cap, whatever sorts first is what gets researched. So the order
-- is: emptiest wines first (a stub with no primary_type gains more from one
-- search than a row missing only its appellation), then never-researched
-- before re-researched, then oldest. A restaurant that imported a menu this
-- morning sees its unknown wines filled before the system revisits anything.

CREATE OR REPLACE FUNCTION public.research_eligible_submissions(
  p_limit          integer DEFAULT 25,
  p_cooldown_days  integer DEFAULT 7
)
RETURNS TABLE (
  submission_id  uuid,
  master_wine_id uuid,
  library_tier   integer,
  reason         text
)
LANGUAGE sql
STABLE
AS $$
  SELECT s.id,
         m.id,
         m.library_tier,
         CASE
           WHEN m.primary_type IS NULL OR m.primary_type = 'unknown'
             THEN 'provisional_stub'
           ELSE 'cooldown_elapsed'
         END
  FROM public.master_wine_library_submissions s
  JOIN public.master_wine_library m ON m.id = s.matched_master_id
  WHERE m.deleted_at IS NULL
    -- Only wines the matcher could not resolve to something already known.
    AND (m.library_tier = 3 OR m.primary_type IS NULL OR m.primary_type = 'unknown')
    -- Never researched, or past the cooldown.
    AND (
      s.last_research_run_at IS NULL
      OR s.last_research_run_at < now() - make_interval(days => p_cooldown_days)
    )
    -- auto_blocked is a governance decision; do not spend money overruling it.
    AND coalesce(s.auto_blocked, false) = false
  ORDER BY
    (m.primary_type IS NULL OR m.primary_type = 'unknown') DESC,
    (s.last_research_run_at IS NULL) DESC,
    s.created_at
  LIMIT greatest(p_limit, 0);
$$;

COMMENT ON FUNCTION public.research_eligible_submissions IS
  'Submissions worth enriching: those whose matched library wine is still a '
  'provisional stub. Emptiest and never-researched first, because the daily '
  'budget cap means sort order decides what actually gets researched.';

GRANT EXECUTE ON FUNCTION public.research_eligible_submissions
  TO service_role, authenticated;

-- Supports the join + filter above. Without it this is a sequential scan of
-- the submissions table on every dispatch tick.
CREATE INDEX IF NOT EXISTS idx_mwls_research_eligibility
  ON public.master_wine_library_submissions (matched_master_id, last_research_run_at)
  WHERE matched_master_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mwl_provisional
  ON public.master_wine_library (library_tier)
  WHERE deleted_at IS NULL AND library_tier = 3;
