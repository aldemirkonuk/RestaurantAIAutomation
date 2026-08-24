---
type: agenda-board
division: applied-ai
department: skills
status: provisional
metrics: [skills.registry_size, skills.deletions_per_quarter, skills.firing_rate_30d]
updated: 2026-08-24
links: ["[[skills-charter]]", "[[skills-agenda-full]]", "[[skills-loops]]", "[[skills-schedule]]", "[[skill-registry-authoring-agenda-board]]", "[[skill-lifecycle-anti-sprawl-agenda-board]]", "[[skill-harvesting-agenda-board]]"]
---

# Skills — Board

> **PROVISIONAL — no work done yet.**

## Unit status — live query

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  team AS Team,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/applied-ai/skills"
SORT team ASC, type ASC
```

## Stale check — anything untouched for 60 days

```dataview
TABLE WITHOUT ID file.link AS Doc, updated AS "Last touched"
FROM "01-org/applied-ai/skills"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Counters

- `skills.registry_size` — **0** committed skills in `.claude/skills/` (dir absent)
- `skills.protocol_compliance_rate` — undefined, denominator 0
- `skills.firing_rate_30d` — **unmeasurable**, no telemetry
- `skills.deletions_per_quarter` — 0
- `skills.script_to_skill_ratio` — **59:0**
- unit docs : committed skills — **28:0**

## Blocking

- [ ] `.claude/skills/` does not exist — blocks everything
- [ ] No `skill_id` on the NF-A event — blocks the 30-day rule
- [ ] OD-14 open — root `SKILLS.md` still says "WineOps AI" (`SKILLS.md:3,53`)
- [ ] TECH-F4 open — Skills at 3 teams or 2
- [ ] Weekly skill-health job unowned — [[README]] §6 and [[technology]] §4.2 conflict

## Teams

- [[skill-registry-authoring-charter]] — `partial` — contract + authoring
- [[skill-lifecycle-anti-sprawl-charter]] — `new` — deletion + telemetry
- [[skill-harvesting-charter]] — `new`, **GATED** — does not staff until ≥15 skills
