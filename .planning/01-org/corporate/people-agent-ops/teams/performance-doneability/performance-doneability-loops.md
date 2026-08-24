---
type: loops
division: corporate
department: people-agent-ops
team: performance-doneability
status: provisional
metrics: [nf_a.doneability_verdict_coverage, nf_a.cost_per_task, nf_a.cost_per_completed_task, nf_a.verified_task_success_rate, nf_a.agent_attributed_spend_pct, nf_a.emission_coverage]
updated: 2026-08-24
links: ["[[performance-doneability-charter]]", "[[performance-doneability-premortem]]", "[[performance-doneability-directive]]", "[[people-agent-ops-loops]]", "[[roster-lifecycle-loops]]", "[[LOOP-MAP]]", "[[evaluation-doneability-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[research-math-charter]]", "[[ai-orchestration-charter]]", "[[agent-evaluation-gates-charter]]", "[[model-routing-inference-economics-charter]]", "[[inference-cost-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]"]
loop_count: 5
loop_count: 5
loop_ids: ["pd-coverage-publication", "pd-cost-attribution-readiness", "pd-criteria-specification", "pd-fleet-performance-review", "pd-emission-floor-audit"]
loop_close_times: ["weekly", "monthly", "monthly", "quarterly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Performance & Doneability — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Five loops. **Three of them close on a metric that is currently zero** — and they still
close, because publishing the zero and ageing the blocker is the measurement. A loop that
only runs once the data arrives is not a loop, it is a plan.

---

## L-PD-1 — Coverage publication, including while blocked

```yaml
type: loop
id: pd-coverage-publication
owner: performance-doneability
measures: [nf_a.doneability_verdict_coverage, nf_a.verified_task_success_rate, people.blocked_days]
changes: [people.dependency_queue, decisions.open_queue, people-agent-ops.agenda_board]
inputs_from: [neural-footprint-instrumentation, evaluation-doneability, agent-evaluation-gates]
outputs_to: [people-agent-ops, research-math, decision-office, red-team]
close_time: weekly
status: proposed
```

Publishes `nf_a.doneability_verdict_coverage` **every week whether or not it moved**, next
to `people.blocked_days` and the named blocker. Baseline **0%**. The line may not be
deleted for tidiness and may not be copied forward without the age incrementing
([[performance-doneability-directive]] rule 3). A frozen zero beside a rising age is a
legible organisational reading; silence is not. Counters premortem M2.

---

## L-PD-2 — Cost attribution readiness

```yaml
type: loop
id: pd-cost-attribution-readiness
owner: performance-doneability
measures: [nf_a.agent_attributed_spend_pct, nf_a.cost_per_task, nf_a.cost_per_completed_task]
changes: [decisions.open_queue, spend_logger.signature, api_spend.schema]
inputs_from: [neural-footprint-instrumentation, model-routing-inference-economics, inference-cost, ai-orchestration]
outputs_to: [research-math, finance-pricing, decision-office]
close_time: monthly
status: proposed
```

Tracks one binary and one number: *can spend name a worker yet* — today **no**
(`services/agent-orchestrator/services/spend_logger.py:41-49` has no `agent` parameter;
`api_spend` at `…baseline_from_production.sql:2231` has no such column) — and *what share
of logged spend is agent-attributed*, today **0%**.

**The reported value while blocked is `not derivable`, never an estimate**
([[performance-doneability-directive]] rule 1). Monthly, because it moves only when OD-C5
moves. Counters premortem M4.

---

## L-PD-3 — Criteria specification (unblocked)

```yaml
type: loop
id: pd-criteria-specification
owner: performance-doneability
measures: [doneability.criteria_spec_coverage, doneability.task_types_identified]
changes: [doneability.criteria_specs, evaluation.methodology_queue]
inputs_from: [ai-orchestration, agent-fleet, roster-lifecycle, product-vision]
outputs_to: [evaluation-doneability, research-math, agent-evaluation-gates]
close_time: monthly
status: proposed
```

The loop that moves while everything else is blocked, and the direct counter to premortem
M3. Measures **criteria-specification coverage** across the task types the fleet actually
runs — starting with invoice understanding, inbound email classification, and wine
enrichment (0 of 3 today).

Each spec names the unit of work, the observable that decides it, what an abstention looks
like, and what a **confidently wrong** output looks like — the case `success_rate` cannot
see. Specs go to [[evaluation-doneability-charter]], whose methodology it is: **we state
what needs grading, they define how.**

---

## L-PD-4 — Fleet performance review (gated)

```yaml
type: loop
id: pd-fleet-performance-review
owner: performance-doneability
measures: [nf_a.verified_task_success_rate, nf_a.cost_per_completed_task, nf_a.doneability_verdict_coverage]
changes: [roster.maturity_levels, roster.retirements, doneability.criteria_findings, agent.improvement_queue]
inputs_from: [neural-footprint-instrumentation, evaluation-doneability, roster-lifecycle]
outputs_to: [roster-lifecycle, ai-orchestration, people-agent-ops, decision-office]
close_time: quarterly
status: proposed
```

The actual review. **Gated by [[performance-doneability-directive]] rule 8: it may not run
on liveness data.** Until L-PD-1 shows a verdict and L-PD-2 shows an attributed cost, this
loop's quarterly output is *"cannot review; here is what is missing"* — which is a valid,
recorded outcome and is better than a review conducted on `core/base_agent.py:144`'s
`success_rate`.

When it does run, a repeated failure routes through one question first: **is the criterion
wrong, or the worker?** Only [[evaluation-doneability-charter]] may change a criterion
(rule 6).

---

## L-PD-5 — Emission floor audit

```yaml
type: loop
id: pd-emission-floor-audit
owner: performance-doneability
measures: [nf_a.emission_coverage, nf_a.decision_log_call_site_count, roster.unregistered_module_count]
changes: [nf_a.emission_gaps, agent.improvement_queue]
inputs_from: [roster-lifecycle, ai-orchestration, harness-runtime]
outputs_to: [neural-footprint-instrumentation, ai-orchestration, people-agent-ops]
close_time: monthly
status: proposed
```

Counts how many of the 26 modules call `log_decision()` (`core/base_agent.py:743`) at all,
and how many emit nothing because they are not registered. **This number is obtainable
today and nobody has looked** — it is the one real measurement available to this team
before OD-C5 closes.

It is also where the two teams meet: an unregistered agent emits nothing, so
`roster.unregistered_module_count` (**3** today) is a hard floor under
`nf_a.emission_coverage`. Roster truth is not a nice-to-have for this team; it is a
precondition.

---

## Close-time summary

| Loop | Close-time | Counters | Runs while blocked? |
|---|---|---|---|
| L-PD-1 coverage publication | weekly | M1, M2 | **yes — that is the point** |
| L-PD-2 cost attribution readiness | monthly | M4 | yes, as a binary |
| L-PD-3 criteria specification | monthly | M3 | **yes — fully unblocked** |
| L-PD-4 fleet performance review | quarterly | M1, M5 | gated — reports what is missing |
| L-PD-5 emission floor audit | monthly | M2 | **yes — measurable today** |

**Direction of flow, stated once.** [[evaluation-doneability-charter]] and
[[neural-footprint-instrumentation-charter]] are `inputs_from` for every metric
*definition* and `outputs_to` only for *requirements and findings*. They define and emit;
we apply and consume. If both departments own the definition it will be defined twice
(`corporate.md:509-512`), and the second definition is the one that quietly wins.
