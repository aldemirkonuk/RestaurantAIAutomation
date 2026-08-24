---
type: agenda-board
division: platform
department: engineering
team: client-surfaces
status: provisional
metrics: [surfaces.reachable_route_ratio]
updated: 2026-08-24
links: ["[[client-surfaces-charter]]", "[[client-surfaces-agenda-full]]", "[[client-surfaces-loops]]", "[[engineering-agenda-board]]", "[[design-charter]]"]
---

# Client Surfaces — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/platform/engineering"
WHERE team = this.team
SORT type ASC
```

## Everything in the department that names a metric this team owns

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  type AS Type
FROM "01-org/platform/engineering"
WHERE contains(string(metrics), "surfaces.")
SORT team ASC, type ASC
```

## Stale here (60-day rule)

```dataview
LIST rows.file.link
FROM "01-org/platform/engineering"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
GROUP BY type
```

## The two numbers — side by side, on purpose

- [ ] `surfaces.reachable_route_ratio` — baseline **24 orphan routes** of 51; **not recomputed**
- [ ] `surfaces.untraceable_route_components` — **13**; not recomputed
- [ ] UX paths burned down — ~90–100 of 760. **Input, not the goal**
- [ ] Rule: if only the burn-down moves for 3 close-times, the department reallocates

## Counters

- [ ] Link-graph CI job — **not built**; blocks verification of every orphan fix
- [ ] *Semi-orphaned* category with link provenance — **not defined**
- [ ] CLAUDE.md §1 says Next.js; repo is Vite + `react-router-dom` — **uncorrected**
- [ ] Mobile split re-evaluation trigger — **unwritten**
- [ ] Storybook stories — **4** (thin); none targeting empty/error/partial/stale
- [ ] Web test files — 34
- [ ] Comprehension defects logged against a named screen — **channel not open**

## Open

- [ ] Which of the 24 orphans are deliberate? — [[design-charter]] or founder
- [ ] What counts as a legitimate inbound link?
