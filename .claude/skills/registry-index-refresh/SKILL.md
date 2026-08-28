---
name: registry-index-refresh
description: Use after any merge into .claude/skills/, and weekly — recomputes the skill registry census (size, §3.3 protocol compliance per skill) so "how many skills do we have and do they follow the protocol" is a measurement, not a memory.
---

# registry-index-refresh

owner: skill-registry-authoring (applied-ai) — card `registry-clerk`, [[skill-registry-authoring-agent-stack]]

## Trigger

Any merge that adds, edits, or deletes a `SKILL.md` under `.claude/skills/`;
weekly otherwise.

## How to run

```bash
python3 scripts/agents/run_card.py --agent registry-clerk
```

## Doneability

Every committed skill has a row: §3.3 fields (trigger · doneability · real
past instance · owner) present or the missing ones named. Compliance rate has
an explicit denominator; at zero skills it reads "undefined", never 100%.
Last-fired stays "unmeasurable" until `nf_a.skill_id` exists — that column is
[[skill-lifecycle-anti-sprawl-agent-stack]]'s escalation, not this skill's.

## Real past instance

The registry sat at zero committed skills from the department's chartering
(2026-08-24) until 2026-08-28, when the first four were committed and the
first automated census measured them — this file is one of the four, so this
skill's own admission ran through the gate it documents.
