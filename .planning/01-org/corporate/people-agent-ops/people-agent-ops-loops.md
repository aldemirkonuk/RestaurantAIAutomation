---
type: loops
division: corporate
department: people-agent-ops
status: provisional
metrics: [roster.truth_pct, roster.unregistered_module_count, roster.silent_default_spec_count, nf_a.doneability_verdict_coverage, nf_a.cost_per_completed_task, nf_a.verified_task_success_rate]
updated: 2026-08-24
links: ["[[people-agent-ops-charter]]", "[[people-agent-ops-premortem]]", "[[people-agent-ops-directive]]", "[[roster-lifecycle-loops]]", "[[performance-doneability-loops]]", "[[LOOP-MAP]]", "[[research-math-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[evaluation-doneability-charter]]", "[[ai-orchestration-charter]]", "[[decision-office-charter]]"]
loop_count: 5
loop_count: 5
loop_ids: ["pao-roster-census", "pao-onboarding-gate", "pao-doneability-coverage", "pao-cost-attribution-readiness", "pao-fleet-review"]
loop_close_times: ["daily", "per PR", "weekly", "monthly", "quarterly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# People & Agent Ops — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Five department loops. Three of them exist to make sure a *blocked* team keeps producing
a measurement — which is unusual, and deliberate: this department's most likely failure
(premortem M1) is that the blocked half goes quiet and the unblocked half becomes the
department.

---

## L-PAO-1 — Roster census

```yaml
type: loop
id: pao-roster-census
owner: people-agent-ops
measures: [roster.unregistered_module_count, roster.silent_default_spec_count, roster.declared_stub_count, roster.truth_pct]
changes: [orchestrator.agent_classes, agent_registry.default_specs, roster.exclusion_register]
inputs_from: [roster-lifecycle, ai-orchestration, agent-fleet]
outputs_to: [people-agent-ops, ai-orchestration, decision-office]
close_time: daily
status: proposed
```

Diffs **three** sources every day: the filesystem
(`services/agent-orchestrator/agents/*.py`), the orchestrator's class map
(`core/orchestrator.py:174-211`), and `DEFAULT_AGENT_SPECS` (`core/agent_registry.py`).
Any non-empty diff is a defect row with an owner. Baseline: **3** unregistered, **4**
silent-default. Daily rather than weekly because the check is seconds of compute and the
failure it catches — a dark agent — is invisible by construction
(`core/orchestrator.py:200-205`). Counters premortem M2.

---

## L-PAO-2 — Onboarding gate

```yaml
type: loop
id: pao-onboarding-gate
owner: people-agent-ops
measures: [roster.new_module_gate_pass_rate, roster.unregistered_module_count]
changes: [ci.agent_registration_check, roster.exclusion_register, roster.onboarding_checklist]
inputs_from: [roster-lifecycle, engineering, ai-orchestration]
outputs_to: [ai-orchestration, reliability-sre, decision-office]
close_time: per PR
status: proposed
```

The census turned into a gate. A PR adding a file to
`services/agent-orchestrator/agents/` must either register it or add a declared exclusion.
Close-time is **per PR** because this is the one loop that can close before the defect
exists rather than after — every other loop here is detection.

---

## L-PAO-3 — Doneability coverage, including while blocked

```yaml
type: loop
id: pao-doneability-coverage
owner: people-agent-ops
measures: [nf_a.doneability_verdict_coverage, nf_a.verified_task_success_rate, people.blocked_days]
changes: [people.dependency_queue, decisions.open_queue, doneability.criteria_specs]
inputs_from: [performance-doneability, evaluation-doneability, neural-footprint-instrumentation]
outputs_to: [research-math, decision-office, red-team]
close_time: weekly
status: proposed
```

Publishes `nf_a.doneability_verdict_coverage` **every week whether or not it moved**, and
publishes `people.blocked_days` alongside it. Baseline **0%** and rising blocked-days.
A blocker older than two close-times escalates automatically
([[people-agent-ops-directive]] rule 1). This is the loop that makes premortem M1
observable: a coverage number frozen at zero next to a blocker age that keeps climbing is
an organisational reading, not an excuse.

---

## L-PAO-4 — Cost attribution readiness

```yaml
type: loop
id: pao-cost-attribution-readiness
owner: people-agent-ops
measures: [nf_a.cost_per_task, nf_a.cost_per_completed_task, nf_a.agent_attributed_spend_pct]
changes: [decisions.open_queue, spend_logger.signature, api_spend.schema]
inputs_from: [performance-doneability, neural-footprint-instrumentation, model-routing-inference-economics, inference-cost]
outputs_to: [research-math, finance-pricing, decision-office]
close_time: monthly
status: proposed
```

Tracks one binary and one number: *can spend be attributed to a worker yet* (today: no —
`services/agent-orchestrator/services/spend_logger.py:41-49`, and `api_spend` at
`supabase/migrations/20260805000000_baseline_from_production.sql:2231` has no agent
column), and *what share of spend is agent-attributed* (today: **0%**). Monthly because
it moves only when OD-C5 moves. **The reported value while blocked is `not derivable`,
never an estimate** — directive rule 1, countering premortem M4.

---

## L-PAO-5 — Fleet review

```yaml
type: loop
id: pao-fleet-review
owner: people-agent-ops
measures: [roster.maturity_level_evidenced_pct, roster.retirement_count, nf_a.verified_task_success_rate]
changes: [roster.maturity_levels, roster.retirements, doneability.criteria_findings]
inputs_from: [roster-lifecycle, performance-doneability, agent-fleet, agent-evaluation-gates]
outputs_to: [ai-orchestration, decision-office, strategy-fundraising]
close_time: quarterly
status: proposed
```

The actual HR loop — the one that reviews workers rather than records. Quarterly, and
**gated**: it may not run on liveness data. Until L-PAO-3 produces a verdict and L-PAO-4
produces an attributed cost, this loop's output is *"cannot review; here is what is
missing"*. Recording that a review could not happen is a valid quarterly outcome and is
more useful than a review conducted on `success_rate` (premortem M3).

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-PAO-1 roster census | daily | M2 — dark agents |
| L-PAO-2 onboarding gate | per PR | M2 — before the fact rather than after |
| L-PAO-3 doneability coverage | weekly | M1, M3 — the blocked half stays visible |
| L-PAO-4 cost attribution readiness | monthly | M4 — attribution by inference |
| L-PAO-5 fleet review | quarterly | M5 — ceremony without a subject |

**Direction of flow, stated once:** [[research-math-charter]] and
[[neural-footprint-instrumentation-charter]] are `inputs_from` on every loop that touches
NF-A, never `outputs_to` for a metric *definition*. We consume the spine and send back
findings. If both departments own the definition it will be defined twice
(`corporate.md:509-512`).
