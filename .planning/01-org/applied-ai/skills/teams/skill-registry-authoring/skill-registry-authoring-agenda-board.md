---
type: agenda-board
division: applied-ai
department: skills
team: skill-registry-authoring
status: provisional
metrics: [skills.protocol_compliance_rate, skills.registry_size, skills.description_disambiguation_rate]
updated: 2026-08-24
links: ["[[skill-registry-authoring-charter]]", "[[skill-registry-authoring-agenda-full]]", "[[skill-registry-authoring-loops]]", "[[skills-agenda-board]]"]
---

# Skill Registry & Authoring — Board

> **PROVISIONAL — no work done yet.**

## Team docs — live query

```dataview
TABLE WITHOUT ID file.link AS Doc, type AS Type, status AS Status, updated AS Updated
FROM "01-org/applied-ai/skills/teams/skill-registry-authoring"
SORT type ASC
```

## Sibling status

```dataview
TABLE WITHOUT ID team AS Team, status AS Status, updated AS Updated
FROM "01-org/applied-ai/skills"
WHERE type = "charter" AND team
SORT team ASC
```

## Counters

- `skills.registry_size` — **0**
- `skills.protocol_compliance_rate` — undefined (denominator 0)
- `skills.description_disambiguation_rate` — n/a below n=2
- `skills.script_to_skill_ratio` — **59:0**

## Blocking

- [ ] `.claude/skills/` does not exist
- [ ] Template is borrowed from a gitignored vendor file (`.gitignore:100`)
- [ ] §3.3 protocol has no CI enforcement
- [ ] OD-14 open — root `SKILLS.md` says "WineOps AI" (`SKILLS.md:3,53`)
- [ ] `tier` field blocked on [[README]] §3.2 `⬦ FORK`

## Not blocked

- [ ] Steps 1–5 in [[skill-registry-authoring-agenda-full]] need no telemetry — this
      is the department's only unblocked team

## Watch

- First `past_instance` field that is not a commit SHA or `path:line` → premortem M1
- First trigger overlap between two skills → premortem M2
- `script_to_skill_ratio` still > 1:1 two quarters after launch → premortem M3
