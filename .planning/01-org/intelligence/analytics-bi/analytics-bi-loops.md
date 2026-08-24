---
type: loops
division: intelligence
department: analytics-bi
status: provisional
metrics: [analytics.satisfiable_candidate_share, analytics.insight_acceptance_rate, analytics.kpi_ground_truth_agreement, analytics.metric_claim_divergence_count, analytics.engine_service_test_ratio]
updated: 2026-08-24
links: ["[[analytics-bi-charter]]", "[[analytics-bi-premortem]]", "[[analytics-bi-directive]]", "[[analytics-bi-schedule]]", "[[analytics-engine-loops]]", "[[insight-narrative-generation-loops]]", "[[metric-contract-truth-assurance-loops]]", "[[data-charter]]", "[[security-charter]]", "[[decision-office-charter]]", "[[LOOP-MAP]]"]
loop_count: 7
loop_count: 7
loop_count: 7
loop_ids: ["analytics-candidate-reach", "analytics-insight-acceptance", "analytics-metric-contract-integrity", "analytics-ground-truth-agreement", "analytics-test-coverage-inversion", "analytics-consultant-enablement-expiry", "analytics-published-claim-provenance"]
loop_close_times: ["weekly", "biweekly", "weekly", "monthly", "monthly", "weekly", "per-publication, audited monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "blocked", "proposed", "proposed", "proposed"]
---

# Analytics & BI — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Seven loops. Three are team-owned (one per team), two are cross-boundary contracts this
department does not control, and two are department-level guards against the mechanisms
in [[analytics-bi-premortem]].

---

## L1 — Candidate reach (AB-1)

The engine's honest reach, and the loop that names Data as the constraint rather than
hiding it.

```yaml
type: loop
id: analytics-candidate-reach
owner: analytics-bi
team: analytics-engine
measures: [analytics.satisfiable_candidate_share, analytics.candidate_type_count]
changes: [insight-catalog.dimensions, insight-catalog.measures, data.substrate_requests]
inputs_from: [data, engineering]
outputs_to: [data, insight-narrative-generation, product-and-vision]
close_time: weekly
baseline: "144/573 = 25.1% (consumption+orders+inventory); 38/573 = 6.6% (consumption only)"
status: proposed
```

**What it changes.** A falling share triggers a data request to [[data-charter]], never a
new `engine/*.ts` file. This is the mechanical form of the satisfiability gate in
[[analytics-bi-directive]] rule 1.

---

## L2 — Insight acceptance (AB-2)

Whether anything the department says is worth reading. Both halves of this loop already
exist in the schema and have never been joined.

```yaml
type: loop
id: analytics-insight-acceptance
owner: analytics-bi
team: insight-narrative-generation
measures: [analytics.insight_acceptance_rate, analytics.top_rank_ignore_rate]
changes: [insight-generator.scoring, recommendations.rule_set, insight-catalog.comparators]
inputs_from: [engineering, guest-experience]
outputs_to: [product-and-vision, research-and-math, design]
close_time: biweekly
baseline: "unmeasured — recommendation_impressions (denominator) and recommendation_actions (numerator) both exist; no query joins them"
status: proposed
```

**Why biweekly, not weekly.** At 11 restaurants a weekly acceptance rate is noise
(`AGENT_NATIVE_UI_DECISION.md:191-192`). Two weeks is the shortest window where the
number is worth reading at all, and even then it is reported with an `insufficient_data`
flag until volume supports it.

**The signal that matters most** is `top_rank_ignore_rate` — recommendations served at
`position = 1` and never acted on. That is the case the impressions migration was written
for (`20260817000000_recommendation_impressions.sql`: *"a top-ranked, ignored one is
informative"*).

---

## L3 — Metric contract integrity (AB-3)

The department's day-one auditable loop. Deliberately does **not** depend on SimPOS.

```yaml
type: loop
id: analytics-metric-contract-integrity
owner: analytics-bi
team: metric-contract-truth-assurance
measures: [analytics.metric_claim_divergence_count, analytics.registry_coverage_share]
changes: [metric-registry.definitions, ci.claim_assertions, docs.published_counts]
inputs_from: [analytics-engine, insight-narrative-generation, media-and-brand, strategy-and-fundraising]
outputs_to: [engineering, media-and-brand, decision-office]
close_time: weekly
baseline: "≥2 live divergences — insight-type count published as 375 (InsightCatalog.tsx:2, commands.ts:99, analytics.controller.ts:219) vs 573 (true, computed 2026-08-24); feature count 460 (ANALYTICS_FEATURE_CATALOG.md:5) vs 360 (metric-registry.ts:8, and the catalog's own tier table at :931-936)"
status: proposed
```

**What it changes.** Every divergence closes as a **CI assertion**, not as a
documentation edit. A divergence closed by editing a markdown file will reopen; that is
exactly how `ANALYTICS_FEATURE_CATALOG.md` sat behind a wrong header for two weeks
(`:5-13`).

---

## L4 — Ground-truth agreement (AB-3, blocked)

Published at **0%** with its blocker named. This loop exists in order to make a blocked
dependency into a visible number rather than an excuse.

```yaml
type: loop
id: analytics-ground-truth-agreement
owner: analytics-bi
team: metric-contract-truth-assurance
measures: [analytics.kpi_ground_truth_agreement]
changes: [analytics.service_computations, metric-registry.formulas]
inputs_from: [engineering]
outputs_to: [decision-office, strategy-and-fundraising]
close_time: monthly
blocked_by: "v3.0-TECH-DEBT.md:309 (§44.7 SimPOS simulator) — §44.10 is 'Stated #1 eval priority' (:322-325)"
baseline: "0% — unmeasurable until §44.7 lands"
status: blocked
```

**The close-time is the escalation, not the measurement.** Monthly, this loop emits one
of two things: a real agreement percentage, or a dated restatement to
[[decision-office-charter]] that §44.7 has still not shipped. Three consecutive
restatements make it a founder decision, not an engineering backlog item.

---

## L5 — Test-coverage inversion guard (department)

The department's tested half is not the half that ships numbers to the screen. This loop
watches the ratio rather than the absolute.

```yaml
type: loop
id: analytics-test-coverage-inversion
owner: analytics-bi
measures: [analytics.engine_service_test_ratio, analytics.untested_service_lines]
changes: [analytics.spec_files, ci.required_coverage]
inputs_from: [engineering, reliability]
outputs_to: [engineering, agent-evaluation-gates]
close_time: monthly
baseline: "149 it() cases over 3,679 engine lines; 0 spec files over ~5,600 service lines (insight-generator 1,200 · analytics.controller 837 · metric-registry 547 · advanced-analytics 526 · analytics.service 515 · table-analytics 496 · recommendations 417 · goals 375 · recommendation-actions 308 · consultants 217 · insight-scheduler 183)"
status: proposed
```

**Why this is a loop and not a task.** Adding tests to the service layer is a task.
Watching the *ratio* is a loop, because the failure mode is that engine tests keep
growing (they are pleasant to write) while the service layer stays at zero.

---

## L6 — Consultant enablement expiry (department, guard)

Direct counter-pressure to [[analytics-bi-premortem]] M4.

```yaml
type: loop
id: analytics-consultant-enablement-expiry
owner: analytics-bi
team: insight-narrative-generation
measures: [analytics.consultant_enabled_restaurants, analytics.consultant_enablement_age_days]
changes: [analytics_insight_prefs.enabled, consultants.system_prompt]
inputs_from: [security, sales]
outputs_to: [security, decision-office]
close_time: weekly
baseline: "default OFF by design (consultants.service.ts:11,18 — 'absent row ⇒ disabled'); no expiry mechanism exists; toggle route analytics.controller.ts:516 is unguarded (OD-20)"
status: proposed
```

**Closes by** listing every `analytics_insight_prefs` row with `category='consultants'`
and `enabled=true`, its age, and its named owner. A row with no named owner is switched
off at the end of the close-time — the default is OFF, so reverting to the default needs
no permission.

---

## L7 — Published-claim provenance (cross-boundary)

The loop that carries the founder's priority — *show people we have the right metrics* —
without letting it become *show people many metrics*.

```yaml
type: loop
id: analytics-published-claim-provenance
owner: analytics-bi
team: metric-contract-truth-assurance
measures: [analytics.claims_without_provenance, analytics.overclaimed_verb_count]
changes: [external.deck_claims, web.marketing_copy, api.openapi_descriptions]
inputs_from: [media-and-brand, strategy-and-fundraising, sales]
outputs_to: [media-and-brand, strategy-and-fundraising, red-team]
close_time: per-publication, audited monthly
baseline: "unmeasured. Known live instance: 'Browse all 375 insight types' shipped in apps/web/src/components/command/commands.ts:99 and apps/web/src/pages/InsightCatalog.tsx:2 against a true count of 573"
status: proposed
```

**The contract it enforces.** `YC_WEDGE_PLAN.md:31-33` — *"dollars recovered"* means **we
asked**, not we received. Any claim whose verb is stronger than its evidence is rewritten
before publication, and the register records the weaker phrasing as canonical.

---

## Loops this department depends on but does not own

| Loop | Owner | Why we care |
|---|---|---|
| NF event contract / cost telemetry | [[neural-footprint-instrumentation-charter]] *(RM-3)* | The consultant layer's spend is invisible: the NestJS surface emits no cost events (`intelligence.md:165-167`) |
| Endpoint classification & guards | [[security-charter]] + [[platform-api-charter]] | OD-20 — 39 unguarded analytics routes, including the consultant toggle and consult call |
| L0 substrate arrival (POS `checks`, `tables`) | [[data-charter]] | Directly sets the ceiling on L1: 25.1% → 100% is a data outcome, not a math outcome |
| SimPOS ground-truth ledger (§44.7) | [[engineering-charter]] | L4 reads 0% until it ships |
| NF `subject_type` for operators (F-3) | [[decision-office-charter]] / OD-11 | L2's metric has no home in the footprint until this closes |
