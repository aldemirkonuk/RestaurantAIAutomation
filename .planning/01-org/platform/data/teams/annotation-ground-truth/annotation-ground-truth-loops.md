---
type: loops
division: platform
department: data
team: annotation-ground-truth
status: provisional
metrics: [annotation.gold_set_freshness_days, annotation.gold_set_size, annotation.inter_annotator_agreement, annotation.correction_to_rule_conversion_rate, annotation.rubber_stamp_rate]
updated: 2026-08-24
links: ["[[annotation-ground-truth-charter]]", "[[annotation-ground-truth-premortem]]", "[[annotation-ground-truth-directive]]", "[[annotation-ground-truth-schedule]]", "[[data-loops]]", "[[corpora-enrichment-loops]]", "[[synthetic-generation-simulation-loops]]", "[[research-math-charter]]", "[[LOOP-MAP]]"]
loop_count: 5
loop_count: 5
loop_ids: ["gold-set-freshness", "active-learning-correction", "blind-subset-agreement", "annotator-agreement", "canary-set-supply"]
loop_close_times: ["weekly", "weekly", "monthly", "monthly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Annotation & Ground Truth — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a diagram,
not a loop ([[ORG_STRUCTURE]] §5).

---

## 1. Freshness loop — the one that keeps the oracle alive

```yaml
type: loop
id: gold-set-freshness
owner: annotation-ground-truth
measures: [annotation.gold_set_freshness_days, annotation.gold_set_size]
changes: [annotation.weekly_quota, annotation.task_types_in_scope]
inputs_from: [data, research-math]
outputs_to: [data, corpora-enrichment, synthetic-generation-simulation, agent-evaluation-gates]
close_time: weekly
status: proposed
```

**Measures → changes:** days-since-newest per task type drives the quota and, when the quota
is repeatedly missed, the *number of task types in scope*. The honest lever is usually
scope, not effort ([[annotation-ground-truth-directive]] escalation 7). Alarm at **30 days**.

---

## 2. Correction → rule loop — the one that already exists in code

```yaml
type: loop
id: active-learning-correction
owner: annotation-ground-truth
measures: [annotation.correction_to_rule_conversion_rate, parser.field_accuracy]
changes: [parser.learned_rules]
inputs_from: [engineering, substrate-quality-coverage]
outputs_to: [research-math, corpora-enrichment]
close_time: weekly
status: proposed
```

This is `services/agent-orchestrator/services/active_learning_service.py:14-17` made
accountable: *correction → accuracy tracker → rule learner → benchmark validation → merge*.
**The loop only closes if the benchmark is partitioned** — intersection with the correction
stream asserted empty every run, not reviewed ([[annotation-ground-truth-premortem]] M4).
Watched from both ends: near-zero conversion means the loop is data entry, near-one means it
is accepting rules it should reject.

---

## 3. Verification-integrity loop — the one that proves humans are still looking

```yaml
type: loop
id: blind-subset-agreement
owner: annotation-ground-truth
measures: [annotation.rubber_stamp_rate, annotation.blind_vs_prelabel_divergence, annotation.seconds_per_document]
changes: [annotation.prelabel_workflow]
inputs_from: []
outputs_to: [data, research-math]
close_time: monthly
status: proposed
```

A fixed fraction of documents labelled with **no pre-label shown**; divergence between the
blind and pre-labelled populations is the measurement. Divergence → the pre-label workflow is
producing confirmation, not verification ([[annotation-ground-truth-premortem]] M2). Median
seconds-per-document is tracked in the same loop: speed arriving without a tooling change is
investigated, not celebrated.

---

## 4. Agreement / guideline loop — the one that turns judgement calls into conventions

```yaml
type: loop
id: annotator-agreement
owner: annotation-ground-truth
measures: [annotation.inter_annotator_agreement, annotation.guideline_open_questions]
changes: [annotation.labelling_guideline]
inputs_from: [research-math]
outputs_to: [data, research-math]
close_time: monthly
status: proposed
```

5% of documents double-labelled — **intra-annotator, weeks apart, while there is one
person**, which still catches drift and ambiguity. Every disagreement resolved becomes a line
in the guideline. **This loop cannot close today**: there is no guideline document and the
agreement metric is undefined, not low ([[annotation-ground-truth-premortem]] M3). Stated as
a gap rather than dressed up as a measurement.

---

## 5. Canary supply loop — this team's obligation to its siblings

```yaml
type: loop
id: canary-set-supply
owner: annotation-ground-truth
measures: [corpora.source_canary_pass_rate]
changes: [annotation.canary_sets]
inputs_from: [corpora-enrichment]
outputs_to: [corpora-enrichment]
close_time: monthly
status: proposed
```

Small per-source canary sets with known-correct answers, feeding
[[corpora-enrichment-loops]] loop 3. Cheap — mostly reuses existing gold — and it is what
lets a sibling team detect rotted scrapers. Recorded as a loop rather than a favour, because
favours do not have close-times.

---

## Dependency note — why this team is upstream of the department's eyesight

```
gold set (fresh) ──> corpora-enrichment canaries ──> detects rotted scrapers
gold set (fresh) ──> synthetic backtest fidelity ──> detects unrepresentative synthetic data
gold set (fresh) ──> nf_a doneability verdicts   ──> detects agent regressions
```

All three consumers keep producing confident numbers when the gold set goes stale. **Nothing
downstream alarms.** That property is why freshness — not size — is this team's primary
metric, and why [[data-premortem]] treats a contaminated or frozen oracle as the department's
only unsurvivable failure.
