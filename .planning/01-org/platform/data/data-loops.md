---
type: loops
division: platform
department: data
status: provisional
metrics: [corpora.demand_weighted_coverage, annotation.gold_set_freshness_days, synthetic.backtest_fidelity_gap, pos.line_resolution_rate, substrate.quarantine_rate, substrate.rows_without_source_guarantee, nf_a.cost_per_task]
updated: 2026-08-24
links: ["[[data-charter]]", "[[data-premortem]]", "[[data-directive]]", "[[data-schedule]]", "[[corpora-enrichment-loops]]", "[[annotation-ground-truth-loops]]", "[[synthetic-generation-simulation-loops]]", "[[pos-operational-telemetry-ingest-loops]]", "[[substrate-quality-coverage-loops]]", "[[LOOP-MAP]]", "[[README]]"]
loop_count: 6
loop_count: 6
loop_ids: ["data-substrate-daily-report", "demand-reprioritization", "provenance-integrity-audit", "threshold-change-review", "unresolved-queue-drain", "backtest-fidelity"]
loop_close_times: ["daily", "weekly", "weekly", "monthly", "weekly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Data — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop ([[ORG_STRUCTURE]] §5).

Six department-level loops. Team-level loops live in each team's `*-loops.md` and feed
these; the department does not duplicate them.

---

## 1. Daily substrate report — the department's heartbeat

Named in [[README]] §6 as a daily job emitting NF-A. It is the vehicle for the
three-number rule ([[data-premortem]] M3) and the denominator rule (M1).

```yaml
type: loop
id: data-substrate-daily-report
owner: data
measures: [corpora.demand_weighted_coverage, dish.coverage, sales.density, substrate.quarantine_rate, pos.line_resolution_rate, annotation.gold_set_freshness_days]
changes: [data.enrichment_queue_order, data.intake_priority, data.agenda_board]
inputs_from: [corpora-enrichment, annotation-ground-truth, synthetic-generation-simulation, pos-operational-telemetry-ingest, substrate-quality-coverage]
outputs_to: [product-vision, analytics-bi, engineering, decision-office]
close_time: daily
status: proposed
```

**Emits three L0 numbers, never one.** A run that emits a single scalar is a failed run.
**Anti-sprawl:** three consecutive runs producing no action downgrades this to weekly
([[README]] §6).

---

## 2. Demand reprioritization — the denominator loop

```yaml
type: loop
id: demand-reprioritization
owner: corpora-enrichment
measures: [corpora.demand_weighted_coverage, corpora.library_coverage, nf_a.cost_per_task]
changes: [corpora.enrichment_queue]
inputs_from: [pos-operational-telemetry-ingest, engineering]
outputs_to: [data, substrate-quality-coverage]
close_time: weekly
status: proposed
```

Reads `supabase/migrations/20260813170000_enrichment_demand_priority.sql:80-95` — demand
score from actual restaurant inventory and sales, not from an editor's judgement.
**Closes when** the next enrichment batch is re-sorted. **Both coverage figures are
published together**; if they diverge for three close-times, the queue is re-sorted, not
the report.

---

## 3. Provenance integrity audit — the invariant loop

```yaml
type: loop
id: provenance-integrity-audit
owner: substrate-quality-coverage
measures: [substrate.rows_without_source_guarantee, substrate.gold_set_contamination_count]
changes: [data.intake_contract, annotation.gold_set_membership]
inputs_from: [corpora-enrichment, annotation-ground-truth, synthetic-generation-simulation, pos-operational-telemetry-ingest]
outputs_to: [data, agent-evaluation-gates, research-math, red-team]
close_time: weekly
status: proposed
```

Reports **absolute counts, not rates** — 300 contaminated gold rows is a catastrophe at
any rate. Any non-zero value escalates to `OPEN-DECISIONS.md` the same day
([[data-directive]] escalation trigger 2).

---

## 4. Threshold change review — the auditor-independence loop

```yaml
type: loop
id: threshold-change-review
owner: substrate-quality-coverage
measures: [substrate.quarantine_rate, substrate.confidence_threshold_value, substrate.tier_boundary_values]
changes: [substrate.publish_gate]
inputs_from: [data, decision-office]
outputs_to: [decision-office, red-team, data]
close_time: monthly
status: proposed
```

Watches `services/agent-orchestrator/services/governance.py:53,107,227` and the
`data_quality_confidence` → `data_quality_rescale` migration line. **Rate and threshold are
always published together**; a fall caused by a knob and a fall caused by better data must
be visually distinguishable ([[data-premortem]] M4).

---

## 5. Unresolved queue drain — the fitness loop

```yaml
type: loop
id: unresolved-queue-drain
owner: pos-operational-telemetry-ingest
measures: [pos.unresolved_queue_depth, pos.line_resolution_rate, pos.worst_restaurant_resolution_rate]
changes: [pos.mapping_rules, catalogue.match_candidates]
inputs_from: [integration-engineering, catalogue-identity]
outputs_to: [analytics-bi, data, engineering]
close_time: weekly
status: proposed
```

Owns `supabase/migrations/20260805133000_pos_unresolved_lines_and_review_queues.sql`.
**Per restaurant, minimum and distribution — never the fleet mean.** Depth rising for two
consecutive close-times escalates ([[data-premortem]] M5).

---

## 6. Backtest fidelity — the "is our synthetic data lying to us" loop

```yaml
type: loop
id: backtest-fidelity
owner: synthetic-generation-simulation
measures: [synthetic.backtest_fidelity_gap]
changes: [docgen.degrade_profiles, synthetic.archetype_mix]
inputs_from: [annotation-ground-truth, research-math]
outputs_to: [research-math, agent-evaluation-gates, data]
close_time: monthly
status: proposed
```

Compares model scores on `datasets/sim/documents` against the real annotated gold set via
`scripts/docgen/backtest.py`. **Cannot close without a live gold set** — this loop has a
hard dependency on loop 3 and on [[annotation-ground-truth-loops]]. A fidelity number
computed against a stale oracle is worse than no number.

---

## Loop dependency, stated once

```
annotation (oracle) ──┬──> backtest-fidelity ──> synthetic trustworthiness
                      └──> provenance-integrity-audit ──> every accuracy claim
pos observed ─────────────> demand-reprioritization ────> enrichment queue order
enrichment ───────────────> threshold-change-review ────> publish gate
```

The oracle is upstream of everything. If [[annotation-ground-truth-charter]] stalls, loops
3 and 6 stop closing and the department loses the ability to detect its own failures —
which is [[data-premortem]] M2 arriving quietly rather than loudly.
