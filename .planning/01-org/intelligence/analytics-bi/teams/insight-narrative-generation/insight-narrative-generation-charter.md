---
type: charter
division: intelligence
department: analytics-bi
team: insight-narrative-generation
status: exists
metrics: [analytics.insight_acceptance_rate, analytics.top_rank_ignore_rate, analytics.insight_feedback_coverage, analytics.consultant_enabled_restaurants, nf_b.aggregate_guest_signal_consumed]
updated: 2026-08-24
links: ["[[insight-narrative-generation-premortem]]", "[[insight-narrative-generation-agenda-full]]", "[[insight-narrative-generation-agenda-board]]", "[[insight-narrative-generation-directive]]", "[[insight-narrative-generation-loops]]", "[[insight-narrative-generation-schedule]]", "[[analytics-bi-charter]]", "[[analytics-engine-charter]]", "[[metric-contract-truth-assurance-charter]]", "[[guest-experience-charter]]", "[[harness-and-model-routing-charter]]", "[[security-charter]]", "[[intelligence]]"]
---

# Insight & Narrative Generation — Charter

Department: **Analytics & BI** ([[analytics-bi-charter]]) · Division: **Intelligence**.
Siblings: [[analytics-engine-charter]], [[metric-contract-truth-assurance-charter]].

**The question this team owns: *is it worth saying?***

## Mandate

Own everything between a correct number and a manager doing something differently:
candidate scoring, ranking, verbalization, the toggle-gated LLM consultant layer, and the
recommendation-action loop that measures whether any of it was worth reading. AB-1's
output is a number; this team's output is **a sentence a manager acts on** — and the
absence of a sentence, when the evidence is too thin, is equally this team's product.

This team also owns the `insufficient_data` posture. `AGENT_NATIVE_UI_DECISION.md:191-192`
already states the standard: *"At 11 restaurants the honest verdict on nearly every change
is 'we cannot tell.' A system that says so is more valuable than one that guesses."*
Saying so is a feature this team ships, not an outage it apologises for.

## Boundaries

Owns outright:

- **Steps 4–5 of the insight pipeline** (`insight-generator.service.ts:16-30`): VERBALIZE
  and RANK. Steps 2–3 (COMPUTE, SCORE) belong to [[analytics-engine-charter]].
- **`insights/insight-verbalizer.ts`** (167 lines) — 100% template-based by design, so
  *"every number in a sentence comes straight from the math"* (`:1-11`).
- **`insights/insight-scheduler.service.ts`** (183 lines) — the manager-preference refresh
  cadence (`hourly | daily | weekly | manual`, `:8-17`) across 10 categories.
- **`recommendations.service.ts`** (417 lines) — **8 deterministic rules** and the served
  list.
- **`recommendation-actions.service.ts`** (308 lines) — act / dismiss / snooze / done / pin
  / assign / feedback.
- **`consultants.service.ts`** (217 lines) — the four-persona LLM layer, its evidence-pack
  constraint, and its default-OFF toggle.
- **The empty state.** What a manager sees when there is nothing honest to say.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Whether the arithmetic is right | [[analytics-engine-charter]] | We do not fix math; we decline to publish it |
| Whether a number matches its published definition | [[metric-contract-truth-assurance-charter]] | AB-3 audits our sentences too, and must be able to say one is false |
| Guest taste fingerprints, personalization, the guest-facing surface | [[guest-experience-charter]] *(Product)* | We own the **operator-facing** narrative and consume NF-B in aggregate only (`intelligence.md:490`) |
| How the insight card looks | [[design-charter]] / [[client-surfaces-charter]] | We own the sentence and the empty state; they own the pixels |
| The model call itself — retry, routing, cost, timeout | [[harness-and-model-routing-charter]] *(RM-1)* | `consultants.service.ts:159` is one of RM-1's seven raw-`fetch` callsites, with **no retry/backoff at all** (`intelligence.md:81-83`) |
| Guarding `/analytics/consult` and the consultant toggle | [[security-charter]] / [[platform-api-charter]] | OD-20 is theirs to fix; ours to refuse to demo behind |

## Metrics it moves

### Primary — `analytics.insight_acceptance_rate`

Acted-or-pinned ÷ surfaced. **A dismissed insight is a correct number that failed at this
team's actual job** (`intelligence.md:421-423`).

**Both halves exist in the schema and have never been joined.**

- Denominator: `recommendation_impressions` — one row per recommendation **actually
  rendered**, with its 1-indexed `position`, grouped by `request_id`
  (`supabase/migrations/20260817000000_recommendation_impressions.sql`). Written
  fire-and-forget on every `getRecommendations()` call
  (`recommendations.service.ts:373-382`, `:392-414`).
- Numerator: `recommendation_actions` — `status`, `pinned`, `acted_at`, `feedback`,
  `assigned_to`.

### Secondary — `analytics.top_rank_ignore_rate`

Recommendations served at `position = 1` and never acted on. The impressions migration was
written for exactly this case: *"a low-ranked, ignored recommendation is expected; a
top-ranked, ignored one is informative."*

### The metric this team cannot yet measure — `analytics.insight_feedback_coverage`

⚠️ **The 573-type insight surface has no feedback capture at all.**
`analytics_insights` (baseline migration `:2194-2209`) carries `candidate_key`, `sentence`,
`score`, `effect_pct`, `z_score`, `evidence`, `computed_at` — **and no disposition column
whatsoever**. No dismissed, no acted, no helpful/not-helpful.

So `insight_acceptance_rate` is measurable over **8 recommendation rules** and *not*
measurable over **573 insight types**. The surface the founder wants to lead with is the
surface with no feedback loop. Closing that gap is this team's largest single deliverable.

**A measurement subtlety worth stating up front:** `recommendation_actions` is keyed by
`rule_key`, not by occurrence — a dismissal is *sticky per rule*. The impressions table is
per-render. Joining a per-render denominator to a per-rule numerator is not a naive ratio,
and getting it wrong would produce exactly the kind of confidently-wrong metric this
department exists to prevent.

### Neural footprint — the gap this metric exposes

The restaurant manager acting on a recommendation is **neither an agent nor a guest**.
`foundation §4.4` defines `subject_type` as `agent | guest | bio`, so the strongest
human-preference signal the product already collects has **no home in the neural
footprint**. `recommendation_actions.created_by` (baseline `:4922`) already stores the
operator's identity; NF has nowhere to put it. Raised as **F-3**
(`intelligence.md:519`); interacts with OD-11.

## Evidence today

**EXISTS.**

### The generation stack is real

- `insights/insight-generator.service.ts` (1,200 lines) executes the candidate space and
  documents its own pipeline at `:16-30`. `getCatalogSummary()` (`:41-45`) already returns
  `totalCandidateTypes` derived at runtime — the endpoint that would have prevented the
  375-vs-573 divergence exists and is not used for the number printed above it.
- `insight-verbalizer.ts` — deterministic templates, and its output is **treated as
  testable**: `insight-catalog.spec.ts:63-92` asserts the sentences read correctly
  ("Tuesday sales", "12% lower", "Table 4 ranks #1 of 12", "3.1×"). Verbalization is not
  decoration in this codebase.
- `insight-scheduler.service.ts:8-17` — per restaurant × category cadence, defaulting to
  daily @ 06:00, failures isolated per restaurant.
- `recommendations.service.ts` — 8 rules (`:120` `sales_below_weekday_baseline`, `:137`
  `weekly_demand_slide`, `:184` `plowhorse_repricing`, `:198` `puzzle_activation`, `:211`
  `vendor_concentration`, `:223` `revenue_concentration`, `:272` `staff_spread`, `:286`
  `pairing_promotion`), each carrying `observation` / `recommendation` / `rationale` —
  *"Rule that fired — auditable, deterministic"* (`:22`).

### The consultant layer is well designed and correctly gated

`consultants.service.ts:7-24`: default OFF, toggle-gated per restaurant via
`analytics_insight_prefs`, *"absent row ⇒ disabled"* (`:18`), four personas
(`:31-40` — finance, economics, statistics, physics-operations), sitting **on top of** the
deterministic math rather than replacing it, and *"every claim must cite the evidence it
rests on — the prompt forbids inventing numbers"* (`:14-15`). The statistician persona is
explicitly instructed to *"flag when data is too thin to support a claim"* (`:37`) — the
`insufficient_data` posture is already in the prompt.

### The `insufficient_data` seed already exists in code

`insight-verbalizer.ts` returns `null` rather than a sentence when evidence is missing, and
`insight-catalog.spec.ts:94-101` asserts it. What does **not** exist is the rendered
consequence: a feed that explains *why* it is empty.

### Known gaps — PARTIAL

- **No feedback on insights**, only on recommendations (above).
- **No spec file** for any of this team's five service files — 2,325 lines of
  scoring, ranking, verbalizing, scheduling and dispositioning with zero tests.
- **No expiry on consultant enablement**, and the toggle route
  (`analytics.controller.ts:516`) plus the consult route (`:531`) are both unguarded
  (OD-20).
- **Rule coverage is thin against the catalogue** — 8 rules against 573 insight types.
  Whether that is a gap or good judgement is itself a question this team should answer with
  evidence rather than assume.

## Why this team is distinct from its siblings

AB-1 is rewarded for computing more; this team is rewarded for saying less. Those metrics
point in opposite directions under pressure, and one team holding both *quietly resolves
that tension toward volume, which is how a dashboard becomes noise*
(`intelligence.md:400-403`). Against AB-3 the line is authorship: this team writes the
sentence, AB-3 must be able to say the sentence is false.
