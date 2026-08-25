-- nf_verdict — task-level doneability verdicts over neural_footprint_event (OD-59).
--
-- Why this table exists
-- --------------------
-- `neural_footprint_event.outcome` is written on `context.outcome_basis =
-- 'call_level_v0'`, which asserts exactly one thing: the HTTP call to the model
-- returned 200 and was not truncated. That is a real reading, and it is NOT the
-- same claim as "the agent did the job". Seven of fifteen `nf_a.*` keys are
-- blocked on the second claim, `cost_per_completed_task` among them.
--
-- Three shapes were considered (OD-59, 2026-08-25):
--   (a) overwrite `outcome` in place and swap the basis string,
--   (b) add `task_outcome` / `task_outcome_basis` columns to the event,
--   (c) this table.
-- (a) destroys the call-level reading the moment a better one exists, and
-- neither runtime has an update path for an NF row today. (b) keeps both
-- readings but supports exactly ONE re-grade ever, which collides with the
-- re-grade OD-59 already promises the `backtests` team. (c) is the only shape
-- where a second grader can disagree with the first WITHOUT destroying it.
--
-- The verdict is a claim ABOUT an event, so it dies with its target: ON DELETE
-- CASCADE. A verdict whose event is gone grades nothing — it cannot be audited,
-- re-checked, or attributed, and leaving it behind would let deleted work keep
-- counting toward verdict coverage.

create table if not exists public.nf_verdict (
  id         uuid primary key default gen_random_uuid(),

  event_id   uuid not null
             references public.neural_footprint_event(id) on delete cascade,

  -- The grader, named in the row. This is the mechanism that stops a NARROW
  -- verdict from silently becoming the definition of "done" — the same job
  -- `call_level_v0` does for the call-level reading. `reconciliation_v1` means
  -- "line items plus charges reconcile to the stated total", which is
  -- arithmetic consistency and explicitly NOT correctness: an extraction can
  -- balance perfectly and still carry the wrong vendor, date, or SKU.
  basis      text not null,

  -- Same tri-state as the event, same rule: NULL is UNKNOWN, never success.
  -- Here NULL carries a specific and useful meaning — the grader RAN and found
  -- the case untestable (an invoice with no stated total cannot tie out either
  -- way). That is different from having no row at all, which means never graded.
  outcome    text check (outcome in ('success','failure','partial')),

  -- What the grader saw, so a disputed verdict can be re-checked without
  -- re-running the model: the delta, the tolerance, the line count.
  evidence   jsonb not null default '{}'::jsonb,

  graded_at  timestamptz not null default now(),

  -- One verdict per basis per event. Re-running the SAME grader is idempotent
  -- (upsert); a genuinely different grader takes a new basis string and lands
  -- as a second row, disagreement intact and attributable.
  unique (event_id, basis)
);

-- The readout groups by basis and reads recent windows.
create index if not exists nf_verdict_basis_time
  on public.nf_verdict (basis, graded_at desc);

comment on table public.nf_verdict is
  'Task-level doneability verdicts over neural_footprint_event (OD-59). One row per (event, basis). outcome NULL = the grader ran and the case was untestable; no row = never graded. Verdicts never overwrite each other: a second grader adds a row under a new basis.';

comment on column public.nf_verdict.basis is
  'Which grader produced this. reconciliation_v1 = lines + charges tie out to the stated total (arithmetic consistency, NOT correctness).';

-- ---------------------------------------------------------------------------
-- RLS, in the SAME migration that creates the table — not a follow-up.
--
-- `neural_footprint_event` shipped on 2026-08-24 with relrowsecurity = false
-- and default Supabase grants, so anyone holding the publishable anon key could
-- read and delete every row's cost_usd and restaurant_id. It took a second
-- migration the same day to close (20260824153600 §RLS). This table is FK-joined
-- to that one and carries the same tenant-adjacent exposure; creating it
-- unprotected would reopen the identical hole one day after it was shut.
--
-- Same pattern, same reasoning: RLS-enabled-with-a-service-role-policy rather
-- than RLS-enabled-with-no-policy, because no-policy is closed only by ABSENCE
-- and the next person to add one would silently open the whole table. Grants
-- are revoked too, so an anon-key writer fails loudly at the grant instead of
-- succeeding quietly.
--
-- Both writers use the service-role key (rolbypassrls = true) and are unaffected.
alter table public.nf_verdict enable row level security;

drop policy if exists nf_verdict_service_role on public.nf_verdict;
create policy nf_verdict_service_role on public.nf_verdict
  for all to service_role using (true) with check (true);

-- No `authenticated` policy, deliberately. Nothing client-side reads verdicts
-- yet. When a product surface needs them, that is a decision with an ADR and it
-- gets a restaurant-isolation policy joined through neural_footprint_event —
-- NOT a bare `using (true)`.
revoke all on public.nf_verdict from anon, authenticated;

-- ---------------------------------------------------------------------------
-- View — cost per VERIFIED task, partitioned by the grader that verified it.
--
-- Why a new view rather than amending nf_a_cost_per_completed_task: that view
-- has no `outcome` predicate at all (20260824153600:103-108 — `tasks` is a bare
-- count(*)), so despite its name it reports cost per model CALL, failures
-- included. It reproduces P1-NF-A-INSTRUMENTATION.md §2 faithfully; the defect
-- is in the spec, not the transcription. Amending it in place is also blocked
-- mechanically: scripts/nf_readout.py unpacks its columns positionally, and
-- CREATE OR REPLACE VIEW cannot insert a column mid-list. So it stays as-is and
-- is renamed by a later decision, not silently redefined underneath its readers.
--
-- `basis` is in the GROUP BY, not a filter. That is the whole point: without it,
-- a `reconciliation_v1` verdict and a `call_level_v0` call-level reading would
-- average into a single figure that means neither thing. Every row here states
-- which grader produced it.
--
-- THE DIVISION IS DELIBERATE. `cost_per_verified_success` divides the cost of
-- the WHOLE slice — failures, untestables and all — by the number that actually
-- succeeded. You pay for the failures, so they belong in the numerator. This is
-- precisely the figure that moves opposite to cost-per-call when a cheaper model
-- retries more (EVA-Q1), and reporting the average cost of successful rows
-- instead would reproduce the very illusion the metric exists to break.
create or replace view public.nf_a_cost_per_verified_task
  with (security_invoker = true)
as
  select v.basis                                             as basis,
         e.subject_id                                        as agent,
         e.context->>'task_type'                             as task_type,
         count(*)                                            as graded,
         count(*) filter (where v.outcome = 'success')       as verified_success,
         count(*) filter (where v.outcome = 'failure')       as verified_failure,
         count(*) filter (where v.outcome = 'partial')       as verified_partial,
         -- The grader ran and could not judge (e.g. an invoice with no stated
         -- total). Distinct from ungraded, which does not appear here at all.
         count(*) filter (where v.outcome is null)           as untestable,
         sum(e.cost_usd)                                     as cost,
         -- Inline rather than in a sibling view: `cost` sums only non-NULL
         -- cost_usd, so a reader who cannot see how many rows were costed
         -- cannot tell whether the ratio below is trustworthy.
         count(*) filter (where e.cost_usd is not null)      as graded_with_cost,
         sum(e.cost_usd)
           / nullif(count(*) filter (where v.outcome = 'success'), 0)
                                                             as cost_per_verified_success
  from public.nf_verdict v
  join public.neural_footprint_event e on e.id = v.event_id
  where e.subject_type = 'agent'
  group by v.basis, e.subject_id, e.context->>'task_type'
  order by cost desc;

comment on view public.nf_a_cost_per_verified_task is
  'OD-59 readout: cost per task that a named grader verified, per basis, agent '
  'and task type. Distinct from nf_a_cost_per_completed_task, which has NO '
  'outcome predicate and therefore reports cost per model CALL. `basis` is '
  'grouped, never filtered, so two graders can never average into one figure. '
  'cost_per_verified_success divides the WHOLE slice cost by the successes '
  'deliberately — failed attempts are paid for and belong in the numerator. '
  'untestable = the grader ran and could not judge; rows with no verdict at all '
  'are absent entirely, so read this with nf_a_verdict_coverage or a high '
  'success rate over a small graded fraction will read as good news. '
  'security_invoker=true so base-table RLS applies to the caller.';

-- ---------------------------------------------------------------------------
-- View — verdict coverage. This is `nf_a.doneability_verdict_coverage`, one of
-- the seven keys OD-59 blocks, and it is also the guard on the view above.
--
-- Grading only invoices means the ungraded remainder is invisible in the
-- verified figures. A slice can post a 100% success rate on 4% coverage and
-- look like a solved problem. Coverage is what makes that legible, so it ships
-- in the same migration as the thing it qualifies rather than "later".
create or replace view public.nf_a_verdict_coverage
  with (security_invoker = true)
as
  select e.subject_id                                     as agent,
         e.context->>'task_type'                          as task_type,
         count(*)                                         as events,
         count(v.id)                                      as graded,
         count(*) - count(v.id)                           as ungraded,
         round(100.0 * count(v.id) / nullif(count(*), 0), 1) as graded_pct
  from public.neural_footprint_event e
  left join public.nf_verdict v on v.event_id = e.id
  where e.subject_type = 'agent'
  group by e.subject_id, e.context->>'task_type'
  order by events desc;

comment on view public.nf_a_verdict_coverage is
  'nf_a.doneability_verdict_coverage: what share of agent events carry a '
  'task-level verdict, per agent and task type. Starts near zero by design — '
  'OD-59 grades one slice (document_extraction where docType = invoice) and '
  'every other slice honestly reports ungraded. A rising verified success rate '
  'means nothing without this number beside it. security_invoker=true.';

revoke all on public.nf_a_cost_per_verified_task from anon, authenticated;
revoke all on public.nf_a_verdict_coverage       from anon, authenticated;
