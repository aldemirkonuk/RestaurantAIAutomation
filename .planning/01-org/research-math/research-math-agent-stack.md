---
type: agent-stack
division: research-math
department: research-math
status: designed
updated: 2026-08-27
metrics: [nf_a.cost_per_completed_task, nf_a.harness_overhead_ms, nf_a.verified_task_success_rate, nf_a.event_completeness]
links: ["[[research-math-charter]]", "[[research-math-schedule]]", "[[research-math-loops]]", "[[research-math-agenda-board]]", "[[0034-agent-stack-artifact]]", "[[skills-charter]]", "[[harness-model-routing-agent-stack]]", "[[evaluation-doneability-agent-stack]]", "[[neural-footprint-instrumentation-agent-stack]]", "[[backtests-agent-stack]]", "[[decision-office-charter]]"]
---

# Research & Math — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This department's mandate is *turning "the agent worked" into a number*, so its own
> stack must be the one that cannot fake a number. The department agent publishes and
> escalates; it never grades, never tunes, and never owns a metric one of its four teams
> owns. Mechanisms are referenced, not restated: harness → [[harness-runtime-charter]]
> (**OD-03 open**), model choice → [[harness-model-routing-charter]] (**OD-29 open**), the
> mutation gate → [[action-safety-the-human-gate-charter]], memory + NF-A → ADR 0006/0008/0017.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `rm-board-warden` | Publish the four-metric **set** with its blanks intact and verified beside self-reported, and raise the moment a protected-lane item slips without an `OPEN-DECISIONS.md` record | NEW |

One row deliberately: the four verbs — produce, grade, record, replay — already have four
team owners, and a department agent doing any of them would breach the independence rule
this department is built around.

## 2. Agent cards

```yaml
agent: rm-board-warden
unit: research-math
triggers:
  - schedule: "weekly — publish the four primary metrics, blanks included"   # [[research-math-schedule]] §Recurring work
  - schedule: "monthly — Applied AI seam audit; department agenda sync"
  - topic: protected_lane.item_slipped     # publisher: NONE (gap — nothing watches the non-preemptible lane)
consumes:
  - the four team agenda-boards — publisher: each team's Dataview query
  - nf_a events for this department's task types — publisher: model-client.service.ts:413 (gateway), spend_logger.py:406 (Python)
  - self-reported success_rate — publisher: services/agent-orchestrator/core/base_agent.py:144
  - preemption records in OPEN-DECISIONS.md — publisher: "[[decision-office-charter]]"
emits:
  - "[[research-math-agenda-board]] — the metric SET; never an average, never a velocity number (charter §Metrics)"
  - a seam finding or the single word clean into "[[research-math-agenda-full]]" §Questions — consumer: "[[decision-office-charter]]"
  - 'nf_a events (task_type: rm_board_publish) — consumer: "[[neural-footprint-instrumentation-charter]]"''s contract'
routing_class: extraction
quality_bar: "every row carries a measured value or the words 'not measured' — never an inferred one; the verified/self-reported pair publishes together or neither publishes (charter §The independence rule, clause 4)"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm     # constant; this agent has no such surface
memory: research-math
escalates_to: "[[decision-office-charter]]"
```

**The card's own hard rules.** The warden never authors or edits a verdict, a golden set
or a pass condition (independence clause 2 — that is [[evaluation-doneability-charter]]'s
alone), and it may not add a velocity metric to the board, ever
([[research-math-schedule]] §The non-preemptible lane).

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `applied-ai-seam-audit` | T2 | Monthly, and any new charter or OD row naming an owner for work an RM team owns | Same job **and** same metric in two units → a merge proposal filed at the named unit (never a duplicate); else the word "clean" | OD-29 (`decisions/OPEN-DECISIONS.md:35`) — RM-1 and `aio-model-routing` share a mandate and the NF-A cost metric, found by hand cross-reading; and the TECH-F3 / OD-21 id collision (`OPEN-DECISIONS.md:136`) reconciled after the fact | NEW |
| `metric-set-publish` | T2 | Weekly board refresh | Four rows, each measured or "not measured"; verified printed beside `base_agent.py:144`; zero roll-ups | This department's own baselines were re-derived by hand twice — the 2026-08-24 generation, then the 2026-08-25 corrections carried in-line at `research-math-charter.md:159,189-196` | NEW |

`skill-create` and `department-agenda-sync` are listed as candidates in
[[research-math-schedule]] and are **not rows here**: neither has a past instance, and
§3.3 is the rule this department enforces on everyone, so it applies to itself first.

Consumed, owned elsewhere: the envelope and registry ([[skills-charter]]); `skill-review`
([[evaluation-doneability-charter]]); gate operation ([[agent-evaluation-gates-charter]] —
**TECH-F3 open**). If `metric-set-publish` and `nf-a-coverage-report`
([[ai-orchestration-agent-stack]]) ever render the same per-task-family table,
`applied-ai-seam-audit` files the merge proposal rather than defending scope.

## 4. Memory

- **Procedural** — the §3 skills; candidates reach [[skill-harvesting-charter]]'s queue and
  still face the §3.3 gate.
- **Episodic** — nf_a `task_type: rm_board_publish`, plus read access to every RM task
  family. Needs the verdict sidecar joinable by event id ([[0017-doneability-verdicts-are-sidecar-claims]])
  and a `context.task_type` jsonb key, or "verified beside self-reported" is two queries
  nobody can reconcile on a board.
- **Semantic** — `memory/` beside this file, indexed by `research-math-MEMORY.md`. Its
  first facts are already known: which metrics have been unmeasurable for how many weeks,
  and every protected-lane slip with its date and its stated reason. Frontmatter carries
  `source`, `confidence`, `last_verified`; every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, §Metrics and §The
  independence rule. Team charters are retrieval targets by `path:line`, never preloaded.

**Consolidation** — monthly, mirrored in [[research-math-schedule]]: read the department's
NF-A slice and the four boards since the last run; write one fact per durable finding,
**failures first** — a metric that regressed gets a fact naming the mechanism, not
"coverage dipped"; expire facts unverified for 90 days; emit skill candidates. One PR, and
"no delta" is stated rather than left silent.

## 5. Async contract

Cross-unit interaction is loops ([[research-math-loops]]), NF-A events, vault PRs and
skill candidates only. Gap rows, stated rather than assumed away:

| Gap | Why it is a gap |
|---|---|
| `protected_lane.item_slipped` has no publisher | Nothing measures whether a non-preemptible item moved. The weekly publish bounds the blind spot at 7 days — and a slip with a product reason and no record is exactly [[research-math-premortem]] M1's tell |
| The seam finding reaches Applied AI as a doc edit | Acceptable async path (vault PR), but nothing notifies; [[ai-orchestration-agent-stack]] records the mirror-image gap from its side |
| **OD-29 is open, and two units may publish the same cost number** | Until the founder rules, both boards can carry `cost_per_task` with different denominators. The warden publishes both and files the divergence; it does not pick |

## 6. Evidence today

- **NEW — the warden and both skills.** Nothing runs these; the past instances cited are
  hand-work done during the 2026-08-24→27 generation sessions.
- **EXISTS, and newer than the charter — the episodic substrate on both runtimes.**
  `apps/api-gateway/src/common/model-client/model-client.service.ts:413` and
  `services/agent-orchestrator/services/spend_logger.py:406` both write
  `neural_footprint_event`. The charter's headline "0% for the NestJS surface" is
  superseded — its own 2026-08-25 corrections say so.
- **PARTIAL — verdict coverage.** `.planning/STATE.md:98-105` records P3.0 shipped
  2026-08-27: 7/7 gateway task types graded, **26 of 38** across both runtimes above
  `call_level_v0`, 12 on a shrink-only exemption list, guarded by
  `scripts/check_task_types_are_graded.py`. `nf_a.verified_task_success_rate` is therefore
  computable for the first time — and has never been published beside self-reported.
- **NEW — `nf_a.harness_overhead_ms`.** Grepping `apps`, `services` and `scripts` for
  `harness_overhead` returns **0 hits** (verified 2026-08-27). The number that decides
  OD-03 still has no instrument.
