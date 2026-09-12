-- NF-A readout — the views that make P1's honesty gate satisfiable.
--
-- Why this migration exists
-- -------------------------
-- P1 is done when "a number exists that nobody had to assemble by hand"
-- (P1-NF-A-INSTRUMENTATION.md §6). Until now `neural_footprint_event` existed
-- with no reader: anyone wanting `nf_a.cost_per_completed_task` had to
-- hand-write the §2 query, which is exactly the standard P1 rejects. This
-- migration turns the §2 block into a named, queryable object, and closes the
-- RLS hole the table shipped with.
--
-- Two views, no more. P1 §3 puts dashboards explicitly OUT of scope, so this
-- adds no per-day/per-restaurant/rolling-window cuts — those are reporting
-- decisions nobody has made yet (CLAUDE.md §0.1).
--
--   1. nf_a_cost_per_completed_task — the P1 §2 query, verbatim in semantics.
--   2. nf_a_readout_provenance      — the honesty envelope for view 1.
--
-- Why view 2 is not speculative. View 1 aggregates `occurred_at` away
-- entirely, so a caller reading it alone cannot tell whether a cost-per-task
-- figure came from three smoke-test rows written this morning or three
-- thousand rows written over a month. Every consumer of view 1 needs that
-- envelope, and if the envelope lives in each consumer instead of here, each
-- consumer hand-assembles it — reintroducing the defect this migration
-- closes. It is deliberately global and aggregate-only (no GROUP BY), so it
-- returns exactly one row at any volume, including zero.
--
-- Zero-row behaviour is a requirement, not an accident. The table has 0 rows
-- in production today. View 1 returns 0 rows (GROUP BY over an empty relation
-- yields no groups); view 2 returns 1 row of zeros and NULLs. Neither errors.

-- ---------------------------------------------------------------------------
-- RLS — closing a real hole, not a hypothetical one.
--
-- Evidence gathered against production (PostgreSQL 17.6) before writing this:
--
--   * 192 of 205 public tables have relrowsecurity = true. The 13 without are
--     three `_bak_*` snapshots, PostGIS `spatial_ref_sys`, a procurement
--     cluster, `user_oauth_accounts`, two wine log tables — and this one.
--     The house convention is unambiguously RLS-ON; the exceptions are gaps,
--     not a policy for "internal telemetry".
--   * The closest analogues by content — `api_spend`, `decision_log`,
--     `agent_activity_logs` — are all RLS-ON with ZERO policies. Under
--     Supabase that is closed-by-absence for anon/authenticated, and open for
--     `service_role`, which carries rolbypassrls = true (verified).
--   * `neural_footprint_event` as shipped was relrowsecurity = false while
--     holding default Supabase grants: anon and authenticated each had
--     SELECT/INSERT/UPDATE/DELETE/TRUNCATE. Anyone with the publishable anon
--     key could read every row's `cost_usd` and `restaurant_id`, and delete
--     them. That is a live leak of cost data across tenants, not a posture
--     question.
--
-- The pattern used here is the guest-identity one (20260819000000), which is
-- the most recent and most deliberate security work in this repo, rather than
-- the bare `api_spend` one. Its reasoning applies verbatim: RLS-enabled-with-
-- no-policy is closed only by ABSENCE, so the next person to add a policy
-- would silently open the whole table. Grants are revoked as well.
--
-- Both writers use the service-role key and are therefore unaffected:
--   * apps/api-gateway/src/database/database.service.ts:15 -> SUPABASE_SERVICE_ROLE_KEY
--   * services/agent-orchestrator/config/settings.py:19-23 -> resolves to the
--     same key (SUPABASE_SERVICE_KEY / SUPABASE_KEY are unset).
-- A writer holding the anon key would now fail loudly at the grant, instead of
-- silently succeeding at writing cost data it should never have touched.
-- ---------------------------------------------------------------------------

alter table public.neural_footprint_event enable row level security;

drop policy if exists nfe_service_role on public.neural_footprint_event;
create policy nfe_service_role on public.neural_footprint_event
  for all to service_role using (true) with check (true);

-- No `authenticated` policy, by design. P1 is emission only; no client reads
-- this table, and a cost ledger keyed by restaurant_id is not something to
-- open speculatively. When a product surface needs it, that is a decision with
-- an ADR, and it gets a restaurant-isolation policy modelled on
-- guests_restaurant_isolation (user_restaurant_access, is_active, valid_until)
-- — NOT a bare `using (true)`.
revoke all on public.neural_footprint_event from anon, authenticated;

-- ---------------------------------------------------------------------------
-- View 1 — nf_a.cost_per_completed_task.
--
-- Semantics reproduced from P1-NF-A-INSTRUMENTATION.md §2 without addition:
-- the same six output columns, the same subject_type filter, the same
-- grouping and ordering. `outcome_unknown` is in the headline on purpose —
-- until doneability is defined, the honest report includes how much of it we
-- cannot yet grade (§2, and ADR 0008 accepted-risk 1: NULL means UNKNOWN,
-- never success).
--
-- security_invoker = true is mandatory here. Postgres views are SECURITY
-- DEFINER by default; without this the view owner's privileges would bypass
-- the RLS enabled above for every role holding SELECT on the view, making the
-- policy decorative. This is the exact defect fixed for beer/whiskey/
-- catalogue_items in 20260818000000.
-- ---------------------------------------------------------------------------

create or replace view public.nf_a_cost_per_completed_task
  with (security_invoker = true)
as
  select subject_id                                as agent,
         context->>'task_type'                     as task_type,
         count(*)                                  as tasks,
         sum(cost_usd)                             as cost,
         avg(cost_usd)                             as avg_cost,
         count(*) filter (where outcome is null)   as outcome_unknown
  from public.neural_footprint_event
  where subject_type = 'agent'
  group by subject_id, context->>'task_type'
  order by cost desc;

comment on view public.nf_a_cost_per_completed_task is
  'P1 §2 headline metric: cost per completed task, per agent and per task '
  'type, over neural_footprint_event where subject_type = ''agent''. '
  'outcome_unknown is part of the headline deliberately — outcome NULL means '
  'UNKNOWN, never success (ADR 0008). Returns zero rows at zero volume. '
  'Read it together with nf_a_readout_provenance: `tasks` is a sample size, '
  'and a cost figure over a handful of rows is not a production number. '
  'CAVEAT, inherited from the §2 query and left in place rather than '
  '"fixed" by inventing a column: cost_usd is nullable, and avg() ignores '
  'NULLs, so `avg_cost` is the mean over the COSTED events in the group, not '
  'over `tasks`. Whenever provenance.events_with_cost < provenance.events, '
  'tasks * avg_cost overstates cost. Use `cost` for totals, never the '
  'product. security_invoker=true so base-table RLS applies to the caller.';

-- ---------------------------------------------------------------------------
-- View 2 — the honesty envelope. Always exactly one row.
-- ---------------------------------------------------------------------------

create or replace view public.nf_a_readout_provenance
  with (security_invoker = true)
as
  select count(*)                                              as events,
         count(*) filter (where cost_usd is not null)           as events_with_cost,
         count(*) filter (where outcome is null)                as outcome_unknown,
         count(distinct subject_id)                             as agents,
         count(distinct (context->>'task_type'))                as task_types,
         count(distinct restaurant_id)                          as restaurants,
         sum(cost_usd)                                          as cost,
         min(occurred_at)                                       as first_event_at,
         max(occurred_at)                                       as last_event_at
  from public.neural_footprint_event
  where subject_type = 'agent';

comment on view public.nf_a_readout_provenance is
  'Sample size and time window behind nf_a_cost_per_completed_task. Exists so '
  'no consumer has to hand-assemble the envelope, and so a number computed '
  'from a handful of smoke-test rows cannot be presented as if it came from '
  'production volume (P1 §6 honesty gate). Aggregate with no GROUP BY, so it '
  'returns exactly one row at any volume — zeros and NULLs when the table is '
  'empty. security_invoker=true so base-table RLS applies to the caller.';

-- Neither view is a product surface. P1 §3 puts dashboards out of scope, and
-- with security_invoker=true a client selecting these would be denied at the
-- base table anyway; revoking here keeps them out of the PostgREST surface
-- rather than exposing endpoints that only ever return permission-denied.
revoke all on public.nf_a_cost_per_completed_task from anon, authenticated;
revoke all on public.nf_a_readout_provenance      from anon, authenticated;
