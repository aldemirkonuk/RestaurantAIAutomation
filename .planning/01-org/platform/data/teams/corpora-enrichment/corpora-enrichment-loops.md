---
type: loops
division: platform
department: data
team: corpora-enrichment
status: provisional
metrics: [corpora.demand_weighted_coverage, corpora.library_coverage, corpora.field_confidence_median, corpora.source_canary_pass_rate, nf_a.task_success_rate, nf_a.cost_per_task]
updated: 2026-08-24
links: ["[[corpora-enrichment-charter]]", "[[corpora-enrichment-premortem]]", "[[corpora-enrichment-directive]]", "[[corpora-enrichment-schedule]]", "[[data-loops]]", "[[annotation-ground-truth-loops]]", "[[substrate-quality-coverage-loops]]", "[[LOOP-MAP]]"]
loop_count: 4
loop_ids: ["enrichment-demand-reprioritization", "enrichment-depth-cost", "external-source-canary", "enrichment-repair"]
loop_close_times: ["weekly", "weekly", "daily", "weekly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed"]
---

# Corpora & Enrichment — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a diagram,
not a loop ([[ORG_STRUCTURE]] §5).

---

## 1. Demand reprioritization — the loop that decides what we work on

```yaml
type: loop
id: enrichment-demand-reprioritization
owner: corpora-enrichment
measures: [corpora.demand_weighted_coverage, corpora.library_coverage]
changes: [corpora.enrichment_queue]
inputs_from: [pos-operational-telemetry-ingest, catalogue-identity]
outputs_to: [data, substrate-quality-coverage]
close_time: weekly
status: proposed
```

**Measures → changes:** live `demand_score` (`…enrichment_demand_priority.sql:80-95`)
re-sorts next week's batches. **Closes when** the batch is drawn from the refreshed
function. **Both coverage numbers publish together**, always
([[corpora-enrichment-premortem]] M1).

---

## 2. Depth-vs-cost loop — the loop that stops cheap becoming shallow

```yaml
type: loop
id: enrichment-depth-cost
owner: corpora-enrichment
measures: [corpora.field_confidence_median, nf_a.cost_per_task, nf_a.task_success_rate]
changes: [enrichment.pipeline_stages, enrichment.required_field_set]
inputs_from: [model-routing-inference-economics, substrate-quality-coverage]
outputs_to: [data, model-routing-inference-economics]
close_time: weekly
status: proposed
```

Cost and depth are **published as a pair**. A falling cost with falling depth is a decision
about what "enriched" means and goes to the department; a falling cost with flat depth is a
genuine win and gets celebrated as one ([[corpora-enrichment-premortem]] M2).

---

## 3. Source canary loop — the loop that catches rotted scrapers

```yaml
type: loop
id: external-source-canary
owner: corpora-enrichment
measures: [corpora.source_canary_pass_rate, corpora.source_output_shape_drift]
changes: [enrichment.active_sources]
inputs_from: [annotation-ground-truth]
outputs_to: [substrate-quality-coverage, data]
close_time: daily
status: proposed
```

Six internet-facing services (`wine_book_scraper`, `web_verification_service`,
`auction_wine_service`, `critic_score_service`, `wine_research_service`, prompt retrieval)
each run against a small canary set whose answers come from
[[annotation-ground-truth-charter]]. **Daily close-time, because the cost of being wrong
accrues hourly.** A failed canary removes the source unilaterally
([[corpora-enrichment-directive]]).

---

## 4. Repair loop — the loop back from quarantine

```yaml
type: loop
id: enrichment-repair
owner: corpora-enrichment
measures: [corpora.quarantined_rows_repaired, corpora.repair_success_rate]
changes: [corpora.row_values, enrichment.prompt_templates]
inputs_from: [substrate-quality-coverage]
outputs_to: [substrate-quality-coverage, catalogue-identity]
close_time: weekly
status: proposed
```

Rows the auditor quarantined (`…20260817030000_under_identified_quarantine.sql`) come back
here for repair, logged through `…20260813120000_wine_repair_log.sql`. **The important
output is not the repaired row — it is the prompt or pipeline change** that stops the class
recurring. A repair loop that only fixes rows is a treadmill.

---

## Dependencies

- Loop 3 **cannot run** without a gold set from [[annotation-ground-truth-charter]]. No
  oracle, no canary, no detection of M4.
- Loop 1 **cannot run** without POS demand signal from
  [[pos-operational-telemetry-ingest-charter]]. If line-resolution is poor, `demand_score`
  is computed on the resolvable half only — which quietly re-introduces
  [[corpora-enrichment-premortem]] M1 through the back door, with the *right* metric name.
