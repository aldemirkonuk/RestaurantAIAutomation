---
type: loops
division: research-math
department: research-math
status: provisional
metrics: [nf_a.event_completeness, nf_a.cost_per_completed_task, nf_a.harness_overhead_ms, nf_a.verified_task_success_rate]
updated: 2026-08-24
links: ["[[research-math-charter]]", "[[research-math-directive]]", "[[research-math-schedule]]", "[[harness-model-routing-loops]]", "[[evaluation-doneability-loops]]", "[[neural-footprint-instrumentation-loops]]", "[[data-charter]]", "[[engineering-charter]]", "[[security-charter]]", "[[analytics-bi-charter]]", "[[aio-evaluation-gates]]", "[[aio-model-routing]]", "[[decision-office-charter]]"]
---

# Research & Math — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop ([[ORG_STRUCTURE]] §5).

Six department-level loops. Three are **internal** (the department measuring itself),
three are **cross-boundary contracts** from `intelligence.md:484-491` — edges where this
department depends on a unit it does not control. Team-level loops live in
[[harness-model-routing-loops]], [[evaluation-doneability-loops]] and
[[neural-footprint-instrumentation-loops]].

---

## L1 — NF-A emission completeness

The foundational loop. Three of the department's four metrics are downstream of it.

```yaml
type: loop
id: nf-a-emission-completeness
owner: research-math
measures: [nf_a.event_completeness]
changes: [nf.event_contract, nf.emission_coverage, spend_logger.signature]
inputs_from: [engineering, ai-orchestration, data]
outputs_to: [security, analytics-bi, people-and-agent-ops]
close_time: weekly
status: proposed
baseline: "0% NestJS surface (0 hits for api_spend|cost_usd|input_tokens in apps/api-gateway/src); Python partial across two unjoined tables, max 4 of 8 fields on any row"
first_action: "add `agent` to SpendLogger.log() (spend_logger.py:41-48) and propagate correlation_id into api_spend"
```

**Trip condition.** Completeness flat for two consecutive weeks → escalate to
[[decision-office-charter]]; a second telemetry table holding token counts is an
immediate escalation ([[research-math-premortem]] M5).

---

## L2 — Cost per completed task

The department's headline economic number, and the only one that refuses to count a
retried failure as work.

```yaml
type: loop
id: cost-per-completed-task
owner: research-math
measures: [nf_a.cost_per_completed_task, nf_a.retries, nf_a.tokens]
changes: [harness.routing_policy, harness.retry_policy, model.roster]
inputs_from: [ai-orchestration, engineering]
outputs_to: [strategy-and-fundraising, security, analytics-bi]
close_time: monthly
status: proposed
depends_on: [nf-a-emission-completeness, doneability-verdict-coverage]
baseline: unmeasured
note: "cannot open until L1 and L3 both have a first reading — cost with no verdict is spend, not cost per task"
```

**Trip condition.** Cost falls while `verified_task_success_rate` falls with it → the
routing policy is buying cheapness with quality; revert within one close-time.

---

## L3 — Doneability verdict coverage, and the honesty gap

```yaml
type: loop
id: doneability-verdict-coverage
owner: research-math
measures: [nf_a.verified_task_success_rate, nf_a.self_reported_success_rate, nf_a.verdict_coverage]
changes: [eval.criteria, eval.golden_sets, ci.gates]
inputs_from: [ai-orchestration, engineering, analytics-bi]
outputs_to: [ai-orchestration, engineering, product-and-vision]
close_time: weekly
status: proposed
baseline: "near zero outside the merge-policy gate; base_agent.py:144 'success' means the handler did not raise"
gate: "identity.false_merge_count = 0, never summed with false splits"
```

**The published output is the gap**, not the verdict rate: verified minus self-reported.
**Trip condition.** The gap narrows for two close-times with no change to harness or
criteria → the auditor is drifting toward the author (premortem M4).

---

## L4 — Harness overhead → OD-03 (cross-boundary: Engineering, AI Orchestration)

The one loop that closes by **being decided** rather than by repeating. It still names a
close-time, because an undecided fork with no clock is how OD-03 ages.

```yaml
type: loop
id: harness-overhead-bakeoff
owner: research-math
measures: [nf_a.harness_overhead_ms, nf_a.cost_per_completed_task, share_of_model_calls_through_wrapper]
changes: [harness.choice, harness.wrapper, callsite.deprecation_date]
inputs_from: [ai-orchestration, engineering]
outputs_to: [engineering, ai-orchestration, decision-office]
close_time: "6 weeks to a decision, then quarterly re-run"
status: proposed
blocks: [OD-03, OD-04]
precondition: "harness_overhead_ms has a first reading — the bake-off may not be scheduled before it (research-math-directive rule 2)"
```

**Contract with [[engineering-charter]]** (`intelligence.md:487`): RM owns the wrapper;
Engineering owns adoption. **A wrapper shipped without a deprecation date for the seven
existing callsites becomes the eighth convention** — so the date is part of the loop, not
a follow-up. `share_of_model_calls_through_wrapper` publishes weekly from day one.

---

## L5 — NF schema contract (cross-boundary: Data)

```yaml
type: loop
id: nf-schema-contract
owner: research-math
measures: [nf.contract_fields_agreed, nf.private_telemetry_tables]
changes: [nf.production_columns, nf.research_log_shape, nf.subject_type_vocabulary]
inputs_from: [data, analytics-bi, security]
outputs_to: [data, engineering]
close_time: "fortnightly until OD-11 closes"
status: proposed
blocks: [OD-11]
contract: "RM owns the schema contract; Data owns the physical table and migration (intelligence.md:486). OD-11 must name both owners or it is implemented twice."
carries: "fork F-3 — add `operator` as a subject_type, decided inside this session rather than after it"
```

**Trip condition.** `nf.private_telemetry_tables` > 0 without a dated fold-in line →
escalate. Temporary is allowed; **undated** temporary is not.

---

## L6 — The two seams with Applied AI

Not a measurement loop — a **duplication detector**. It exists because both seams are
currently ambiguous and ambiguity is cheapest to fix early.

```yaml
type: loop
id: applied-ai-seam-audit
owner: research-math
measures: [duplicated_golden_sets, duplicated_routing_policies, unowned_seams]
changes: [team.boundaries, team.merge_proposals]
inputs_from: [ai-orchestration]
outputs_to: [decision-office, ai-orchestration]
close_time: monthly
status: proposed
rule: "if either unit maintains an artifact the other also maintains, the RM team files the merge proposal itself rather than defending scope (technology.md:406)"
open: "evaluation seam (technology.md:845 — note the local ID collides with global OD-21); routing seam — RM-1 and aio-model-routing share a mandate and a metric, and no published boundary covers it"
```

---

## Loops this department is the *supplier* to

Recorded here so the dependency is visible from both ends.

| Consumer | Needs from us | Their metric | Close-time we owe them |
|---|---|---|---|
| [[security-charter]] SEC-3 | Cost events on NestJS model calls, tagged with authenticated subject | `nf_a.unauthenticated_inference_spend` — **unmeasurable until L1 emits** | First reading within 4 weeks; `consultants.service.ts` instrumented first for exactly this reason |
| [[analytics-bi-charter]] AB-2 | A `subject_type` home for operator act/dismiss signal (fork F-3) | `insight_acceptance_rate` | Decided inside the OD-11 session (L5) |
| [[aio-evaluation-gates]] | Doneability criteria and pass conditions to enforce | NF-A verdict coverage | Criteria for three task types within 6 weeks (L3) |
| [[people-and-agent-ops-charter]] | NF-A as the primary input to an agent workforce function | — | Whatever L1 publishes; no separate feed |
