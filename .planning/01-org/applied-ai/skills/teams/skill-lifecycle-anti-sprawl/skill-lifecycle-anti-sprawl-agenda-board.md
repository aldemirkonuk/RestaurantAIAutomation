---
type: agenda-board
division: applied-ai
department: skills
team: skill-lifecycle-anti-sprawl
status: provisional
metrics: [skills.deletions_per_quarter, skills.firing_rate_30d, skills.registry_size]
updated: 2026-08-24
links: ["[[skill-lifecycle-anti-sprawl-charter]]", "[[skill-lifecycle-anti-sprawl-agenda-full]]", "[[skill-lifecycle-anti-sprawl-loops]]", "[[skills-agenda-board]]"]
---

# Skill Lifecycle & Anti-Sprawl — Board

> **PROVISIONAL — no work done yet.**

## Team docs — live query

```dataview
TABLE WITHOUT ID file.link AS Doc, type AS Type, status AS Status, updated AS Updated
FROM "01-org/applied-ai/skills/teams/skill-lifecycle-anti-sprawl"
SORT type ASC
```

## Everything in the department not yet started

```dataview
TABLE WITHOUT ID file.link AS Doc, team AS Team, status AS Status
FROM "01-org/applied-ai/skills"
WHERE status = "new" OR status = "provisional"
SORT team ASC, type ASC
```

## Counters

- `skills.deletions_per_quarter` — **0** (nothing to delete; `registry_size` is 0)
- `skills.firing_rate_30d` — **undefined**, not zero. The distinction is the team's
  entire critical path: undefined defaults to *keep*.
- `skills.registry_size` — **0**
- `nf_a.skill_id` — **does not exist**

## Blocking

- [ ] No `skill_id` on the NF-A event — blocks the 30-day rule, blocks deletion,
      blocks this team from having a function
- [ ] L4 emits nothing at all ([[README]] §1)
- [ ] OD-11 open — NF production schema column detail undecided
- [ ] Weekly skill-health job unowned — [[README]] §6 vs [[technology]] §4.2 conflict
- [ ] Registry ceiling N unset — paired-deletion rule has no threshold

## Not blocked — start now

- [ ] Write the telemetry ask (`skill_id` + doneability verdict, one negotiation)
- [ ] Agree "telemetry precedes skill #2" with [[skill-registry-authoring-charter]]
- [ ] Spec the fallback harness-side invocation log
- [ ] Write the default-delete review procedure

## Watch

- Skill #2 lands while `firing_rate_30d` undefined → premortem M1
- First quarter with additions > 0 and deletions == 0 → M2
- Any `archive/` or `deprecated/` dir inside `.claude/skills/` → M3
- Firing distribution goes bimodal at n≈10 → M4
