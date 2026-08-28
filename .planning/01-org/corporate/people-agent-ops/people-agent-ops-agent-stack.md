---
type: agent-stack
division: corporate
department: people-agent-ops
status: designed
updated: 2026-08-27
metrics: [roster.truth_pct, roster.unregistered_module_count, roster.silent_default_spec_count, roster.maturity_level_evidenced_pct, nf_a.doneability_verdict_coverage, nf_a.cost_per_task, nf_a.cost_per_completed_task, nf_a.verified_task_success_rate]
links: ["[[people-agent-ops-charter]]", "[[people-agent-ops-schedule]]", "[[people-agent-ops-loops]]", "[[people-agent-ops-agenda-board]]", "[[people-agent-ops-questions]]", "[[0034-agent-stack-artifact]]", "[[roster-lifecycle-agent-stack]]", "[[performance-doneability-agent-stack]]", "[[skills-charter]]"]
---

# People & Agent Ops — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The most self-referential page in the vault: the HR function of a company whose
> workforce is agents ([[people-agent-ops-charter]] §Mandate) has just been handed
> **personnel files** — the `*-agent-stack.md` corpus is a declared workforce, one card
> per unit. This page is both an artifact of that corpus and a document about it, and it
> must not confuse the two populations (declared card agents ≠ `agents/*.py`). See §5.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `pao-board-keeper` | Carry the two team metric sets onto one board **without averaging them**, age every Research & Math dependency in public, and escalate the seams — never do either team's work | NEW |

One row deliberately. The department's two questions already have two team owners, and
premortem M1 ("roster hygiene ate the year, and doneability never started") is exactly
what a department agent that started *doing* the cheap half would cause.

## 2. Agent cards

```yaml
agent: pao-board-keeper
unit: people-agent-ops
triggers:
  - schedule: "weekly (coverage publication + dependency escalation sweep)"   # mirrored in [[people-agent-ops-schedule]]
  - schedule: "quarterly (fleet review readiness — gated, L-PAO-5)"
  - topic: dependency.close_time_breached      # publisher: NONE (gap — CORP-F5's age is computed by hand from its filing date)
consumes:
  - the two team agenda-boards (Dataview output) — [[roster-lifecycle-agenda-board]], [[performance-doneability-agenda-board]]
  - nf_a events sliced by this department's task types (ADR 0006/0008); verdict sidecars per ADR 0017
  - "[[people-agent-ops-questions]] Open rows (advisory findings, e.g. DO-3, age-out 2026-10-05)"
  - "the §1 Roster of every `*-agent-stack.md` — the declared workforce; publisher: the vault (wave 2, ADR 0034), no event"
emits:
  - "[[people-agent-ops-agenda-board]] rollup — the metric SET, never one number (charter §Metrics: roster truth and doneability coverage are not commensurable)"
  - "CORP-F5 and OD-11 ages → [[FORK-REGISTRY]] / `OPEN-DECISIONS.md`, weekly, moved or not"
  - escalation notes into [[people-agent-ops-agenda-full]] §Questions
  - nf_a events (task_type: people_board_rollup)
routing_class: extraction        # reading two boards and ageing a filing date is counting, not judgment
quality_bar: "two numbers, never one; every board row carries a value or the words 'not emitted' (ADR 0020); `success_rate` never appears unqualified — in this department's artifacts it is `nf_a.liveness_rate` ([[performance-doneability-charter]] §Metrics)"
autonomy:
  read: autonomous
  propose: autonomous            # board edits, escalations and fork-age updates land as PRs
  mutate_stock_money_outbound: confirm    # constant; this agent has no such surface
memory: people-agent-ops
escalates_to: "[[decision-office-charter]]"   # seam disputes (TECH-F3-shaped) go to advisory, never to a sibling department
```

**The card's own hard rule:** `pao-board-keeper` never runs a census and never grades a
worker. Both are team jobs with team close-times; a department agent that ran them would
recreate the duplication the charter's three-verbs table (define · run · employ) exists
to prevent.

## 3. Skills

**The table is empty, deliberately.** Every candidate in [[people-agent-ops-schedule]]
§Skills owned is assigned to one of the two teams, and the one job that looks
department-shaped — weekly dependency ageing — is already
[[performance-doneability-schedule]]'s "Blocker ageing" at the same cadence. **There is no
procedure this department has repeated at department level that a team does not already
own**, so per README §3.3 there is no row to write; a duplicate here would be roster
sprawl in skill form, which the schedule names as the same disease.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]],
[[skill-lifecycle-anti-sprawl-charter]]); every skill in [[roster-lifecycle-agent-stack]]
§3 and [[performance-doneability-agent-stack]] §3.

## 4. Memory

- **Procedural** — none owned (§3). Candidates surfaced by consolidation go to the
  owning team first, then to [[skill-harvesting-charter]]'s queue through the §3.3 gate.
- **Episodic** — nf_a `task_type: people_board_rollup`, plus read access to both teams'
  task families. Needs `context.team` as a jsonb key so a per-team slice is one filter
  rather than a join this department invents.
- **Semantic** — `memory/` beside this file, index `people-agent-ops-MEMORY.md`. Founding
  facts are already known and are failures: four unreconciled headcounts (19 · 23 · 24 ·
  26), `nf_a.doneability_verdict_coverage` at ~0%, and CORP-F5's filing date as the
  origin of `people.blocked_days`. Provenance frontmatter per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics (so "not
  commensurable" is loaded on every run). Team charters and the card corpus are retrieval
  targets, never preloaded.

**Consolidation** — monthly, mirrored in [[people-agent-ops-schedule]]: read the
department's NF-A slice and both boards; distil durable facts, **failures first** — a
quarter in which coverage did not move produces a fact naming *why* and the blocker's
age, because "no delta" on a metric is never "no delta" on a blocked dependency; expire
facts unverified for 90 days; propose skill candidates to the owning team. One PR; a run
that changes nothing reports "no delta", never silence.

## 5. Async contract

Cross-unit interaction is loops ([[people-agent-ops-loops]]), NF-A events, vault PRs and
skill candidates only. Gap rows, stated rather than assumed away:

| Gap | Why it is a gap |
|---|---|
| `dependency.close_time_breached` has no publisher | Nothing measures a fork's age; CORP-F5 (40 citations in 16 files, [[FORK-REGISTRY]]) ages by hand. The weekly sweep bounds the blind spot at 7 days |
| Advisory findings arrive as doc rows | DO-3 sits Open in [[people-agent-ops-questions]] with a 2026-10-05 age-out; nothing notifies, so the board keeper must poll it |
| The card corpus has no publisher and no reconciler | ADR 0034 §Consequences promises the census "a declared baseline to reconcile against". Nothing does that reconciliation yet, and **which unit owns it is not decided here** — see [[roster-lifecycle-agent-stack]] §5 |
| Declared card agents are a fifth population, not a fifth headcount | One card per unit counts *organisational* agents; `roster.headcount_claim_variance` counts `agents/*.py`. Merging them would manufacture a fifth wrong number. Left open |

## 6. Evidence today

- **NEW — `pao-board-keeper` and everything in §4.** The only thing rolling anything up
  today is the Dataview in [[people-agent-ops-agenda-board]], which renders and does not
  escalate.
- **PARTIAL — the personnel-file corpus.** Mid-generation on 2026-08-27 (wave 2): a
  minority of the 99 cards exist, so the declared workforce is real but incomplete and
  any count taken today is a snapshot with a date on it.
- **PARTIAL — the episodic substrate.** NF-A emits since P1
  (`model-client.service.ts:413`); coverage is ~0% with one basis (`reconciliation_v1`,
  ADR 0017), so the rollup would today be mostly honest "not emitted" rows — which is
  what ADR 0020 asks for.
- **EXISTS — the material both teams measure**, cited in [[people-agent-ops-charter]]
  §Evidence: `core/agent_registry.py`, `core/orchestrator.py:174-211,245`,
  `core/base_agent.py:77,743`, `decision_log` (`:2687`), `api_spend` (`:2231`).
