---
type: agent-stack
division: applied-ai
department: skills
team: skill-registry-authoring
status: designed
updated: 2026-08-27
metrics: [skills.protocol_compliance_rate, skills.registry_size, skills.description_disambiguation_rate]
links: ["[[skill-registry-authoring-charter]]", "[[skill-registry-authoring-schedule]]", "[[skill-registry-authoring-loops]]", "[[skill-registry-authoring-directive]]", "[[0034-agent-stack-artifact]]", "[[skills-agent-stack]]", "[[skill-harvesting-charter]]"]
---

# Skill Registry & Authoring — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The gatekeeper's stack: one agent that runs the §3.3 protocol gate on every
> proposed skill — including every §3 row that wave 2 writes into 99 agent-stack
> docs. This card is therefore wave 2's own quality gate, described inside wave 2.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `registry-clerk` | Hold the gate on `.claude/skills/`: check every proposed skill against §3.3 (trigger · doneability · real past instance · owner), keep the index true, and reject description collisions | NEW |

## 2. Agent cards

```yaml
agent: registry-clerk
unit: skill-registry-authoring
triggers:
  - topic: skills.proposal_opened                           # publisher: a PR touching .claude/skills/ — EXISTS as a mechanism (PR review) the moment the directory does
  - schedule: "harvest sweep, recurring"                     # carried here until [[skill-harvesting-charter]]'s trigger fires (registry ≥ 15 or two green quarters)
consumes:
  - PRs adding or editing SKILL.md files
  - the candidate queue (rejected-for-no-instance proposals feed harvesting's queue — directive node D)
  - the §3 tables of agent-stack docs (wave 2's proposed-skill supply line)
emits:
  - the registry index — name, owner, tier, last-fired (last-fired blocked on telemetry)
  - gate verdicts on proposals: pass / fail with the §3.3 clause named
  - "skills.protocol_compliance_rate, registry_size to [[skills-agent-stack|skills-orchestrator]]"
  - nf_a events (task_type: skill_gate_review)
routing_class: judgment           # "is this past instance real?" is a reading of evidence, not a grep
quality_bar: "every admitted skill cites a checkable past instance (path:line / PR / dated session); two skills with overlapping declared triggers are one skill or one is rejected — the anti-collision rule"
autonomy:
  read: autonomous
  propose: autonomous              # verdicts are PR reviews; admission is the PR merging, a human act
  mutate_stock_money_outbound: confirm   # constant; no such surface
memory: skill-registry-authoring
escalates_to: "[[skills-charter]]"
```

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `skill-proposal-review` | T2 | A PR proposes a new or changed `SKILL.md` | A verdict naming each §3.3 clause pass/fail; a fail names what is missing, and a no-instance fail routes the proposal to the candidate queue instead of deleting it | The §3.3 protocol exists as locked prose with zero enforcement (charter: "a protocol nobody enforces"); the five `check_*.sh` guards are the proven enforcement shape to copy | NEW |
| `registry-index-refresh` | T2 | Any merge into `.claude/skills/`, and weekly | Index matches disk: every skill present, owned, tiered; orphan entries named | The vault's own UNIT-MANIFEST.json is the working analogue — a machine index regenerated from disk rather than hand-edited | NEW |

Consumed, owned elsewhere: deletion and staleness
([[skill-lifecycle-anti-sprawl-agent-stack]]); T4 meta-skill methodology (Research
& Math, contested seam left contested).

## 4. Memory

- **Procedural** — the §3 skills. The self-reference is intended: `skill-proposal-review`
  is itself the first skill that should pass its own gate.
- **Episodic** — nf_a `task_type: skill_gate_review`; needs `context.skill_name`
  and `context.verdict` keys so compliance rate is a filter.
- **Semantic** — `memory/` beside this file, index
  `skill-registry-authoring-MEMORY.md`. First facts: the de-facto template's shape
  (railway-config SKILL.md, uncommitted, `.gitignore:100`); OD-14's state. Rejected
  proposals become facts with the rejection reason — the record that stops the same
  speculative skill being proposed thrice. Provenance per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, README §3.3 (the four clauses,
  preloaded — they are the job).

**Consolidation** — monthly: read the gate-review slice; recurring rejection
reasons become facts (and, at volume, candidates for a better proposal template);
expire at 90 days unverified. One PR; "no delta" stated when true.

## 5. Async contract

Gate verdicts are PR reviews; the index is a committed artifact; the candidate
queue handoff to harvesting is a file append. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `.claude/skills/` holds zero skills | The directory now exists with only a README (`.claude/skills/README.md:6`, verified 2026-08-27 — the charter's "first physical act" is done); every trigger above stays dry until the first skill lands |
| last-fired column blocked | `nf_a.skill_id` absent — the index ships with the column present and honestly empty ("unmeasurable"), per ADR 0016 |
| Wave 2's §3 tables are ~99 simultaneous proposal sources | The gate must process them as a queue, not a flood: agent-stack §3 rows are *designs* for skills, and each still enters through a normal PR when actually authored |

## 6. Evidence today

- **PARTIAL — the template.** `.agents/skills/railway-config/SKILL.md:1-214`,
  well-formed and uncommitted; borrowed, not owned.
- **EXISTS — the enforcement shape.** Five `check_*.sh` guards wired into CI.
- **NEW — the clerk, both skills, the index, the gate.** The directory itself now
  EXISTS (README only, zero skills — verified 2026-08-27, superseding the charter's
  2026-08-24 "absent"); registry size 0, so everything downstream of the first
  admitted skill is still unexercised.
