---
type: loops
division: research-math
department: research-math
team: harness-model-routing
status: provisional
metrics: [nf_a.harness_overhead_ms, nf_a.cost_per_completed_task, share_of_model_calls_through_wrapper]
updated: 2026-08-24
links: ["[[harness-model-routing-charter]]", "[[harness-model-routing-directive]]", "[[harness-model-routing-schedule]]", "[[research-math-loops]]", "[[evaluation-doneability-loops]]", "[[neural-footprint-instrumentation-loops]]", "[[engineering-charter]]", "[[security-charter]]", "[[harness-model-routing-charter|aio-model-routing]]", "[[decision-office-charter]]"]
loop_count: 5
loop_ids: ["wrapper-adoption", "harness-overhead-bakeoff", "routing-policy-vs-verdict", "callsite-migration-order", "routing-seam-audit"]
loop_close_times: ["weekly", "quarterly", "monthly", "per-event", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Harness & Model Routing (RM-1) — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a diagram,
not a loop ([[ORG_STRUCTURE]] §5).

---

## HR-1 — Wrapper adoption

The loop that decides whether this team built a boundary or an eighth convention.

```yaml
type: loop
id: wrapper-adoption
owner: research-math/harness-model-routing
measures: [share_of_model_calls_through_wrapper, raw_fetch_callsite_count, model_choice_convention_count]
changes: [harness.wrapper, callsite.deprecation_date]
inputs_from: [engineering, ai-orchestration]
outputs_to: [engineering, security, neural-footprint-instrumentation]
close_time: weekly
status: proposed
baseline: "0 of 7 NestJS callsites; 5 model-choice conventions (2 literals, 1 module constant, 3 env vars)"
rule: "publishes every week whether or not it moved — a missing metric is the failure signal, not a low one"
```

**Trip condition.** The count of raw-`fetch` model callsites rises above 7 → escalate the
same day. Or: this metric is absent from the board for one close-time → escalate to
[[decision-office-charter]] ([[harness-model-routing-premortem]] M2).

---

## HR-2 — Harness overhead → OD-03

Closes by **being decided**, and still carries a clock, because an undecided fork with no
clock is how OD-03 ages.

```yaml
type: loop
id: harness-overhead-bakeoff
owner: research-math/harness-model-routing
measures: [nf_a.harness_overhead_ms, nf_a.cost_per_completed_task]
changes: [harness.choice, model.roster]
inputs_from: [evaluation-doneability, ai-orchestration, engineering]
outputs_to: [decision-office, engineering, ai-orchestration]
close_time: quarterly
close_time_note: "6 weeks to first ADR, then quarterly re-run"
status: proposed
blocks: [OD-03, OD-04]
precondition: "harness_overhead_ms has a published first reading — the session may not be scheduled before it"
candidates: ["extend services/agent-orchestrator/core/base_agent.py (1,053 lines, incumbent — SCORED, not assumed)", "NousResearch/hermes-agent", "deepseek-ai/deepseek-harness"]
pass_conditions_owned_by: evaluation-doneability
precedent: "scripts/benchmark_haiku_vs_sonnet.py — the right shape, run once; the cadence is the fix"
```

**Trip condition.** An ADR draft whose evidence section contains no measurement taken on
this repo → [[decision-office-charter]] rejects it (`OD-03, OPEN-DECISIONS.md:29`).

---

## HR-3 — Routing policy, gated on a verdict

```yaml
type: loop
id: routing-policy-vs-verdict
owner: research-math/harness-model-routing
measures: [nf_a.cost_per_completed_task, nf_a.verified_task_success_rate, nf_a.retries]
changes: [harness.routing_policy, model.per_task_tier]
inputs_from: [evaluation-doneability, neural-footprint-instrumentation]
outputs_to: [engineering, analytics-bi, strategy-and-fundraising]
close_time: monthly
status: proposed
admissibility: "a routing change is justified by a verdict, never by a price alone (directive rule 2)"
revert_condition: "cost falls and verified_task_success_rate falls in the same close-time — revert within one close-time"
```

**Note on the denominator.** Cost per *completed* task, not per call: a cheap wrong answer
adds cost and no denominator, so it makes the number **worse**. That is the whole defence
against M3.

---

## HR-4 — Instrument-before-retry, per callsite

A migration loop rather than a measurement loop, and it exists because the ordering is the
safety property.

```yaml
type: loop
id: callsite-migration-order
owner: research-math/harness-model-routing
measures: [callsites_emitting_cost_events, callsites_with_retry, unguarded_callsites_with_retry]
changes: [callsite.wrapper_adoption, callsite.retry_policy, callsite.budget_check]
inputs_from: [security, neural-footprint-instrumentation]
outputs_to: [engineering, security]
close_time: per-event
close_time_note: "per callsite, reviewed fortnightly"
status: proposed
invariant: "unguarded_callsites_with_retry stays 0 until those callsites emit cost events"
first_migration: "apps/api-gateway/src/analytics/consultants.service.ts — most exposed (OD-20, Opus, unguarded route), therefore first, not last"
reviewer: security (SEC-3) on the first three migrations
```

**Trip condition.** `unguarded_callsites_with_retry` > 0 → stop the migration and
escalate. This team's own change would otherwise have widened a denial-of-wallet exposure
(premortem M4).

---

## HR-5 — The routing seam with Applied AI

```yaml
type: loop
id: routing-seam-audit
owner: research-math/harness-model-routing
measures: [duplicated_routing_policies, client_construction_modules]
changes: [team.boundaries, wrapper.shared_ownership]
inputs_from: [ai-orchestration]
outputs_to: [decision-office]
close_time: monthly
close_time_note: "monthly, terminating in a founder ruling"
status: proposed
open: "aio-model-routing (technology.md:363-388) holds the same mandate and the same primary metric. The published boundary covers evaluation only (technology.md:845)."
interim: "one wrapper both units use — shared code settles a boundary faster than a boundary document"
rule: "if either unit maintains an artifact the other also maintains, RM-1 files the merge proposal itself (technology.md:406)"
```

**Trip condition.** A second client-construction module appears — any file doing
`services/agent-orchestrator/services/model_clients.py`'s job without this team on the
review.

---

## What this team owes, and to whom

| Consumer | Owed | By when |
|---|---|---|
| [[security-charter]] SEC-3 | A budget check on unauthenticated inference paths, and cost events on `consultants.service.ts` | First migration — 4 weeks |
| [[evaluation-doneability-charter]] | A stable call path so evals measure the model, not the plumbing | Wrapper v0 |
| [[engineering-charter]] | A deprecation date they can plan against, not a request | Same PR as the wrapper |
| [[decision-office-charter]] | An OD-03 ADR with a table from this repo | 6 weeks after the instrument reads |
