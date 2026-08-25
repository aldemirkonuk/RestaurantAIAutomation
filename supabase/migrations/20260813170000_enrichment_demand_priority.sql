-- Spend the research budget on wines that actually matter.
--
-- THE ARITHMETIC THAT FORCES THIS
--
-- Research is billed per record ($0.04 ceiling) under a $5.00/day cap, i.e.
-- ~125 records/day. At 1000 restaurants carrying ~300 wines each that is
-- 300,000 records:
--
--     300,000 x $0.04           = $12,000
--     300,000 / 125 per day     = 6.6 YEARS to clear the backlog
--
-- The obvious hope is that restaurants carry the same wines and the library
-- amortises the work. Measured on four real extracted lists, they do not:
--
--     cross-menu bypass rate     0.0%, 0.5%, 2.0%
--     wines per producer         1.3
--     producers shared across 4 menus   18 of 419
--
-- Independent wine lists barely overlap — that is the point of a wine list.
-- So caching, producer-level rollups and dedup cannot close a 6.6-year gap;
-- they were never going to. (Re-importing the SAME menu does bypass at 100%,
-- which is what makes menu updates free, but that is a different saving.)
--
-- What actually closes it is not researching wines nobody sells. A 300-bottle
-- list has a long tail that moves once a year, and a fully-enriched tasting
-- note for a wine with no stock and no sales is spend with no return.
--
--     top 30% by demand     90,000 records   $3,600   2.0 years
--     top 15% by demand     45,000 records   $1,800   1.0 years
--
-- So eligibility is now ordered by demand first. Nothing is excluded — a wine
-- with no stock still gets researched eventually — but with a hard daily cap,
-- the ORDER is the budget, and the wine a sommelier was asked about this week
-- should not wait behind 200 bottles nobody has poured.
--
-- Demand is read from stock and sales, both of which are maintained by the
-- inventory ledger rather than being a separate signal to keep in sync.

-- Dropped rather than replaced: the return type gains demand_score, and
-- Postgres will not change a function's OUT columns in place.
DROP FUNCTION IF EXISTS public.research_eligible_submissions(integer, integer);

CREATE OR REPLACE FUNCTION public.research_eligible_submissions(
  p_limit          integer DEFAULT 25,
  p_cooldown_days  integer DEFAULT 7
)
RETURNS TABLE (
  submission_id  uuid,
  master_wine_id uuid,
  library_tier   integer,
  reason         text,
  demand_score   integer
)
LANGUAGE sql
STABLE
AS $$
  WITH candidate AS (
    SELECT s.id AS submission_id,
           m.id AS master_wine_id,
           m.library_tier,
           (m.primary_type IS NULL OR m.primary_type = 'unknown') AS is_stub,
           s.last_research_run_at,
           s.created_at,
           -- Demand, highest first:
           --   4  sold in the last 30 days
           --   3  has sold at some point
           --   2  in stock now
           --   1  carried but empty
           --   0  not in any restaurant's inventory
           coalesce((
             SELECT max(
               CASE
                 WHEN ri.sales_velocity_30d > 0                  THEN 4
                 WHEN ri.last_sold_at IS NOT NULL                THEN 3
                 WHEN ri.stock_live > 0                          THEN 2
                 ELSE 1
               END)
             FROM public.restaurant_inventory ri
             WHERE ri.master_wine_id = m.id
           ), 0) AS demand_score
    FROM public.master_wine_library_submissions s
    JOIN public.master_wine_library m ON m.id = s.matched_master_id
    WHERE m.deleted_at IS NULL
      AND (m.library_tier = 3 OR m.primary_type IS NULL OR m.primary_type = 'unknown')
      AND (
        s.last_research_run_at IS NULL
        OR s.last_research_run_at < now() - make_interval(days => p_cooldown_days)
      )
      AND coalesce(s.auto_blocked, false) = false
  )
  SELECT c.submission_id, c.master_wine_id, c.library_tier,
         CASE WHEN c.is_stub THEN 'provisional_stub' ELSE 'cooldown_elapsed' END,
         c.demand_score
  FROM candidate c
  ORDER BY c.demand_score DESC,
           c.is_stub DESC,
           (c.last_research_run_at IS NULL) DESC,
           c.created_at
  LIMIT greatest(p_limit, 0);
$$;

COMMENT ON FUNCTION public.research_eligible_submissions IS
  'Submissions worth enriching, ordered by demand (sold recently > has sold > '
  'in stock > carried > not carried), then emptiest, then oldest. With a hard '
  'daily spend cap the sort order IS the budget: at 1000 restaurants the full '
  'backlog is 6.6 years of cap, so what gets researched first is the whole '
  'decision.';

GRANT EXECUTE ON FUNCTION public.research_eligible_submissions
  TO service_role, authenticated;

-- Supports the demand lookup, which otherwise scans restaurant_inventory once
-- per candidate submission on every dispatch tick.
CREATE INDEX IF NOT EXISTS idx_ri_master_wine_demand
  ON public.restaurant_inventory (master_wine_id)
  INCLUDE (stock_live, sales_velocity_30d, last_sold_at);
