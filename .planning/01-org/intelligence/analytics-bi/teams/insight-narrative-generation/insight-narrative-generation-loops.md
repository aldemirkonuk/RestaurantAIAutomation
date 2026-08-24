---
type: loops
division: intelligence
department: analytics-bi
team: insight-narrative-generation
status: provisional
metrics: [analytics.insight_acceptance_rate, analytics.top_rank_ignore_rate, analytics.insight_feedback_coverage, analytics.served_rule_concentration, analytics.consultant_enabled_restaurants]
updated: 2026-08-24
links: ["[[insight-narrative-generation-charter]]", "[[insight-narrative-generation-premortem]]", "[[insight-narrative-generation-directive]]", "[[insight-narrative-generation-schedule]]", "[[analytics-bi-loops]]", "[[analytics-engine-loops]]", "[[metric-contract-truth-assurance-loops]]", "[[guest-experience-charter]]", "[[security-charter]]", "[[LOOP-MAP]]"]
---

# Insight & Narrative Generation — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## N1 — Insight acceptance

The team's primary loop. Both halves already exist in the schema; the loop is the join.

```yaml
type: loop
id: narrative-insight-acceptance
owner: analytics-bi
team: insight-narrative-generation
measures: [analytics.insight_acceptance_rate, analytics.top_rank_ignore_rate]
changes: [insight-generator.ranking, recommendations.rule_set, insight-verbalizer.templates]
inputs_from: [analytics-engine, engineering]
outputs_to: [analytics-engine, product-and-vision, design, research-and-math]
close_time: biweekly
baseline: "unmeasured. recommendation_impressions (per-render, with position and request_id) and recommendation_actions (per rule_key) both populated; no query joins them"
status: proposed
```

**Why biweekly.** A weekly reading at 11 restaurants is noise —
`AGENT_NATIVE_UI_DECISION.md:190-192` records that restaurant traffic swings 30–60% week to
week, and `:332-337` that proving a 10% lift needs ~800 conversions per arm. The reported
number carries an explicit `insufficient_data` flag until volume supports it. **We apply to
ourselves the posture we ship to the customer.**

**The join is not naive.** `recommendation_actions` is keyed by `rule_key` (a dismissal is
sticky per rule); `recommendation_impressions` is per-render. The loop's first deliverable
is the *correct* join definition, registered with
[[metric-contract-truth-assurance-charter]] before any number is published.

---

## N2 — Feedback coverage

The loop that stops N1 from reporting a healthy number about 1.4% of the surface.

```yaml
type: loop
id: narrative-feedback-coverage
owner: analytics-bi
team: insight-narrative-generation
measures: [analytics.insight_feedback_coverage]
changes: [analytics_insights.schema, insights.disposition_api, web.insight_card_actions]
inputs_from: [engineering, design]
outputs_to: [engineering, analytics-engine, research-and-math]
close_time: monthly
baseline: "8 of 581 surfaced narrative objects can receive a disposition — the 8 rules in recommendations.service.ts. analytics_insights (baseline migration :2194-2209) has candidate_key, sentence, score, effect_pct, z_score, evidence and NO disposition column"
status: proposed
```

**Closes when** an insight can be dismissed, marked helpful, or acted on the same way a
recommendation can — and the coverage number is published beside the acceptance rate every
time.

---

## N3 — Served-distribution health

The counter-pressure to a feed collapsing onto three reflexively-clicked rules.

```yaml
type: loop
id: narrative-served-distribution
owner: analytics-bi
team: insight-narrative-generation
measures: [analytics.served_rule_concentration, analytics.distinct_rules_acted, analytics.top_rank_ignore_rate]
changes: [insight-generator.ranking, recommendations.rule_set]
inputs_from: [analytics-engine]
outputs_to: [analytics-engine, red-team]
close_time: biweekly, alongside N1
baseline: "unmeasured. 8 rules exist; impressions carry 1-indexed position and a request_id grouping one getRecommendations() call, so the served list is exactly reconstructable"
status: proposed
```

**Why it exists.** The impressions migration states the failure it guards against verbatim:
*"a recommender trained only on conversions learns its own priors … the long tail becomes
invisible — invisibly, because offline metrics improve as it degrades."* Rising acceptance
with falling distinct-acted-rule count is the tell.

---

## N4 — Support-floor integrity

```yaml
type: loop
id: narrative-support-floor-integrity
owner: analytics-bi
team: insight-narrative-generation
measures: [analytics.unnamed_threshold_count, analytics.insufficient_data_render_rate]
changes: [insight-generator.thresholds, web.empty_state]
inputs_from: [analytics-engine]
outputs_to: [analytics-engine, design, metric-contract-truth-assurance]
close_time: per PR (CI), reviewed monthly
baseline: "5 unnamed threshold literals (insight-generator.service.ts :200, :550, :867, :1017, :1107) plus 4 magic constants in scoreOf (:192-203). Zero spec files cover any of them"
status: proposed
```

**Two measures, deliberately.** The first counts unnamed literals (falls to zero and stays
there). The second — how often we render `insufficient_data` — is the one that must **not**
be driven to zero. A product that never says "we cannot tell" at 11 restaurants is lying.

---

## N5 — Consultant enablement expiry

```yaml
type: loop
id: narrative-consultant-expiry
owner: analytics-bi
team: insight-narrative-generation
measures: [analytics.consultant_enabled_restaurants, analytics.consultant_enablement_age_days, analytics.consultant_claims_without_evidence]
changes: [analytics_insight_prefs.enabled, consultants.system_prompt]
inputs_from: [security, sales]
outputs_to: [security, decision-office, metric-contract-truth-assurance]
close_time: weekly
baseline: "default OFF by design (consultants.service.ts:11,18); no expiry mechanism exists; the toggle route (analytics.controller.ts:516) and the Opus consult route (:531) are both unguarded — OD-20"
status: proposed
```

**Closes by** listing every enabled row with its age and named owner. Unowned rows revert to
the code's own default. The third measure —
`consultant_claims_without_evidence` — is sampled by AB-3, not self-reported by this team.

---

## Loops this team depends on but does not own

| Loop | Owner | Why we care |
|---|---|---|
| Candidate reach | [[analytics-engine-loops]] | We can only narrate what is computable — 25.1% today |
| False-discovery estimate | [[analytics-engine-loops]] | If the underlying findings are noise, ranking them better is worse, not better |
| Endpoint guards (OD-20) | [[security-charter]] / [[platform-api-charter]] | N5 is not fully mitigable from inside this team until it closes |
| NF `subject_type` for operators (F-3) | [[decision-office-charter]] / OD-11 | N1's signal has no home in the footprint |
| Cost telemetry on NestJS model calls | [[neural-footprint-instrumentation-charter]] *(RM-3)* | Consultant spend is invisible today; the NestJS surface emits none (`intelligence.md:165-167`) |
| Guest personalization | [[guest-experience-charter]] *(Product)* | We consume NF-B in aggregate; the guest-facing narrative is theirs |
