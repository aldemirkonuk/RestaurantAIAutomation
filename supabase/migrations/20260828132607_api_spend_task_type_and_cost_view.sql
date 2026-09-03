-- ============================================================================
-- Track A2 (ADR 0039) — one grain for spend: api_spend.task_type, and one
-- cost-per-task view that reads BOTH ledgers without double-counting.
-- ============================================================================
--
-- THE DEFECT (OD-29)
-- ------------------
-- The two spend ledgers differ in GRAIN, not in value. `SpendLogger.log()`
-- writes both of them from a single call and stamps `task_type` into the NF
-- row's `context` — but its `api_spend` INSERT still carried only the original
-- seven columns (services/agent-orchestrator/services/spend_logger.py). So
-- `nf_a.cost_per_task` is answerable from `neural_footprint_event` and NOT
-- answerable from the primary ledger: `api_spend` can say what a MODEL cost,
-- never what a TASK cost. `aio-model-routing` PRODUCES that metric and Finance
-- CONSUMES it (ADR 0036); both read the view below, so the metric must exist
-- as a named object rather than as a query each side hand-assembles — the same
-- standard 20260824153600_nf_a_readout.sql was written to.
--
-- Two changes, in dependency order: the column, then the view over it.
--
--
-- ---------------------------------------------------------------------------
-- 1) THE COLUMN — nullable, and NOT backfilled.
-- ---------------------------------------------------------------------------
--
-- NULLABLE, per ADR 0016 (locked): a ledger that cannot say "unknown" reports
-- the wrong number and nothing in it complains. That ADR is why `cost_usd` is
-- nullable here (OD-61) and why `neural_footprint_event.outcome` is nullable
-- (ADR 0008); the same rule decides this column. A NOT NULL default of
-- `'unknown'` would be the sentinel-value option ADR 0016 rejected outright —
-- the same defect with a longer fuse, because a reader that does not know the
-- convention gets a value that looks like a real task type.
--
-- NOT BACKFILLED, deliberately. Every api_spend row written before this
-- migration gets NULL and keeps it. Nobody recorded what task those rows served,
-- and deriving one from `model` or `provider` would manufacture an answer that
-- reads exactly like a measured one — the thing ADR 0020 forbids. The gap is
-- documented rather than guessed, and it is visible in the view: the NULL
-- task_type bucket on `source = 'api_spend'` IS the pre-instrumentation history,
-- not a task type called "unknown".
--
-- No index. The view is a full aggregate over both tables with no filter, so an
-- index on task_type cannot be used by it, and api_spend held 185 rows at the
-- OD-61 audit three days before this (20260825160000's header) — a seq scan is
-- the plan at that size regardless. Add one when a real filtered per-task query
-- exists, not before (CLAUDE.md §0.1).
--
-- ADD COLUMN with no DEFAULT is catalog-only in PG11+: no table rewrite, the
-- ACCESS EXCLUSIVE lock is held for the catalog update alone.
--
-- Readers audited before writing this — all three name their columns explicitly
-- (`.select("cost_usd")`), so none of them sees the new column and none changes
-- behaviour:
--   jobs/spend_tasks.py:47          monthly per-provider spend
--   api/onboarding_routes.py:82     per-restaurant extraction cap
--   jobs/research_tasks.py:1389     research daily budget gate
-- ---------------------------------------------------------------------------

ALTER TABLE public.api_spend ADD COLUMN IF NOT EXISTS task_type text NULL;

COMMENT ON COLUMN public.api_spend.task_type IS
  'Compact local literal naming the task this call served ("email_draft", '
  '"score_search"), matching neural_footprint_event.context->>''task_type'' for '
  'the same call. NULL means UNKNOWN — either the caller passed no task_type, or '
  'the row predates this column. It is NEVER a task type in its own right. '
  'Nullable and un-backfilled on purpose: ADR 0016 (a ledger must be able to say '
  '"unknown") and ADR 0020 (no fabricated answers — nobody knows what task the '
  'historical rows served, and model/provider does not imply it).';


-- ---------------------------------------------------------------------------
-- 2) THE VIEW — per-source rows, because a single sum WOULD double-count.
-- ---------------------------------------------------------------------------
--
-- WHO WRITES WHAT (measured 2026-08-28, not assumed):
--
--   services/agent-orchestrator/services/spend_logger.py — ONE call writes BOTH
--     ledgers, in two independent try/excepts (`:368-448`, after this slice adds
--     task_type to the first). Every Python model call is recorded TWICE, once
--     per table.
--   apps/api-gateway/src/common/model-client/model-client.service.ts — emits
--     neural_footprint_event only (`:413`), with `context.task_type`. It has
--     never written api_spend: `grep -rn api_spend apps/api-gateway/src | wc -l`
--     returns 0 (run 2026-08-28).
--
-- So the two ledgers overlap on the Python half and diverge on the gateway half.
-- `sum(cost_usd)` over a UNION of both counts every Python call twice and every
-- gateway call once — a number that is wrong by an amount that varies with the
-- Python/gateway traffic mix, which is the worst kind of wrong: plausible, and
-- silently drifting.
--
-- THE CHOICE: the view emits one row per (source, task_type) and NEVER sums
-- across sources. `source` names the LEDGER the row was aggregated from, not the
-- runtime that wrote it — a distinction the data itself cannot make (see the
-- rejected options below). Correctness over convenience: a caller must pick a
-- source, and the comment on the view tells them which and why.
--
-- HOW TO READ IT
--   source = 'neural_footprint_event'  the only ledger BOTH runtimes write, and
--                                      therefore the closest thing to a complete
--                                      cost-per-task figure today.
--   source = 'api_spend'               the Python-only slice. Complete for the
--                                      Python runtime, blind to the gateway.
--   Never add the two together.
--
-- The per-source split is not only a hazard fence, it is a signal. The two
-- inserts drop independently and dropped rows are counted
-- (services.neural_footprint.get_drop_counts), so for the same task_type,
-- `calls` on 'api_spend' below `calls` on 'neural_footprint_event' is Python
-- rows going missing from the primary ledger — visible here, invisible in any
-- reconciled single number.
--
-- REJECTED, and why:
--   * One row per task_type, summing both ledgers. The double count above.
--   * Splitting NF rows into Python-written and gateway-written by a marker
--     already on the row — `context->>'attempts'` is gateway-only today, as is
--     `context->>'provider'` on the Python side. Rejected: neither field means
--     provenance, both are caller-supplied jsonb that any call site can set, and
--     a heuristic that USUALLY identifies the writer would let the view report a
--     confident total assembled from a guess. NF carries no writer column; the
--     honest move is to say so, not to infer one.
--   * A wide full-outer-join (one row per task_type, a cost column per ledger).
--     Structurally harder to misread, but it silently pairs rows on task_type
--     alone — two ledgers whose Python halves have drifted would be presented as
--     reconciled. Rejected for the same reason as the sum: it hides the drift
--     this slice exists to expose.
--
-- COST IS OVER THE COSTED CALLS, NOT OVER `calls`. `cost_usd` is nullable in
-- both tables (OD-61 / ADR 0016: NULL means the model had no rate, not that the
-- call was free), and sum()/avg() ignore NULL. `calls_with_cost` is in the
-- output for exactly this reason — whenever it is below `calls`, `cost_usd`
-- understates and `calls * avg_cost_usd` overstates. The caveat is carried, as
-- in nf_a_cost_per_completed_task, rather than "fixed" by inventing a number.
--
-- NF is filtered to subject_type = 'agent', matching nf_a_cost_per_completed_task:
-- 'guest' and 'operator' rows are product actions, not model calls, and carry no
-- spend. No per-day / per-restaurant / per-agent cuts — those are reporting
-- decisions nobody has made (CLAUDE.md §0.1), and per-agent already exists in
-- nf_a_cost_per_completed_task. Zero rows at zero volume; neither branch errors
-- on an empty table.
--
-- security_invoker = true is mandatory: views are SECURITY DEFINER by default,
-- which would let the view owner's privileges bypass RLS on both base tables and
-- make this a cross-tenant cost leak through a view. api_spend and
-- neural_footprint_event are both RLS-on; api_spend has zero policies (closed by
-- absence for anon/authenticated), NF has nfe_service_role. Both writers use the
-- service-role key, which carries rolbypassrls, so neither is affected.
--
-- DROP-then-CREATE rather than CREATE OR REPLACE: `create or replace view`
-- cannot change a column list, so a replay against a differently-shaped view of
-- the same name would fail instead of converging. This form is re-runnable.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS public.cost_per_task_v;

CREATE VIEW public.cost_per_task_v
  WITH (security_invoker = true)
AS
  SELECT 'api_spend'::text                             AS source,
         task_type                                     AS task_type,
         count(*)                                      AS calls,
         count(*) FILTER (WHERE cost_usd IS NOT NULL)  AS calls_with_cost,
         sum(cost_usd)                                 AS cost_usd,
         avg(cost_usd)                                 AS avg_cost_usd,
         sum(input_tokens)                             AS input_tokens,
         sum(output_tokens)                            AS output_tokens,
         min("timestamp")                              AS first_at,
         max("timestamp")                              AS last_at
    FROM public.api_spend
   GROUP BY task_type

  UNION ALL

  SELECT 'neural_footprint_event'::text                AS source,
         context->>'task_type'                         AS task_type,
         count(*)                                      AS calls,
         count(*) FILTER (WHERE cost_usd IS NOT NULL)  AS calls_with_cost,
         sum(cost_usd)                                 AS cost_usd,
         avg(cost_usd)                                 AS avg_cost_usd,
         sum(input_tokens)                             AS input_tokens,
         sum(output_tokens)                            AS output_tokens,
         min(occurred_at)                              AS first_at,
         max(occurred_at)                              AS last_at
    FROM public.neural_footprint_event
   WHERE subject_type = 'agent'
   GROUP BY context->>'task_type'

   ORDER BY source, cost_usd DESC NULLS LAST;

COMMENT ON VIEW public.cost_per_task_v IS
  'Cost per task_type across BOTH spend ledgers, one row per (source, task_type). '
  'NEVER SUM ACROSS SOURCES. SpendLogger.log() writes api_spend AND '
  'neural_footprint_event from one call, so every Python model call appears in '
  'both sources; the gateway writes only NF. Adding the sources together '
  'double-counts every Python call and single-counts every gateway call. Read '
  'source = ''neural_footprint_event'' for the near-complete figure (the only '
  'ledger both runtimes write) and source = ''api_spend'' for the Python-only '
  'slice. `source` is the LEDGER, not the writer: NF carries no writer column and '
  'this view does not guess one. Where the two sources disagree on `calls` for the '
  'same task_type, that is Python rows dropped from one ledger — the drops are '
  'counted in services.neural_footprint.get_drop_counts. task_type NULL means '
  'UNKNOWN (ADR 0016), and on source = ''api_spend'' it is mostly pre-instrumentation '
  'history, un-backfilled on purpose (ADR 0020). cost_usd is nullable, so `cost_usd` '
  'and `avg_cost_usd` cover only the calls in `calls_with_cost`: when that is below '
  '`calls`, the total understates and calls * avg_cost_usd overstates. '
  'security_invoker = true, so base-table RLS applies to the caller.';

-- Not a product surface, and not one today: with security_invoker = true a client
-- selecting this would be denied at api_spend (RLS on, zero policies) anyway, so
-- the revoke keeps it out of the PostgREST surface rather than publishing an
-- endpoint that only ever returns permission-denied. Same treatment as the two
-- nf_a views. OD-72's catalog sweep is point-in-time and cannot reach a view
-- created after it, so the revoke lives in the migration that creates the view.
REVOKE ALL ON public.cost_per_task_v FROM anon, authenticated;
