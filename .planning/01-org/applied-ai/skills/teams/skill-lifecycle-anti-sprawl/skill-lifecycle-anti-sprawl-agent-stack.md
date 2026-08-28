---
type: agent-stack
division: applied-ai
department: skills
team: skill-lifecycle-anti-sprawl
status: designed
updated: 2026-08-27
metrics: [skills.deletions_per_quarter, skills.firing_rate_30d, skills.registry_size]
links: ["[[skill-lifecycle-anti-sprawl-charter]]", "[[skill-lifecycle-anti-sprawl-schedule]]", "[[skill-lifecycle-anti-sprawl-loops]]", "[[0034-agent-stack-artifact]]", "[[skills-agent-stack]]", "[[skill-registry-authoring-agent-stack]]"]
---

# Skill Lifecycle & Anti-Sprawl — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The deletion team's agent is the vault's counter-pressure made executable: wave 2
> creates ~99 documents describing skills; this card describes the thing that will
> shrink them. Its primary metric rewards removal, so its card is written to make
> proposing a deletion cheap and rubber-stamping a keep expensive.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `staleness-reaper` | Make "has this skill fired?" answerable, run the 30-day review on the answer, and propose deletions — including over the author's objection | NEW |

## 2. Agent cards

```yaml
agent: staleness-reaper
unit: skill-lifecycle-anti-sprawl
triggers:
  - schedule: "weekly skill-health run"                     # OD-25: ownership of the *job* is contested; the card runs it under [[skills-agent-stack]]'s carry until the Decision Office rules
  - topic: skills.registry_changed                          # publisher: NONE (gap — same publisher skills-orchestrator's card names)
consumes:
  - the registry index (from [[skill-registry-authoring-agent-stack|registry-clerk]])
  - nf_a events by skill_id                                  # blocked: the column does not exist — the critical path, escalated not absorbed
emits:
  - the staleness table: per skill, last fired / "unmeasurable", days stale
  - deletion proposals as PRs deleting the SKILL.md, with the staleness evidence in the body
  - "skills.deletions_per_quarter, firing_rate_30d to [[skills-agent-stack|skills-orchestrator]]"
  - nf_a events (task_type: skill_staleness_review)
routing_class: mechanical         # counting firings is arithmetic; the *review* of a stale skill is the human merge decision on the PR
quality_bar: "no skill is graded on an unknown: 'unmeasurable' rows are escalated as the telemetry gap, never counted as stale (deleting on an unknown) or fresh (keeping on an unknown)"
autonomy:
  read: autonomous
  propose: autonomous              # a deletion PR is a proposal; the merge is the human gate — deletion authority means the proposal needs no author consent, not that no human confirms
  mutate_stock_money_outbound: confirm   # constant; no such surface
memory: skill-lifecycle-anti-sprawl
escalates_to: "[[skills-charter]]; the paired-deletion ceiling's VALUE is the founder's ([[skills-directive]]) — the reaper enforces N, never sets it"
```

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `skill-staleness-review` | T2 | Weekly, per the health run | Every registered skill has a row: fired-within-30d / stale (with deletion proposal opened) / unmeasurable (with the gap escalated) | The daily schema-parity cron (`schema-parity.yml:26-27`) — the charter's named analogue: a scheduled job that fails loudly on quiet, accumulating divergence | NEW |

One skill only. The reaper's other duties (proposing deletions, escalating the
telemetry gap) are the card's emits, not separate procedures — splitting them into
more skills would be this team failing its own test.

## 4. Memory

- **Procedural** — the §3 row.
- **Episodic** — nf_a `task_type: skill_staleness_review`; the layer this team
  exists to demand is someone else's episodic memory — `nf_a.skill_id` on every
  task event, requested from R&M (OD-11 path), never designed here.
- **Semantic** — `memory/` beside this file, index
  `skill-lifecycle-anti-sprawl-MEMORY.md`. First facts: telemetry-gap status and
  its escalation date; the 59-entry `scripts/` reservoir as the no-lifecycle
  counterexample. Every deletion (and every deletion *refused* at merge) becomes a
  fact with the reason — the record of what the org actually deletes. Provenance
  per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, the 30-day rule text (README §3.3).

**Consolidation** — quarterly, matching the primary metric's period: additions vs
deletions for the quarter; **a quarter with additions and zero deletions is
written up as a failure fact naming what should have been proposed** — the metric's
definition, applied to itself; expire at 90 days unverified. One PR.

## 5. Async contract

Deletion proposals are PRs; the staleness table is a committed artifact; the
telemetry ask is an agenda-full question to R&M. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `nf_a.skill_id` does not exist | The entire firing signal; "currently undefined, not zero — undefined defaults to keep" (charter §Metrics). The card's ordering follows the charter's one good ordering: telemetry can be built before the first skill exists |
| Nothing to reap | registry_size = 0 — the reaper's design being ready *before* inventory exists is the point, not a problem |
| OD-25 unresolved | The weekly job runs under a carry, and every run's output says so, so the contested ownership is visible in the artifact rather than settled by drift |

## 6. Evidence today

- **NEW — everything.** The charter grades the team NEW and nothing found here
  upgrades it: no telemetry, no review, no deprecation path, no inventory.
- **EXISTS — the two patterns to copy.** The schema-parity cron (shape of the
  job) and the five CI guards (shape of the enforcement).
