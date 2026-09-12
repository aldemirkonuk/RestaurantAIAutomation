---
type: agent-stack
division: intelligence
department: analytics-bi
status: designed
updated: 2026-08-27
metrics: [analytics.satisfiable_candidate_share, analytics.insight_acceptance_rate, analytics.kpi_ground_truth_agreement, analytics.metric_claim_divergence_count, analytics.engine_service_test_ratio]
links: ["[[analytics-bi-charter]]", "[[analytics-bi-schedule]]", "[[analytics-bi-loops]]", "[[analytics-bi-directive]]", "[[analytics-bi-agenda-board]]", "[[0034-agent-stack-artifact]]", "[[0020-no-fabricated-answers]]", "[[skills-charter]]", "[[analytics-engine-agent-stack]]", "[[insight-narrative-generation-agent-stack]]", "[[metric-contract-truth-assurance-agent-stack]]"]
---

# Analytics & BI — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The department stack orchestrates **the unit**, not the three questions its teams own.
> Its one agent keeps five numbers on one board without ever adding them up, and escalates
> the two jobs the schedule expects to produce "no action" by design. Mechanisms are
> referenced, never restated: harness → [[harness-runtime-charter]] (**OD-03 open**), model
> choice → [[model-routing-inference-economics-charter]], the mutation gate →
> [[action-safety-the-human-gate-charter]], memory shape → ADR 0006/0008/0017/0034.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `abi-orchestrator` | Keep the five department numbers on one board — each with its denominator, none summed — run the monthly coverage-inversion reading the schedule assigns to the Department itself, and escalate a loop that breaches its `close_time` | NEW |

One row deliberately. The three questions (*right? · worth saying? · same everywhere?*)
have three owners and three opposed incentives ([[analytics-bi-charter]] §Team-count
finding); a department agent that answered any of them would collapse the tension the
department is built out of.

## 2. Agent cards

```yaml
agent: abi-orchestrator
unit: analytics-bi
triggers:
  - schedule: "weekly board refresh"          # mirrored in [[analytics-bi-schedule]]
  - schedule: "monthly coverage-inversion reading"   # the one recurring row the schedule assigns to the Department, not a team
  - topic: analytics.claim_published          # publisher: NONE (gap — nothing emits when a deck, landing page or OpenAPI string ships a figure)
consumes:
  - the three team agenda-boards (Dataview output)                       # publishers: AB-1/AB-2/AB-3 stacks
  - "[[analytics-bi-loops]] rows and their close_times (weekly ×3, fortnightly, monthly ×2, per-event)"
  - engine spec-case count vs untested service lines (charter §Metrics)  # publisher: the repo; read at HEAD
  - "totalCandidateTypes from GET /analytics/insight-catalog (insight-generator.service.ts:41-45)"  # the runtime value every published count is diffed against
emits:
  - "[[analytics-bi-agenda-board]] — five numbers, never summed, each with its denominator"
  - analytics.engine_service_test_ratio                                   # consumer: the board, and AB-1's coverage reading
  - escalation notes into [[analytics-bi-agenda-full]] §Questions          # consumer: [[decision-office-charter]] (must poll — see §5)
  - nf_a events (task_type: analytics_board_rollup)                        # consumer: [[ai-orchestration-agent-stack|aio-orchestrator]]
routing_class: extraction        # reading boards, counting, diffing — no judgement call in the loop
quality_bar: "every board row carries a measured value or the words 'not computed' (ADR 0020); no roll-up number ever; no count published without its satisfiable share ([[analytics-bi-directive]] rule 2)"
autonomy:
  read: autonomous
  propose: autonomous            # board rows and escalations land as PRs
  mutate_stock_money_outbound: confirm    # constant; and see the hard rule below
memory: analytics-bi
escalates_to: "[[decision-office-charter]]"   # INTEL-F6/INTEL-F7 are decisions, not readings; three identical ground-truth restatements go to the founder ([[analytics-bi-schedule]])
```

**The card's own hard rule:** `abi-orchestrator` never averages, ranks or totals the
five numbers. `analytics.kpi_ground_truth_agreement` is 0% and blocked; a single
department "health score" would hide precisely the number the department exists to
publish ([[analytics-bi-premortem]] M1, M5).

## 3. Skills

The department holds the **T2** tier — every skill in the three team schedules is tagged
"T2 (department)" — and ships two before writing the rest ([[analytics-bi-schedule]]
§Skill-count honesty: six proposed against a repo-wide total of one).

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `metric-claim-census` | T2 | Weekly, and before any external publication | Every published count matches the value its code produces at runtime, or is registered with an owner and a close-time; reports the share closed **structurally** (runtime derivation or CI assertion), not by editing a string | Live today, re-verified 2026-08-27: `InsightCatalog.tsx:2`, `commands.ts:84,105`, `analytics.controller.ts:226` all publish **375** while `insight-catalog.spec.ts:9-10` asserts only `>= 200` | NEW |
| `insight-candidate-reach` | T2 | Weekly; also on any PR touching `insight-catalog.ts` | Total types, satisfiable share per live restaurant, and the blocking-`DataRequirement` table ranked by unlock size; fails loudly if a `DataRequirement` member is claimed by zero candidates | 2026-08-24: executing `availableCandidates()` produced 144/573 (25.1%) without POS — nobody in the corpus had computed it — and exposed `goals` (`insight-catalog.ts:38`) as declared and claimed by nothing | NEW |

Held behind the ship-two rule, instances recorded in the team stacks:
`analytics-truth-check`, `support-floor-audit`, `consultant-toggle-review`.

**One unresolved disagreement, recorded not settled:** [[analytics-bi-schedule]] lists
`published-claim-guard` as a T2 skill; [[metric-contract-truth-assurance-schedule]]
§Deliberately-not-a-skill argues the opposite — a gate that can be skipped by not invoking
it. Not this doc's call. Consumed, owned elsewhere: the envelope ([[skills-charter]]);
nondeterministic grading ([[agent-evaluation-gates-charter]] — *"they share vocabulary, not
work"*, `intelligence.md:464`).

## 4. Memory

- **Procedural** — the §3 skills; candidates enter [[skill-harvesting-charter]]'s queue, §3.3 gate still applied.
- **Episodic** — nf_a `task_type: analytics_board_rollup`, plus read access to the three
  team task families. Needs `context.team` and `context.metric_key` as jsonb keys, so a
  per-team or per-metric slice is one filter rather than a join this department invents.
- **Semantic** — `memory/` beside this file, index `analytics-bi-MEMORY.md`, one fact per
  file with `source` / `confidence` / `last_verified`; every write a PR. Its founding facts
  are already known: the 375-vs-573 divergence and its mechanism (a lower-bound assertion),
  and the two-week "not built" label on a shipped engine
  (`ANALYTICS_FEATURE_CATALOG.md:5-13`).
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. Team charters
  and the two large reference catalogues are `path:line` retrieval targets, never preloaded
  (CLAUDE.md §2).

**Consolidation** — monthly, mirrored in [[analytics-bi-schedule]]: read the department's
NF-A slice and the three boards since the last run; distil durable facts **failures
first** — a divergence that reopened becomes a fact naming the mechanism ("closed by a
markdown edit"), never the symptom ("count wrong again"); expire facts unverified for 90
days; propose skill candidates. One PR, and "no delta" is reported, never silence.

## 5. Async contract

Cross-unit interaction is loops ([[analytics-bi-loops]], 7 with stated close_times),
NF-A events, vault PRs and skill candidates — never a synchronous call. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `analytics.claim_published` has no publisher | Nothing emits when a figure ships. The weekly census plus the pre-publication gate are the whole coverage, and *"a weekly job cannot catch a deck written on a Tuesday"* ([[analytics-bi-schedule]] §Cadence notes) |
| Escalation to the Decision Office is a doc edit | An acceptable async path (vault PR), but nothing notifies; their schedule must poll [[analytics-bi-agenda-full]] §Questions |
| `analytics.kpi_ground_truth_agreement` has no producer | It needs the SimPOS ledger (§44.7, `v3.0-TECH-DEBT.md:309`), owned by [[engineering-charter]] and not shipped. Until then the board carries a dated 0 — that is the design, not the outage |
| INTEL-F3 — operator dispositions have no NF home | `subject_type` is `agent` / `guest` / `bio` (foundation §4.4); the manager who dismisses a recommendation is none of them. Open fork; AB-2 owns the restatement |

## 6. Evidence today

- **NEW — `abi-orchestrator` and both §3 skills.** No job rolls these boards up; the
  2026-08-24 generation session and the 2026-08-27 re-verification above both did it by
  hand, which is the past instance justifying the skills.
- **EXISTS — everything it would read.** The engine (`analytics/engine/`, 12 modules,
  3,679 non-spec lines, 10 spec files + `insight-catalog.spec.ts`, 149 `it()` cases), the
  catalogue (`insight-catalog.ts:279,388,503-540,547,557`), the registry
  (`metric-registry.ts:537-547`, 33 keys), the runtime summary endpoint
  (`insight-generator.service.ts:41-45`), and OD-20's closure
  (`analytics.controller.ts:51`, class-level `@UseGuards(JwtAuthGuard)`, verified 2026-08-27).
- **EXISTS — the episodic substrate, contrary to the charter's line.** The charter says
  the NestJS side emits no cost events (`intelligence.md:165-167`); since P1 the gateway
  emits `neural_footprint_event` from `common/model-client/model-client.service.ts:413`,
  and the consultant call now routes through it (`consultants.service.ts:174`).
- **PARTIAL — `analytics.engine_service_test_ratio`.** The charter's "0 cases over ~5,600
  service lines" has moved: `analytics/consultant-grounding.spec.ts` (13 cases) and
  `analytics/pos-revenue.spec.ts` (10) now sit beside the services. Smaller inversion, not
  a closed one. Corrections recorded here; the charter is not this doc's to edit.
- **NEW — everything in §4** except the NF-A tables themselves (ADR 0006/0008/0017).
