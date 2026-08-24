---
type: agenda-board
division: commercial
department: media-brand
team: social-community
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[social-community-charter]]"
  - "[[social-community-agenda-full]]"
  - "[[media-brand-agenda-board]]"
---

# Social & Community (M3) — Board

> **PROVISIONAL — no work done yet.**
>
> ⏸ **DORMANT.** Entry trigger: the first long-form article clears G3.

## This team's documents

```dataview
TABLE type, status, updated
FROM "01-org"
WHERE team = this.team
SORT type ASC
```

## What this team is waiting on

```dataview
TABLE WITHOUT ID team AS "Blocking team", status AS "Grade", updated AS "Updated"
FROM "01-org"
WHERE type = "charter" AND contains(list("editorial-gate", "content-production", "conversion-funnel", "brand-identity"), team)
SORT team ASC
```

## Stale check

```dataview
TABLE type, updated
FROM "01-org"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Active — the whole list

- [ ] Weekly trigger watch on the schedule, with a named owner
- [ ] Founder decision: reserve handles now, or not at all?

Nothing else is active. That is deliberate, not an omission.

## The launch list — do not start any of these yet

- [ ] Reply-routing rule — **blocked on M1**, would currently point at `support@wineops.ai` (`apps/web/src/pages/Help.tsx:18`)
- [ ] Metric reportable — **blocked on G5**, no product analytics exists
- [ ] One platform chosen, on evidence — **no research done in this session**
- [ ] First post = the article that fired the trigger
- [ ] Routing rule published where a replier can see it

## Watch

- [ ] Has any article cleared G3? — **no** (as of 2026-08-24)

## Open forks

- **CM-F6** — chartered dormant, or not chartered at all?
- Is the trigger right? Alternative: first verified recovery number (ties to Sales, not Growth)

## Not ours

- Writing the content → Growth G2
- Clearing it → Growth G3
- Funnel instrumentation → Growth G5
- The support address → Brand Identity M1
