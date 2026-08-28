---
type: agent-stack
division: applied-ai
department: ai-orchestration
team: agent-fleet
status: designed
updated: 2026-08-27
metrics: [nf_a.task_success_rate, fleet.live_agent_ratio, fleet.orphan_modules, fleet.subscription_coverage]
links: ["[[agent-fleet-charter]]", "[[agent-fleet-schedule]]", "[[agent-fleet-loops]]", "[[0034-agent-stack-artifact]]", "[[harness-runtime-agent-stack]]", "[[ai-orchestration-agent-stack]]"]
---

# Agent Fleet — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team *owns* 26 agent modules; this page is not about them (they are the
> mandate, in the charter). It is about the one agent the team itself runs: the
> census-keeper for a fleet whose size has four different answers.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `fleet-census-agent` | Publish the four fleet counts (on disk / subclassing / registered / can receive) and the subscription-coverage table every week, so "how many agents do we have?" has one honest answer with a date on it | NEW |

The 26 fleet modules are **not** roster rows here: their cards belong to the units
whose work they do (wave 2 will find most map to Engineering/Data-owned task
families), and duplicating them here would recreate the registered-vs-live confusion
this team exists to end.

## 2. Agent cards

```yaml
agent: fleet-census-agent
unit: agent-fleet
triggers:
  - schedule: "weekly (feeds the aio board rollup)"        # mirrored in [[agent-fleet-schedule]]
  - topic: agents.module_added                              # publisher: NONE (gap — shared with harness-sentinel's card)
consumes:
  - services/agent-orchestrator/agents/ (disk)
  - core/orchestrator.py:174-211 (registration map)
  - agent subscription declarations vs. publishers (grep both sides)
  - nf_a events (task_type per agent, for task_success_rate when emitted)
emits:
  - the census + subscription-coverage tables → memory PRs and the board row
  - "fleet.live_agent_ratio, fleet.orphan_modules to [[ai-orchestration-agent-stack|aio-orchestrator]]"
  - nf_a events (task_type: fleet_census)
routing_class: mechanical
quality_bar: "stub agents reported separately and never averaged in (charter §Metrics — a logging stub posts a perfect score); rerun on the same commit reproduces the counts"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm   # constant; census has no mutation surface
memory: agent-fleet
escalates_to: "[[ai-orchestration-charter]]"
```

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `fleet-census` | T2 | Weekly, and whenever `agents/*.py` or the registration map changes | The four-counts table plus named orphans, matching disk; any change from last census carries the commit that caused it | The 2026-08-24 session that corrected 21 "live" to ≈18 and found 3 orphans registered nowhere ([[agent-fleet-charter]] §Corrections) | NEW |
| `subscription-coverage-check` | T2 | Any PR that registers an agent or adds/removes a topic | Every subscribed topic paired with ≥1 publisher, or a named gap row | `EmailIntelAgent` subscribed to `email.inbound.raw` — zero publishers, pipeline dead, hidden behind a missing registration (`core/orchestrator.py:198-206`) | NEW |

Consumed, owned elsewhere: `harness-contract-audit`
([[harness-runtime-agent-stack]]) — the census consumes its contract-membership
column rather than recomputing it.

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: fleet_census`; later, per-agent
  `task_success_rate` slices (needs `context.agent_module` as a jsonb key so stubs
  can be excluded by filter, not by footnote).
- **Semantic** — `memory/` beside this file, index `agent-fleet-MEMORY.md`. First
  facts are the charter's verified corrections: the four counts as of 2026-08-24,
  the three orphans, the zero-publisher topic. Provenance per ADR 0034; every write
  a PR.
- **Working** — this card, the MEMORY index, charter §Boundaries (the four-counts
  table). Individual agent modules are retrieval targets.

**Consolidation** — monthly: diff censuses; every state transition (orphan adopted,
stub gated on, module registered) becomes a fact citing the commit; expire at 90
days unverified; propose candidates. One PR; "no delta" stated when true.

## 5. Async contract

Board rows and memory PRs to the department; NF-A events; loops per
[[agent-fleet-loops]]. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `agents.module_added` has no publisher | Same 7-day blind spot as harness-sentinel; one publisher would serve both cards |
| `nf_a.task_success_rate` not emitted for any agent | The primary metric arrives only with fleet instrumentation; until then the census columns are the whole readout |
| TECH-F6 co-ownership | Guardian-agent findings are SRE's; if the census starts *reading* findings it has crossed the seam — the census counts, it never grades |

## 6. Evidence today

- **NEW — the census agent and both skills.** Both censuses were hand-run in the
  2026-08-24 session; nothing repeats them.
- **EXISTS — the material.** 26 modules, the registration map, the repo's own
  warning about registered-vs-live (`core/orchestrator.py:214-217`).
- **PARTIAL — the numbers.** `fleet.live_agent_ratio` ≈18/26 and
  `fleet.orphan_modules` = 3 are computable today without NF-A — the charter calls
  this "the number this team can publish this week," and this card is the standing
  form of that sentence.
