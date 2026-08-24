---
type: loops
division: platform
department: data
team: substrate-quality-coverage
status: provisional
metrics: [substrate.quarantine_rate, substrate.confidence_threshold_value, substrate.rows_without_source_guarantee, substrate.governance_tier_distribution, substrate.repair_class_closure_rate]
updated: 2026-08-24
links: ["[[substrate-quality-coverage-charter]]", "[[substrate-quality-coverage-premortem]]", "[[substrate-quality-coverage-directive]]", "[[substrate-quality-coverage-schedule]]", "[[data-loops]]", "[[corpora-enrichment-loops]]", "[[annotation-ground-truth-loops]]", "[[decision-office-charter]]", "[[architecture-review-charter]]", "[[LOOP-MAP]]"]
loop_count: 6
loop_count: 6
loop_ids: ["provenance-integrity-audit", "quarantine-rate-tracking", "threshold-change-review", "repair-class-closure", "substrate-progress-report", "gate-efficacy-review"]
loop_close_times: ["weekly", "daily", "monthly", "weekly", "daily", "quarterly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Substrate Quality & Coverage — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a diagram,
not a loop ([[ORG_STRUCTURE]] §5).

This team owns the department's **measurement** loops. Two of them are audits of itself,
because a team whose only output is judgement needs its judgement audited.

---

## 1. Provenance integrity — the department's load-bearing loop

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

**Absolute counts, never rates** — a few hundred contaminated gold rows is a catastrophe at
any rate. Non-zero escalates the same day. This is the one loop whose failure the department
cannot recover from ([[data-premortem]] M2), because it destroys the ability to detect the
others.

---

## 2. Quarantine rate and its knob — the loop that must show both numbers

```yaml
type: loop
id: quarantine-rate-tracking
owner: substrate-quality-coverage
measures: [substrate.quarantine_rate, substrate.confidence_threshold_value, substrate.governance_tier_distribution]
changes: [substrate.publish_gate]
inputs_from: [corpora-enrichment, pos-operational-telemetry-ingest]
outputs_to: [data, decision-office, analytics-bi]
close_time: daily
status: proposed
```

Reads `governance.py:107,227` and
`…20260817030000_under_identified_quarantine.sql`. **The rate is never emitted without the
threshold value that produced it** — falling quarantine on rising volume is progress, falling
quarantine because the bar moved is not
([[substrate-quality-coverage-premortem]] M1). Reported per category and per tier, so an
ungated category surfaces as suspiciously clean rather than vanishing into an aggregate (M4).

---

## 3. Threshold change review — the loop that audits our own knob

```yaml
type: loop
id: threshold-change-review
owner: decision-office
measures: [substrate.threshold_changes_by_cause, substrate.threshold_milestone_cooccurrence]
changes: [substrate.publish_gate, substrate.change_protocol]
inputs_from: [substrate-quality-coverage, data]
outputs_to: [red-team, data, substrate-quality-coverage]
close_time: monthly
status: proposed
```

**Owner is [[decision-office-charter]], not this team.** A threshold is a decision, and the
office that owns decision closure owns this record. The measured quantity is
**co-occurrence** — threshold changes landing in the same close-time as a coverage milestone —
because the change itself is usually correct and the pattern is what is dangerous.

The precedent on file (`…20260814000000_data_quality_rescale.sql:1-15`) is instance #1 and was
right. The loop exists for instances three and four.

---

## 4. Repair-class closure — the loop that keeps repairs from being a treadmill

```yaml
type: loop
id: repair-class-closure
owner: substrate-quality-coverage
measures: [substrate.repair_class_closure_rate, substrate.quarantine_recurrence_by_class]
changes: [corpora.enrichment_prompts, ontology.normalization_rules]
inputs_from: [corpora-enrichment]
outputs_to: [corpora-enrichment, data]
close_time: weekly
status: proposed
```

Quarantined rows go to the producer; what comes back here is the **rule change**, logged
through `…20260813120000_wine_repair_log.sql`. A repair that fixed a row and not a class will
recur, and recurrence-by-class is the measurement that proves it.

**This loop also carries a self-check:** this team's own name appearing in the repairer column
is a finding against itself ([[substrate-quality-coverage-premortem]] M3).

---

## 5. Daily substrate report — the department's public face

```yaml
type: loop
id: substrate-progress-report
owner: substrate-quality-coverage
measures: [corpora.demand_weighted_coverage, dish.coverage, sales.density, substrate.quarantine_rate, substrate.governance_tier_distribution]
changes: [data.intake_priority, data.agenda_board]
inputs_from: [corpora-enrichment, annotation-ground-truth, synthetic-generation-simulation, pos-operational-telemetry-ingest]
outputs_to: [product-vision, analytics-bi, engineering, decision-office]
close_time: daily
status: proposed
```

Named in [[README]] §6. This team **executes** two department-level counter-pressures inside
it: the **three-number rule** (wine · dish · sales, never one scalar —
[[data-premortem]] M3) and the **denominator rule** (every coverage figure names its base —
M1). A run that emits a single number is a failed run, regardless of what the number says.

**Anti-sprawl:** three consecutive runs producing no action downgrades this to weekly
([[README]] §6).

---

## 6. Gate-efficacy self-audit — the loop that can recommend disbanding this team

```yaml
type: loop
id: gate-efficacy-review
owner: substrate-quality-coverage
measures: [substrate.publishes_blocked_count, substrate.quarantined_rows_reaching_surfaces]
changes: [substrate.publish_gate_enforcement, data.team_structure]
inputs_from: [architecture-review, engineering]
outputs_to: [data, architecture-review, decision-office]
close_time: quarterly
status: proposed
```

Counts what the gate actually **stopped**. Two quarters at zero and this team's honest output
is a recommendation to merge itself back into the producers and hand the audit role to an
advisory function ([[substrate-quality-coverage-charter]] §reservation,
[[substrate-quality-coverage-premortem]] M2).

Paired with [[architecture-review-charter]]'s check for private corpora above L0 — this team
cannot see the consumers who quietly stopped reading its gated view (M5), which is precisely
why that half of the loop is owned outside it.
