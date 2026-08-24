---
type: loops
division: intelligence
department: analytics-bi
team: analytics-engine
status: provisional
metrics: [analytics.satisfiable_candidate_share, analytics.candidate_type_count, analytics.engine_service_test_ratio, analytics.false_discovery_estimate]
updated: 2026-08-24
links: ["[[analytics-engine-charter]]", "[[analytics-engine-premortem]]", "[[analytics-engine-directive]]", "[[analytics-engine-schedule]]", "[[analytics-bi-loops]]", "[[data-charter]]", "[[insight-narrative-generation-loops]]", "[[metric-contract-truth-assurance-loops]]", "[[LOOP-MAP]]"]
loop_count: 5
loop_count: 5
loop_count: 5
loop_ids: ["engine-candidate-reach", "engine-requirement-integrity", "engine-false-discovery-estimate", "engine-pipeline-coverage", "engine-purity-guard"]
loop_close_times: ["weekly", "on every PR touching insight-catalog.ts, audited monthly", "monthly", "monthly", "per PR (CI), verified weekly by the headless script"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Analytics Engine — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## E1 — Candidate reach → data request

The team's primary loop, and the one that keeps the department honest about who the
bottleneck is.

```yaml
type: loop
id: engine-candidate-reach
owner: analytics-bi
team: analytics-engine
measures: [analytics.satisfiable_candidate_share, analytics.candidate_type_count]
changes: [data.substrate_priority, insight-catalog.admission]
inputs_from: [data, engineering]
outputs_to: [data, insight-narrative-generation, product-and-vision]
close_time: weekly
baseline: "144/573 = 25.1% (consumption+orders+inventory); 38/573 = 6.6% (consumption only); 573/573 with all seven requirements"
status: proposed
```

**What it changes.** A falling share opens a data request naming the blocking
`DataRequirement`, ranked by how many candidates it unlocks. Today the ranking is already
computable and unambiguous: `checks` 429 · `tables` 241 · `consumption` 127 ·
`inventory` 78 · `orders` 33 · `venue` 27 · `goals` 0.

**What it must never change.** The catalogue. A falling share is never answered by adding
math ([[analytics-engine-directive]] Q2).

---

## E2 — Requirement-declaration integrity

The loop that keeps E1's number from being a lie.

```yaml
type: loop
id: engine-requirement-integrity
owner: analytics-bi
team: analytics-engine
measures: [analytics.unclaimed_data_requirements, analytics.misdeclared_candidate_count]
changes: [insight-catalog.requires_arrays, insight-catalog.spec_cases]
inputs_from: [metric-contract-truth-assurance]
outputs_to: [metric-contract-truth-assurance, data]
close_time: on every PR touching insight-catalog.ts, audited monthly
baseline: "1 unclaimed requirement — `goals` (insight-catalog.ts:38) is claimed by zero of 573 candidates, so 22 goal_pace types report satisfiable for restaurants with no goals"
status: proposed
```

**Closes when** every `DataRequirement` union member is claimed by ≥1 candidate and a spec
case asserts it. Red today.

---

## E3 — Significance discipline / false-discovery estimate

The falsification loop. Costs nothing, needs no POS feed, no simulator, no customer.

```yaml
type: loop
id: engine-false-discovery-estimate
owner: analytics-bi
team: analytics-engine
measures: [analytics.false_discovery_estimate, analytics.findings_per_run]
changes: [insight-generator.significance_thresholds, insight-generator.findings_cap]
inputs_from: [insight-narrative-generation]
outputs_to: [insight-narrative-generation, agent-evaluation-gates, red-team]
close_time: monthly
baseline: "unmeasured. Current discipline: pValue < 0.1 on the basket family (insight-generator.service.ts:872) and |z| >= 3 on anomalies (:1107). No multiple-comparison correction anywhere, against 573 types × live entities"
status: proposed
```

**How it closes.** Run the generator against permuted / shuffled data — where no real
association exists by construction — and count surviving "significant" findings. That
count *is* the false-discovery rate. If it is non-trivial, the threshold tightens or the
family is capped. The technique is borrowed directly from the culture artifact one
department over: `scripts/eval_merge_policies.py` killed three identity designs by testing
against **732,874 known-distinct pairs** (`intelligence.md:115-118`). Same idea, applied to
statistics instead of identity.

---

## E4 — Pipeline coverage

The counter-pressure to [[analytics-engine-premortem]] M2: correct functions, wrong
insights.

```yaml
type: loop
id: engine-pipeline-coverage
owner: analytics-bi
team: analytics-engine
measures: [analytics.engine_service_test_ratio, analytics.untested_service_lines]
changes: [analytics.spec_files, ci.required_diff_rule]
inputs_from: [reliability, engineering]
outputs_to: [insight-narrative-generation, metric-contract-truth-assurance]
close_time: monthly
baseline: "149 it() cases / 3,679 engine lines / 131 exported functions · 0 spec files / ~5,600 service lines. pValue and chi2 appear in zero assertions across all 11 spec files"
status: proposed
```

**First target is fixed, not negotiable.** The basket family end-to-end — transactions →
contingency table → χ² → `pValue` → the `lift > 1.3 && pValue < 0.1` gate at
`insight-generator.service.ts:872` — because it is the shortest path from untested
arithmetic to a sentence in front of a customer.

---

## E5 — Purity guard

```yaml
type: loop
id: engine-purity-guard
owner: analytics-bi
team: analytics-engine
measures: [analytics.engine_foreign_imports, analytics.headless_count_script_status]
changes: [ci.import_guard, engine.module_boundaries]
inputs_from: [engineering, reliability]
outputs_to: [metric-contract-truth-assurance]
close_time: per PR (CI), verified weekly by the headless script
baseline: "clean today — engine/ imports only ./-relative siblings; the headless count script runs (573 computed by bare ts-node, 2026-08-24)"
status: proposed
```

**Two signals, deliberately.** The grep catches the syntax; the headless script catches
the outcome. A grep-shaped guard with no outcome-side twin is exactly the false comfort
[[engineering-premortem]] M4 describes.

---

## Loops this team depends on but does not own

| Loop | Owner | Why we care |
|---|---|---|
| POS `checks` / `tables` ingestion | [[data-charter]] | Sets the ceiling on E1. 429 of 573 types (74.9%) are gated on `checks` alone |
| Insight acceptance | [[insight-narrative-generation-loops]] | The only external evidence that E3's discipline is working. Falling acceptance with rising type count is our M3 |
| Metric-claim census | [[metric-contract-truth-assurance-loops]] | Publishes our count. When the UI says 375 and we compute 573, they are the ones who catch it |
| Ground-truth agreement (§44.10) | [[metric-contract-truth-assurance-loops]] | The only loop that can prove our arithmetic against something external. Blocked on §44.7 |
