---
type: agent-stack
division: applied-ai
department: skills
team: skill-harvesting
status: designed
updated: 2026-08-27
metrics: [skills.harvested_firing_rate_30d, skills.script_to_skill_ratio]
links: ["[[skill-harvesting-charter]]", "[[skill-harvesting-schedule]]", "[[skill-harvesting-loops]]", "[[0034-agent-stack-artifact]]", "[[skill-registry-authoring-agent-stack]]", "[[skills-agent-stack]]"]
---

# Skill Harvesting — Agent Stack

> **DESIGNED — AND GATED TWICE.** Nothing here is built, and unlike its siblings
> nothing here may be *staffed* either: the team's entry trigger (registry ≥ 15
> skills, or two consecutive green compliance quarters — [[skill-harvesting-charter]],
> unsoftened) has not fired, and registry size is 0. This page exists so the card is
> written before anyone is under pressure to invent it. Until the trigger fires, the
> harvest sweep runs inside [[skill-registry-authoring-agent-stack|registry-clerk]]'s
> card, where it is already listed as a scheduled trigger.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `harvest-miner` ⏸ GATED | Sweep work that already happened — `scripts/`, workflows, repeated commit patterns — for procedures missing a `SKILL.md`, and file candidates with evidence attached | NEW, and must stay unstaffed until the trigger fires |

## 2. Agent cards

```yaml
agent: harvest-miner            # ⏸ GATED — this card activates only on the charter trigger, and a gated team that self-activates has no gate
unit: skill-harvesting
triggers:
  - schedule: "monthly sweep"                               # on activation; until then the sweep is registry-clerk's recurring task
  - topic: skills.proposal_rejected_no_instance             # publisher: [[skill-registry-authoring-agent-stack|registry-clerk]] (directive node D) — a rejected speculative skill is a real one waiting for evidence
consumes:
  - scripts/ (59 entries), .github/workflows/ (5), repeated commit patterns
  - the rejected-proposal stream
emits:
  - candidates into the queue: evidence, proposed trigger, proposed owning department — never a committed skill
  - "skills.script_to_skill_ratio to [[skills-agent-stack|skills-orchestrator]]"
  - nf_a events (task_type: harvest_sweep)
routing_class: judgment           # "is this script a procedure worth an envelope?" is a reading, not a count
quality_bar: "every candidate carries checkable evidence (the script path, the commit pattern, the repetition); admission is not this card's to grant — the §3.3 gate at registry-clerk still stands, at any volume"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm   # constant; no such surface
memory: skill-harvesting
escalates_to: "[[skills-charter]]; the disband condition is a number (harvested_firing_rate_30d must beat on-demand authoring) and its evaluation belongs to the department, not to this card"
```

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| — | | | | | |

**Empty, deliberately.** The team is unstaffed and its one procedure (the sweep) is
currently registry-clerk's. Writing a skill table for a gated team would be the
speculative-skill failure §3.3 rule 3 exists to stop. When the trigger fires, the
sweep procedure graduates here with its accumulated past instances.

## 4. Memory

Designed now, empty until activation:

- **Procedural** — none (see §3).
- **Episodic** — nf_a `task_type: harvest_sweep`, emitted by registry-clerk's
  carried sweep in the meantime, so activation inherits a history instead of a
  cold start.
- **Semantic** — `memory/` beside this file, index `skill-harvesting-MEMORY.md`.
  The candidate queue is the team's real memory and it predates the team: candidates
  filed by the carried sweep live there with evidence attached. First fact on
  activation: the baseline 59:0 script-to-skill ratio, dated.
- **Working** — the card, the index, the entry trigger's text — so every future
  session that opens this doc reads the gate before the mandate.

**Consolidation** — on activation, quarterly: do harvested skills fire more than
on-demand ones? The answer is a fact either way, and a "no" twice running is the
disband condition surfacing in memory rather than in a retrospective.

## 5. Async contract

Candidates are file appends to the queue; admission is registry-clerk's PR gate;
the ratio is a board row. Gap rows:

| Gap | Why it is a gap |
|---|---|
| The candidate queue does not exist | Registry-clerk's carried sweep needs it first; it is a file, not a service — designed in wave 2, built when the first candidate is filed |
| `skills.harvested_firing_rate_30d` unmeasurable | Same `nf_a.skill_id` block as the whole department — and the charter's own argument stands: a team whose disband condition cannot be evaluated must not staff |

## 6. Evidence today

- **EXISTS, abundantly — the reservoir.** 59 `scripts/` entries, 5 CI guards,
  three built CLIs (docgen 11, synth 11, simulate 8), 5 workflows — every one a
  procedure with a trigger and a success criterion, missing only the envelope.
- **NEW — everything else,** and correctly so: the material is the strongest
  evidence in the department and the team is the weakest justified
  (charter §Honest read, kept verbatim because it is the finding).
