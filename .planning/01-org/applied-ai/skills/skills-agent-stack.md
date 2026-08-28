---
type: agent-stack
division: applied-ai
department: skills
status: designed
updated: 2026-08-27
metrics: [skills.registry_size, skills.protocol_compliance_rate, skills.firing_rate_30d, skills.deletions_per_quarter]
links: ["[[skills-charter]]", "[[skills-schedule]]", "[[skills-loops]]", "[[skills-agenda-board]]", "[[0034-agent-stack-artifact]]", "[[skill-registry-authoring-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[ai-orchestration-agent-stack]]"]
---

# Skills — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The department that owns every other unit's §3 table gets the same treatment it
> gives: a card, a skill table held to §3.3, and memory. Its special obligation is
> reflexive — this stack administers the layer that all 99 agent-stack docs depend
> on, so its numbers (registry size, compliance, firings) are wave-2's health
> readout.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `skills-orchestrator` | Roll the three team boards into the department set, watch the creation/deletion balance, and carry the contested weekly skill-health job until OD-25 names its owner | NEW |

## 2. Agent cards

```yaml
agent: skills-orchestrator
unit: skills
triggers:
  - schedule: "weekly, after the team boards refresh"      # mirrored in [[skills-schedule]]
  - topic: skills.registry_changed                          # publisher: NONE (gap — a git hook or CI step on .claude/skills/ would be the natural one)
consumes:
  - the registry index (skill-registry-authoring's artifact; today nonexistent)
  - the three team agenda-boards
  - nf_a events filtered by skill_id                        # blocked: skill_id is not a column (see §5)
emits:
  - "[[skills-agenda-board]] rollup — additions vs deletions shown together, so a growing registry with zero deletions reads as the failure it is"
  - "the department numbers to [[ai-orchestration-agent-stack|aio-orchestrator]]"
  - nf_a events (task_type: skills_board_rollup)
routing_class: extraction
quality_bar: "firing_rate reads 'unmeasurable' until the telemetry exists — never 0, never omitted (ADR 0016/0020)"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm   # constant; no such surface here
memory: skills
escalates_to: "[[02-advisory/decision-office/decision-office-charter|decision-office-charter]] — OD-25 (who owns the weekly job) is theirs to close; this card carries the job only until then"
```

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `skill-health-report` | T2 | Weekly (README §6) — **ownership contested, OD-25**: run here until the Decision Office names R&M or this department | What fired / what went stale, per skill, with "unmeasurable" stated wherever telemetry is missing | The schema-parity daily cron (`schema-parity.yml:26-27`) is the charter's named working analogue — same shape, different subject | NEW |

One row only, deliberately: the department's real skills live in its teams' stacks
([[skill-registry-authoring-agent-stack]], [[skill-lifecycle-anti-sprawl-agent-stack]]),
and a department table that duplicated them would be sprawl in the sprawl
department.

## 4. Memory

- **Procedural** — the §3 row; candidates via the harvesting queue like everyone else.
- **Episodic** — nf_a `task_type: skills_board_rollup`; the department's real
  episodic need is **`nf_a.skill_id`**, the requested-not-designed field
  ([[skill-lifecycle-anti-sprawl-charter]] §Metrics) — without it no unit's
  procedural memory can be observed firing.
- **Semantic** — `memory/` beside this file, index `skills-MEMORY.md`. First facts:
  registry size 0 with the vendor-CLI caveat; the 59:0 script-to-skill ratio; the
  OD-25 contested state. Provenance per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, README §3.1–3.3 (the protocol text is
  the department's constitution; small and always loaded).

**Consolidation** — monthly: diff registry state; every addition checked against
§3.3 compliance becomes a fact; a quarter trending toward additions-without-
deletions becomes a failure fact early, not at quarter end; expire at 90 days
unverified. One PR; "no delta" stated when true.

## 5. Async contract

Board rows, memory PRs, NF-A events; loops per [[skills-loops]]. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `skills.registry_changed` has no publisher | `.claude/skills/` exists (README only, zero committed skills — verified 2026-08-27); CI on that path is the natural publisher and is not wired — until then the weekly poll is the trigger |
| `nf_a.skill_id` is not a column | The single blocking dependency for firing telemetry, named in three charters; the request goes to R&M / OD-11 as a schema ask, async, and this department must not design the column itself |
| The registry index does not exist | skill-registry-authoring's first deliverable; every consumer above is honest about reading nothing until then |

## 6. Evidence today

- **NEW — everything in the roster and §3.** The repo has zero committed skills;
  the one `SKILL.md` on disk is gitignored vendor tooling (charter §Evidence).
- **EXISTS — the enforcement patterns to copy.** Five `check_*.sh` CI guards; the
  schema-parity daily cron; the §3.3 protocol as locked prose.
- **EXISTS — the demand.** 59 `scripts/` entries behaving like skills without the
  envelope — the reservoir wave 2's §3 tables will draw candidates from, through
  the gate.
