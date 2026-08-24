---
type: schedule
division: intelligence
department: analytics-bi
team: insight-narrative-generation
status: provisional
metrics: [analytics.insight_acceptance_rate, analytics.insight_feedback_coverage, analytics.consultant_enabled_restaurants, analytics.insufficient_data_render_rate]
updated: 2026-08-24
links: ["[[insight-narrative-generation-charter]]", "[[insight-narrative-generation-loops]]", "[[insight-narrative-generation-directive]]", "[[analytics-bi-schedule]]", "[[metric-contract-truth-assurance-charter]]", "[[security-charter]]"]
---

# Insight & Narrative Generation — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Hourly *(already running in code)* | **Insight refresh sweep** — `insight-scheduler.service.ts:8-17`, per restaurant × category, `hourly \| daily \| weekly \| manual`, defaulting to daily @ 06:00, failures isolated per restaurant | `analytics_insights` rows |
| Weekly | **Consultant enablement list** — every `analytics_insight_prefs` row with `category='consultants'`, `enabled=true`: age, named owner. Unowned rows revert to OFF | `analytics.consultant_enabled_restaurants`, `analytics.consultant_enablement_age_days` |
| Weekly | **OD-20 restatement** — the consultant toggle (`analytics.controller.ts:516`) and Opus call (`:531`) remain unguarded; restated to [[security-charter]] with the demo-refusal attached | escalation record |
| Biweekly | **Acceptance + distribution report** — acceptance rate, feedback coverage, top-rank ignore rate, served-rule concentration, all in one table with the denominator stated | `analytics.insight_acceptance_rate`, `analytics.top_rank_ignore_rate`, `analytics.served_rule_concentration` |
| Monthly | **Feedback-coverage review** — which surfaced narrative objects can receive a disposition. Today **8 of 581** | `analytics.insight_feedback_coverage` |
| Monthly | **Empty-state audit** — how often `insufficient_data` rendered, and whether any threshold moved without a spec change | `analytics.insufficient_data_render_rate`, `analytics.unnamed_threshold_count` |
| Per PR touching a threshold | **Floor-change guard** — a support floor may not change without a spec case in the same diff | blocks the merge |

**Anti-sprawl.** A job with no action for 3 consecutive runs is downgraded or deleted
(foundation §6). Two notes on applying that here:

- The **weekly OD-20 restatement** will produce "no action" repeatedly by design. It is not
  deleted; after 3 runs it is *escalated* to a founder decision
  ([[insight-narrative-generation-directive]] escalation trigger). Silence about an open
  exposure is the failure the rule exists to prevent, not the outcome it should produce.
- The **biweekly acceptance report** is expected to say `insufficient_data` for its first
  several runs. That is the report working, not the report failing.

## Skills owned

Skills live in `.claude/skills/`. **None exist yet.** Two proposed, per the §3.3 protocol.
Deliberately two — the repo has one project skill today (foundation §3.1) and a skill
unfired for 30 days is reviewed for deletion.

### `consultant-toggle-review` — T2 (department)

- **Trigger.** Weekly; also immediately after any demo or pilot enablement.
- **Doneability.** Every `analytics_insight_prefs` row with `category='consultants'` and
  `enabled=true` has a named owner and an expiry date within one close-time. Rows without
  one are switched off (reverting to the code's own default,
  `consultants.service.ts:18` — *"absent row ⇒ disabled"*).
- **Real past instance.** The layer is default-OFF by deliberate design
  (`consultants.service.ts:11`), the prompt forbids inventing numbers (`:15`) — and
  there is no mechanism at all preventing an enablement from outliving its reason. The
  toggle route is additionally unguarded (`analytics.controller.ts:516`, OD-20), so the
  enablement need not even be ours.
- **Scheduled.** Yes, weekly.

### `insight-acceptance-report` — T2 (department)

- **Trigger.** Biweekly, and before any external claim about insight usefulness.
- **Doneability.** Emits acceptance rate **with its denominator stated**, feedback coverage,
  top-rank ignore rate, and served-rule concentration in one table. Refuses to emit a bare
  rate. Flags `insufficient_data` when volume does not support the number.
- **Real past instance.** `recommendation_impressions` shipped 2026-08-17 with a migration
  comment naming the exact failure it guards (*"offline metrics improve as it degrades"*),
  is written fire-and-forget on every `getRecommendations()` call
  (`recommendations.service.ts:380`) — and is read by nothing. The guard exists and is
  going unused.
- **Scheduled.** Yes, biweekly.

## Deliberately not a skill

- **"Generate more recommendation rules."** This team's metric is a ratio; a skill that
  makes the numerator's *denominator* grow faster is the wrong tool
  ([[insight-narrative-generation-premortem]] M4).
- **"Write consultant prompts."** Prompt changes to `consultants.service.ts` are decisions
  ([[insight-narrative-generation-directive]] rule 2), not a procedure to automate.
