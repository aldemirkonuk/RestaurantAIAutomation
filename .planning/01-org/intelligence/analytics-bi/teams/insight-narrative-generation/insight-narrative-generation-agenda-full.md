---
type: agenda-full
division: intelligence
department: analytics-bi
team: insight-narrative-generation
status: provisional
metrics: [analytics.insight_acceptance_rate, analytics.insight_feedback_coverage, analytics.top_rank_ignore_rate, analytics.consultant_enabled_restaurants]
updated: 2026-08-24
links: ["[[insight-narrative-generation-charter]]", "[[insight-narrative-generation-premortem]]", "[[insight-narrative-generation-agenda-board]]", "[[insight-narrative-generation-directive]]", "[[insight-narrative-generation-loops]]", "[[insight-narrative-generation-schedule]]", "[[analytics-bi-agenda-full]]", "[[analytics-engine-charter]]", "[[metric-contract-truth-assurance-charter]]", "[[security-charter]]"]
---

# Insight & Narrative Generation — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Turn a generation stack that already works into one whose **effect is measurable**, and
ship the honest empty state before the pressure arrives to fake a full one.

| Metric | State today (verified 2026-08-24) |
|---|---|
| `analytics.insight_acceptance_rate` | **Unmeasured.** Both tables populated, never joined |
| `analytics.insight_feedback_coverage` | **8 of 581** — 8 rules can receive a disposition; 573 insight types cannot |
| `analytics.top_rank_ignore_rate` | **Unmeasured**, though `position` and `request_id` are stored for exactly this |
| `analytics.unnamed_threshold_count` | **9** — 5 floors + 4 `scoreOf` constants, none named, none tested |
| `analytics.consultant_enabled_restaurants` | **Unlisted.** No expiry mechanism; toggle route unguarded |
| `analytics.insufficient_data_render_rate` | **Unmeasured**, and there is no empty-state screen to measure |

## How

**Sequence: measure what exists → cover what does not → then tune.** Tuning first is
[[insight-narrative-generation-premortem]] M5.

### 1. Define the join before computing it (week one)

`recommendation_impressions` is per-render, with a 1-indexed `position` and a `request_id`
grouping one `getRecommendations()` call exactly.
`recommendation_actions` is keyed by `rule_key`, so **a dismissal is sticky per rule**. A
naive `actions ÷ impressions` falls forever as impressions accumulate against a one-time
dismissal.

The first deliverable is therefore not a number, it is a **definition** — registered with
[[metric-contract-truth-assurance-charter]] before anything is published. Proposed shape:
acceptance is evaluated per `(restaurant_id, rule_key, served-window)` against the first
impression in that window, so a sticky dismissal counts once.

### 2. Publish acceptance with its denominator stated (weeks 1–2)

Biweekly, with an explicit `insufficient_data` flag until volume supports the number, and
with the honest denominator on the same line: *"over 8 recommendation rules; 573 insight
types have no disposition path."*

### 3. Close the feedback-coverage gap (weeks 2–6)

`analytics_insights` (baseline `:2194-2209`) has no disposition column. Adding one —
plus the API and the card affordance — is the single largest thing this team can do for the
department's credibility, because it is what makes the founder's headline surface
*evaluable at all*. Until then the 573-type engine has never been judged by a human.

### 4. Ship the empty state (weeks 2–4)

A designed screen that says what is missing and how much: *"3 of 7 weeks of Tuesday data —
we cannot yet compare your Tuesdays."* The code already declines to speak
(`insight-verbalizer.ts` returns `null`; `insight-catalog.spec.ts:94-101`); what is missing
is the screen that makes declining look like rigour instead of breakage. **This is the
demo-pressure vaccine** — M2's failure sequence starts with an uncomfortable empty screen.

### 5. Stand up consultant enablement expiry (week one, cheap)

List every `analytics_insight_prefs` row with `category='consultants'`, `enabled=true`, its
age and its named owner. Unowned rows revert to OFF — the code's own default
(`consultants.service.ts:18`), so reverting needs no approval. Cheap to build, and it is the
only available mitigation for M1 while OD-20 stands.

### 6. Then, and only then, tune ranking

Against mechanisms, not rates ([[insight-narrative-generation-directive]] rule 4).

## Why now

- **The founder's headline surface is the unevaluated one.** 573 insight types, zero
  dispositions. Every claim about the analytics being right currently rests on nobody
  having disagreed.
- **The instrumentation was already built for this and is going unread.**
  `recommendation_impressions` shipped 2026-08-17 with a migration comment explaining the
  exact failure it prevents. It is written on every request
  (`recommendations.service.ts:380`) into a table nothing queries. That is the cheapest
  possible win in this department.
- **The demo pressure is predictable and dateable.** M2 says the support floor gets lowered
  before a customer meeting. Shipping the empty state *first* removes the reason.
- **OD-20 makes M1 externally triggerable.** While the consultant toggle is unguarded,
  "someone flips it for a demo" is not even required — anyone can. That raises the priority
  of the expiry list from hygiene to control.

## Next steps

- [ ] Define and register the impressions ↔ actions join —
      [[metric-contract-truth-assurance-charter]] countersigns
- [ ] Publish `analytics.insight_acceptance_rate` biweekly with denominator + `insufficient_data` flag
- [ ] Publish `analytics.insight_feedback_coverage` (**8 of 581** today) on the same table
- [ ] Publish `analytics.top_rank_ignore_rate` and served-rule concentration (N3)
- [ ] Add a disposition path for `analytics_insights` — schema, API, card affordance
- [ ] Design and ship the `insufficient_data` empty state with its shortfall stated
- [ ] Stand up the weekly consultant-enablement list; unowned rows revert to OFF
- [ ] Co-own the threshold-naming work with [[analytics-engine-charter]] (9 constants)
- [ ] Write the first spec for `recommendations.service.ts` — 8 rules, deterministic,
      trivially fixture-testable, and currently untested
- [ ] Restate OD-20 and INTEL-F3 every close-time until closed

## Questions for the founder

1. **Is an honest empty screen acceptable in a demo?** This team's position is that it is
   the strongest possible demonstration of *"we have the right metrics"* — a system that
   says "we cannot tell" is more valuable than one that guesses
   (`AGENT_NATIVE_UI_DECISION.md:191-192`). But it is your demo. If the answer is no, say so
   now, because M2 says the floors get lowered quietly instead.

2. **Do insights get dispositions, or do we accept that 573 types are unmeasurable?** Adding
   feedback to `analytics_insights` is real schema + UI work. The alternative is honest but
   uncomfortable: the engine's value is unproven and will stay that way.

3. **INTEL-F3 — where does operator preference live?** `recommendation_actions.created_by`
   already stores who acted. `foundation §4.4` has no `subject_type` for them. Add
   `operator`, or route it outside NF? Until this closes, the strongest human signal the
   product collects is outside the loop graph (foundation §7).

4. **OD-20 — confirm we do not demo the consultant layer until the routes are guarded.**
   The toggle (`analytics.controller.ts:516`) and the Opus call (`:531`) are unguarded, and
   the consult call has no retry either (`intelligence.md:81-83`), so a 429 surfaces to the
   user as a failure. This team's position is: not until it is fixed.

5. **Are 8 rules the right number against 573 insight types?** It may be excellent
   judgement — most insights genuinely are not actionable. But nobody has checked, and the
   answer changes whether this team's next quarter is *more rules* or *better silence*.
