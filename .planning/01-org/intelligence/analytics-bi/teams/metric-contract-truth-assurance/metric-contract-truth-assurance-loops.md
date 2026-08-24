---
type: loops
division: intelligence
department: analytics-bi
team: metric-contract-truth-assurance
status: provisional
metrics: [analytics.metric_claim_divergence_count, analytics.kpi_ground_truth_agreement, analytics.registry_binding_share, analytics.silent_zero_paths, analytics.claims_without_provenance]
updated: 2026-08-24
links: ["[[metric-contract-truth-assurance-charter]]", "[[metric-contract-truth-assurance-premortem]]", "[[metric-contract-truth-assurance-directive]]", "[[metric-contract-truth-assurance-schedule]]", "[[analytics-bi-loops]]", "[[analytics-engine-loops]]", "[[insight-narrative-generation-loops]]", "[[engineering-charter]]", "[[decision-office-charter]]", "[[media-and-brand-charter]]", "[[LOOP-MAP]]"]
loop_count: 5
loop_count: 5
loop_ids: ["truth-claim-divergence-census", "truth-ground-truth-agreement", "truth-registry-binding", "truth-silent-zero-elimination", "truth-published-claim-provenance"]
loop_close_times: ["weekly, plus before every external publication", "monthly", "monthly", "weekly sweep; structural fix tracked monthly", "per publication (gate), audited monthly"]
loop_statuses: ["proposed", "blocked", "proposed", "proposed", "proposed"]
---

# Metric Contract & Truth Assurance — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Five loops. **T1 is the one that matters most**, because it is the only one that needs
nothing from anyone else — and a team whose sole metric is blocked gets quietly dropped
([[analytics-bi-premortem]] M1).

---

## T1 — Claim divergence census

Day one. No dependencies. No simulator, no POS feed, no other unit.

```yaml
type: loop
id: truth-claim-divergence-census
owner: analytics-bi
team: metric-contract-truth-assurance
measures: [analytics.metric_claim_divergence_count, analytics.divergences_closed_structurally]
changes: [ci.count_assertions, web.runtime_derived_counts, metric-registry.definitions]
inputs_from: [analytics-engine, insight-narrative-generation, media-and-brand, strategy-and-fundraising]
outputs_to: [engineering, media-and-brand, decision-office]
close_time: weekly, plus before every external publication
baseline: "≥2 — (a) insight-type count published as 375 at InsightCatalog.tsx:2, commands.ts:78,99 and analytics.controller.ts:219, as 348 at LLM_INSTRUCTION_PROMPTS.md:167, and as 573 (true) at AGENT_NATIVE_UI_DECISION.md:64,100,105 and YC_WEDGE_PLAN.md:280,324; (b) feature count 460 at ANALYTICS_FEATURE_CATALOG.md:5 vs 360 at metric-registry.ts:8 and in the catalog's own tier table at :931-936"
status: proposed
```

**Two measures, deliberately.** The count of open divergences is the obvious one; the share
closed **structurally** — by a runtime derivation or a CI assertion rather than an edit — is
the honest one ([[metric-contract-truth-assurance-premortem]] M2).

**Weekly is not the only trigger.** A weekly job cannot catch a deck written on a Tuesday,
so the census also runs before every external publication.

---

## T2 — Ground-truth agreement (blocked, published anyway)

```yaml
type: loop
id: truth-ground-truth-agreement
owner: analytics-bi
team: metric-contract-truth-assurance
measures: [analytics.kpi_ground_truth_agreement]
changes: [analytics.service_computations, metric-registry.formulas]
inputs_from: [engineering]
outputs_to: [analytics-engine, decision-office, strategy-and-fundraising]
close_time: monthly
blocked_by: "v3.0-TECH-DEBT.md:309 (§44.7 SimPOS, 'critical path'). §44.10 is the 'stated #1 eval priority' (:322-325)"
baseline: "0% — unmeasurable until §44.7 lands. Published unchanged, with the blocker dated."
status: blocked
```

**The close-time is the escalation, not the measurement.** Monthly this loop emits either a
real agreement percentage or a dated restatement. **Three consecutive unchanged
restatements escalate to the founder** via [[decision-office-charter]].

**The interim is explicitly not a substitute.** Hand-computed fixtures — 20 checks, 5 wines,
3 tables, arithmetic done on paper — give real external verification today. They are
reported under their own name, never as `kpi_ground_truth_agreement`
([[metric-contract-truth-assurance-directive]] rule 3).

---

## T3 — Registry binding

Turns the semantic layer from a served brochure into an enforced contract.

```yaml
type: loop
id: truth-registry-binding
owner: analytics-bi
team: metric-contract-truth-assurance
measures: [analytics.registry_binding_share, analytics.registry_key_count]
changes: [metric-registry.engineFns, metric-registry.computed_flags, analytics.spec_files]
inputs_from: [analytics-engine]
outputs_to: [analytics-engine, insight-narrative-generation]
close_time: monthly
baseline: "0% of 33 keys bound. All 33 declare computed:true. METRIC_BY_KEY (metric-registry.ts:537-539) is used by nothing outside the file; there is no compute(metricKey) dispatch anywhere. The registry is filtered and served (analytics.service.ts:36-46 → GET /analytics/metrics) and never consulted when a number is produced"
status: proposed
```

**Closes when** `engineFns` is an import that fails to compile on a rename, a test calls it,
and `computed: true` is derived from that binding rather than hand-set.

---

## T4 — Silent-zero elimination

```yaml
type: loop
id: truth-silent-zero-elimination
owner: analytics-bi
team: metric-contract-truth-assurance
measures: [analytics.silent_zero_paths, analytics.all_zero_restaurant_sweeps]
changes: [analytics.metric_result_type, web.insufficient_data_state]
inputs_from: [engineering, analytics-engine]
outputs_to: [insight-narrative-generation, design, reliability]
close_time: weekly sweep; structural fix tracked monthly
baseline: "8 Promise.allSettled sites across 5 files, each collapsing a failed query into an empty result via an ok() helper — analytics.service.ts, advanced-analytics.service.ts:501, recommendations.service.ts:87, consultants.service.ts:113, insights/insight-generator.service.ts:265"
status: proposed
```

**The weekly sweep is the cheap half and it exists today:** flag any restaurant whose
computed metric set is *entirely* zero/null across a refresh cycle. That pattern is nearly
impossible from real data and near-certain from a failed query — and it is exactly the
signature of the incident already recorded at `analytics.service.ts:57-66`, where *"every
metric downstream silently reported 0/null for every restaurant."*

**The structural half** is a third result state: `value | null | unavailable`, with
`unavailable` rendering as the `insufficient_data` screen
[[insight-narrative-generation-charter]] owns. The goal is not to stop degrading gracefully;
it is to never let degradation be invisible.

---

## T5 — Published-claim provenance

The loop that carries the founder's priority outward without letting *"show people we have
the right metrics"* become *"show people many metrics."*

```yaml
type: loop
id: truth-published-claim-provenance
owner: analytics-bi
team: metric-contract-truth-assurance
measures: [analytics.claims_without_provenance, analytics.overclaimed_verb_count, analytics.register_entries_added]
changes: [external.deck_claims, web.marketing_copy, api.openapi_descriptions]
inputs_from: [media-and-brand, strategy-and-fundraising, sales, growth]
outputs_to: [media-and-brand, strategy-and-fundraising, red-team, decision-office]
close_time: per publication (gate), audited monthly
baseline: "register does not exist. Known live instance: 'Browse all 375 insight types' shipped at apps/web/src/components/command/commands.ts:99 and apps/web/src/pages/InsightCatalog.tsx:2 against a true count of 573"
status: proposed
```

**A pre-publication gate, not a post-publication audit.** A claim with no `path:line` and no
defensible verb does not ship, which means the veto is exercised by process rather than by
confrontation ([[metric-contract-truth-assurance-premortem]] M5).

**Register entry #1 is already written:** `YC_WEDGE_PLAN.md:31-33` — *"dollars recovered"*
means **we asked**, not we received, until an 812 credit memo is modelled.

**Watch the inverse signal.** A month with **zero** register entries reads as a failure to
audit, not a clean month.

---

## Loops this team depends on but does not own

| Loop | Owner | Why we care |
|---|---|---|
| SimPOS ground-truth ledger (§44.7) | [[engineering-charter]] | T2 reads 0% until it ships. Our single most important escalation |
| Candidate reach / requirement integrity | [[analytics-engine-loops]] | Their `requires` declarations feed a number we audit. One is already wrong (`goals`) |
| Insight acceptance join definition | [[insight-narrative-generation-loops]] | We countersign the definition **before** any acceptance rate is published |
| Endpoint guards (OD-20) | [[security-charter]] | A metrics department demoing behind an unguarded Opus route is itself a claim we cannot defend |
| Golden sets for nondeterministic output | [[agent-evaluation-gates-charter]] *(RM-2)* | Adjacent, deliberately separate. Their thresholds are judged; ours is exact equality |
