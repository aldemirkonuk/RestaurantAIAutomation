---
type: agent-stack
division: intelligence
department: analytics-bi
team: insight-narrative-generation
status: designed
updated: 2026-08-27
metrics: [analytics.insight_acceptance_rate, analytics.top_rank_ignore_rate, analytics.insight_feedback_coverage, analytics.consultant_enabled_restaurants, nf_b.aggregate_guest_signal_consumed]
links: ["[[insight-narrative-generation-charter]]", "[[insight-narrative-generation-schedule]]", "[[insight-narrative-generation-loops]]", "[[insight-narrative-generation-directive]]", "[[insight-narrative-generation-premortem]]", "[[0034-agent-stack-artifact]]", "[[0020-no-fabricated-answers]]", "[[0017-doneability-verdicts-are-sidecar-claims]]", "[[analytics-bi-agent-stack]]", "[[analytics-engine-agent-stack]]", "[[metric-contract-truth-assurance-agent-stack]]", "[[skills-charter]]"]
---

# Insight & Narrative Generation — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The one stack in the department whose agent is graded on **saying less**. Its quality bar
> is [[0020-no-fabricated-answers]] applied to a sentence: the number comes from the math or
> the sentence does not ship, and an empty feed explains itself. Mechanisms referenced only:
> the model call (retry, routing, cost, timeout) →
> [[harness-model-routing-charter|harness-and-model-routing-charter]], harness →
> [[harness-runtime-charter]] (**OD-03 open**), mutation gate →
> [[action-safety-the-human-gate-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `narrative-restraint-sentinel` | Report acceptance only with its denominator, keep every consultant enablement owned and expiring, and count how often the product correctly says nothing | NEW |

One row. Generating rules or sentences is not a job this stack takes: this team's metric
is a ratio, and a tool that grows the denominator faster is the wrong tool
([[insight-narrative-generation-premortem]] M4).

## 2. Agent cards

```yaml
agent: narrative-restraint-sentinel
unit: insight-narrative-generation
triggers:
  - schedule: "weekly (consultant enablement list)"        # mirrored in [[insight-narrative-generation-schedule]]
  - schedule: "fortnightly (acceptance + distribution report)"
  - schedule: "monthly (feedback-coverage review, empty-state audit)"
  - topic: insight.disposition_recorded                     # publisher: NONE (gap — dispositions are table writes, and the 573-type surface has no disposition column at all)
consumes:
  - recommendation_impressions                              # publisher: recommendations.service.ts:373-382,392-414, fire-and-forget on every getRecommendations()
  - recommendation_actions (status, pinned, acted_at, feedback, created_by — baseline :4922)   # publisher: recommendation-actions.service.ts
  - "analytics_insight_prefs rows where category='consultants'"   # publisher: the toggle route, analytics.controller.ts:516
  - scored candidates from steps 2-3 of insight-generator.service.ts:16-30   # publisher: [[analytics-engine-agent-stack|engine-reach-sentinel]]'s unit
  - analytics.false_discovery_estimate                      # publisher: [[analytics-engine-agent-stack|engine-reach-sentinel]], monthly
  - "nf_a verdicts on the consultant path (basis grounding_v1, verdict-bases.ts:67)"   # publisher: consultants.service.ts:203-206 via NfVerdictService
emits:
  - analytics.insight_acceptance_rate + analytics.top_rank_ignore_rate, denominator stated   # consumer: [[analytics-bi-agent-stack]] board
  - analytics.insight_feedback_coverage (8 of 581 today)    # consumer: [[analytics-bi-agent-stack]] board
  - analytics.consultant_enabled_restaurants + enablement age    # consumer: [[analytics-bi-agent-stack]] board
  - analytics.insufficient_data_render_rate, analytics.unnamed_threshold_count
  - the list of shipped sentences and their numbers          # consumer: [[metric-contract-truth-assurance-agent-stack|metric-contract-auditor]], who may call one false
  - nf_a events (task_type: narrative_acceptance_report)     # consumer: [[ai-orchestration-agent-stack|aio-orchestrator]]
routing_class: extraction      # joining two tables and listing toggle rows; the judgement (is this worth saying) stays with the deterministic rules and the humans
quality_bar: "grounding_v1 (verdict-bases.ts:67) on the consultant path — every claim's evidence_refs root must name a category actually supplied, with HARD RULE 6's thin-evidence carve-out (consultant-grounding.ts); NONE (gap) on the 573-type template path, which has no verdict basis and no disposition column. No rate is emitted without its denominator; insufficient_data is a published state, not an apology (ADR 0020)"
autonomy:
  read: autonomous
  propose: autonomous          # reports and revert lists land as PRs
  mutate_stock_money_outbound: confirm    # constant — and see the hard rule below
memory: insight-narrative-generation
escalates_to: "[[analytics-bi-charter]]"
```

**The card's own hard rules.** (1) The agent **lists** unowned enablements and proposes the
revert; flipping the row is a human action — enabling the layer is a decision reserved to
this team with a named human and an expiry ([[analytics-bi-directive]] §Decision rights),
and each enabled restaurant is metered outbound spend, so it sits behind the confirm gate
by the constant above, not by local choice. (2) It never lowers a support floor, and never
proposes a threshold change without a spec case in the same diff
([[insight-narrative-generation-premortem]] M2).

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `consultant-toggle-review` | T2 (dept) | Weekly; immediately after any demo or pilot enablement | Every `analytics_insight_prefs` row with `category='consultants'`, `enabled=true` has a named owner and an expiry inside one close-time; rows without one revert to the code's own default | The layer is default-OFF by design (`consultants.service.ts:11,18` — *"absent row ⇒ disabled"*) and **no mechanism at all** prevents an enablement outliving its reason | NEW |
| `insight-acceptance-report` | T2 (dept) | Fortnightly, and before any external claim about insight usefulness | Acceptance rate **with denominator**, feedback coverage, top-rank ignore rate and served-rule concentration in one table; refuses to emit a bare rate; flags `insufficient_data` when volume does not support it | `recommendation_impressions` shipped 2026-08-17 with a migration comment naming the failure it guards, is written on every `getRecommendations()` call (`recommendations.service.ts:380`) — **and is read by nothing** | NEW |
| `support-floor-audit` | T3 | Any diff touching a threshold constant in `insight-generator.service.ts` | The threshold is a named exported constant with a spec case in the same diff | Five thresholds today — `:200`, `:550`, `:867`, `:1017`, `:1107` — none named, none tested ([[analytics-bi-schedule]]) | NEW |

Deliberately absent: *"generate more recommendation rules"* (inflates this team's
denominator) and *"write consultant prompts"* (a decision,
[[insight-narrative-generation-directive]] rule 2, not a procedure). Consumed, owned
elsewhere: the envelope ([[skills-charter]]); nondeterministic grading
([[agent-evaluation-gates-charter]]); the wire
([[harness-model-routing-charter|harness-and-model-routing-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates enter [[skill-harvesting-charter]]'s queue, §3.3 gate still applied.
- **Episodic** — nf_a `task_type: narrative_acceptance_report` and
  `consultant_enablement_review`; plus the consultant path's own events, which already
  carry a `grounding_v1` verdict as a sidecar claim (ADR 0017). Needs
  `context.rule_key` and `context.position`, because the denominator is per-render and the
  numerator is per-rule — the join is not a naive ratio and the keys must say so.
- **Semantic** — `memory/` beside this file, index
  `insight-narrative-generation-MEMORY.md`, one fact per file with `source` /
  `confidence` / `last_verified`. Founding facts: the per-render vs per-rule keying
  subtlety, the 8-of-581 feedback coverage, and each dated enablement with its reason —
  the fact that closes [[insight-narrative-generation-premortem]] M1 is simply "restaurant
  X enabled on D for reason R, expiring E". Every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and the acceptance
  denominator definition. The two 1,200- and 417-line services are `path:line` retrieval
  targets, never preloaded.

**Consolidation** — monthly, mirrored in [[insight-narrative-generation-schedule]]: read
the NF-A slice and the fortnightly reports since the last run; **failures first** — a
dismissed rule becomes a fact naming *why the sentence was not worth acting on*, and a
`grounding_v1` red verdict a fact naming which category was cited and never supplied;
expire facts unverified for 90 days; propose skill candidates. One PR. `insufficient_data`
across consecutive runs is the report working — stated, never suppressed.

## 5. Async contract

Cross-unit interaction is loops ([[insight-narrative-generation-loops]] — 5, close_times
fortnightly ×2 / monthly / per-pr / weekly), NF-A events, vault PRs and skill candidates.
Gap rows:

| Gap | Why it is a gap |
|---|---|
| `insight.disposition_recorded` has no publisher, and for 573 types no substrate | `analytics_insights` (baseline `:2194-2209`) carries `candidate_key`, `sentence`, `score`, `effect_pct`, `z_score`, `evidence`, `computed_at` and **no disposition column**. Acceptance is measurable over 8 rules and not over 573 types — the surface the founder wants to lead with is the surface with no feedback loop |
| INTEL-F3 — the operator has no NF `subject_type` | `recommendation_actions.created_by` already stores the operator's identity; `foundation §4.4` allows `agent` / `guest` / `bio` only. Open fork, interacts with OD-11; this card does not pick a side, it restates the blockage monthly |
| `nf_b.aggregate_guest_signal_consumed` has no producer named here | We consume NF-B **in aggregate** only ([[guest-experience-charter]] owns the guest); nothing publishes an aggregate today |
| ~~The weekly OD-20 restatement has no subject~~ — **drift resolved 2026-09-01** | [[analytics-bi-charter]]'s 2026-08-25 correction records OD-20 **resolved** (`analytics.controller.ts:51`, re-verified 2026-08-27); this team's schedule still listed the restatement weekly. That drift was recorded here and has now been carried into [[insight-narrative-generation-schedule]], where the job is retired with its outcome (closed by PR #31 on 2026-08-24) rather than deleted |

## 6. Evidence today

- **EXISTS — the generation stack.** `insight-generator.service.ts` (1,200), pipeline at
  `:16-30`; `insight-verbalizer.ts` (167), templates only — *"every number in a sentence
  comes straight from the math"* (`:1-11`); `insight-scheduler.service.ts:8-17`;
  `recommendations.service.ts` 8 deterministic rules; `recommendation-actions.service.ts`
  (308). The `insufficient_data` seed is there and **tested** — the verbalizer returns
  `null` on thin evidence, asserted at `insight-catalog.spec.ts:94-101`. What is missing is
  the rendered consequence: a feed that explains *why* it is empty.
- **EXISTS, and newer than the charter — anti-fabrication is enforced in code, not merely
  promised.** `consultant-grounding.ts` + `.spec.ts` (**13 cases**) machine-check that every
  consultant claim's `evidence_refs` root names a category actually supplied (OD-59, P3.0),
  carving out HARD RULE 6's thin-evidence answer; `consultants.service.ts:203-206` records
  the verdict under `GROUNDING_BASIS` (`verdict-bases.ts:67`) and `:231` drops ungrounded
  claims. The same call now routes through `ModelClientService` (`:174` — P1 NF-A, and a
  timeout where it was unbounded), so the charter's "one of RM-1's seven raw-`fetch`
  callsites" is superseded. Recorded here, not edited there.
- **PARTIAL — measurement.** Both halves of `insight_acceptance_rate` exist and have never
  been joined; feedback coverage is 8 of 581.
- **NEW — the sentinel, all three skills, and everything in §4.**
