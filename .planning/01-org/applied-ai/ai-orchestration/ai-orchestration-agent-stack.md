---
type: agent-stack
division: applied-ai
department: ai-orchestration
status: designed
updated: 2026-08-27
metrics: [nf_a.task_success_rate, nf_a.cost_per_task, nf_a.doneability_verdict_coverage, safety.unconfirmed_mutation_count]
links: ["[[ai-orchestration-charter]]", "[[ai-orchestration-schedule]]", "[[ai-orchestration-loops]]", "[[ai-orchestration-agenda-board]]", "[[0034-agent-stack-artifact]]", "[[skills-charter]]", "[[harness-runtime-charter]]", "[[action-safety-the-human-gate-charter]]"]
---

# AI Orchestration — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> Department-level stacks are about **orchestration of the unit itself**, not about
> doing the teams' work: this card watches the five team boards and the seams between
> them. The mechanisms are owned by this department's own teams and referenced, not
> restated — which makes this doc the test case for its own contract.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `aio-orchestrator` | Roll the five team metric sets onto one board, and escalate any team loop that breaches its close_time or any seam that produces two owners for one job | NEW |

One row deliberately. The five questions about an agent action already have five team
owners; a department agent that *did* team work would be the duplication
`technology.md:845` warns about.

## 2. Agent cards

```yaml
agent: aio-orchestrator
unit: ai-orchestration
triggers:
  - schedule: "weekly, before the founder board review"   # mirrored in [[ai-orchestration-schedule]]
  - topic: loop.close_time_breached                        # publisher: NONE (gap — loops.json is static; nothing watches close_times yet)
consumes:
  - nf_a events sliced by this department's task types (ADR 0006/0008)
  - the five team agenda-boards (Dataview output)
  - "[[00-index/LOOP-MAP|LOOP-MAP]] rows owned by aio-* teams"
emits:
  - "[[ai-orchestration-agenda-board]] rollup — the metric SET, never an average (charter §Metrics)"
  - escalation notes into [[ai-orchestration-agenda-full]] §Questions
  - nf_a events (task_type: dept_board_rollup)
routing_class: extraction        # reading boards and counting is not judgment
quality_bar: "every board row carries a value or the word 'not emitted' — ADR 0020; no roll-up number ever (charter §Metrics)"
autonomy:
  read: autonomous
  propose: autonomous            # escalations and board edits land as PRs
  mutate_stock_money_outbound: confirm   # constant; this agent has no such surface
memory: ai-orchestration
escalates_to: "[[02-advisory/decision-office/decision-office-charter|decision-office-charter]]"   # seam disputes (TECH-F3-shaped) go to the Decision Office, not to a sibling
```

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `nf-a-coverage-report` | T2 | Weekly board refresh, or any session asked "what does NF-A actually emit?" | A per-task-family table where every row is measured or says "not emitted"; zero invented numbers (ADR 0020) | The P1 instrumentation and readout sessions (PR #35, branch `feat/p1-readout`, 2026-08-25→27) each re-derived emission status by hand | NEW |
| `seam-conflict-check` | T2 | A new charter or OD entry names an owner for work an aio team already owns | A written verdict: same job + same metric in two units → escalation filed; else "no conflict" | OD-29 (aio-model-routing vs RM-1 sharing a mandate and NF-A cost metric) was found by manual cross-reading, late | NEW |

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]]);
gate operation ([[agent-evaluation-gates-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates from consolidation go to
  [[skill-harvesting-charter]]'s queue through the §3.3 gate.
- **Episodic** — nf_a `task_type: dept_board_rollup`, plus read access to every
  aio-* task family's events. Needs `context.team` as a jsonb key so a slice per
  team is one filter, not a join this department has to invent.
- **Semantic** — `memory/` beside this file; facts like "family X has had zero
  verdict coverage for N weeks" with `source` = the NF-A query, `confidence`,
  `last_verified`. Index: `ai-orchestration-MEMORY.md`. Every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. Team
  charters are retrieval targets, never preloaded.

**Consolidation** — monthly, mirrored in [[ai-orchestration-schedule]]: read the
department's NF-A slice; write one fact per durable finding, failures first (a
family that regressed gets a fact naming the mechanism, not "coverage dipped");
expire facts unverified for 90 days; emit skill candidates. One PR; "no delta" is
a valid, stated outcome.

## 5. Async contract

Cross-unit interaction is loops ([[ai-orchestration-loops]]), NF-A events, vault
PRs, and skill candidates only. Known gap rows, stated rather than assumed away:

| Gap | Why it is a gap |
|---|---|
| `loop.close_time_breached` has no publisher | `loops.json` is a static census; nothing measures loop age. Until built, the weekly schedule is the only trigger — breaches surface a week late at worst |
| Escalation to the Decision Office is a doc edit, not an event | Acceptable async path (vault PR), but nothing notifies; their schedule must poll [[ai-orchestration-agenda-full]] §Questions |

## 6. Evidence today

- **NEW — the orchestrator agent.** No module does this; the closest analogue is the
  agenda-board Dataview, which renders but does not escalate.
- **PARTIAL — the episodic substrate.** NF-A emits since P1
  (`model-client.service.ts:413` per charter correction 2026-08-25); verdict
  coverage near zero outside the merge-policy gate, so the rollup would today be a
  table of honest "not emitted" rows — which is exactly what ADR 0020 wants shown.
- **NEW — everything in §4** except the NF-A tables themselves (ADR 0006/0008,
  migrated; see [[0017-doneability-verdicts-are-sidecar-claims]]).
