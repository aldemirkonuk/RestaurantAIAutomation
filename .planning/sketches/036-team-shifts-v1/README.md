---
sketch: 036
name: team-shifts-v1
question: "Can one page hold roster + Excel-style shift grid + real restaurant ops (coverage, swaps, certs) without feeling like enterprise software?"
winner: null
tags: [team, shifts, schedule, grid, coverage, swaps, certifications, availability, restaurant-ops, ui-skill-consultant]
---

# Sketch 036: Team + Shifts v1

## Design Read

**Reading this as:** operational app page for restaurant owners/managers, Linear-meets-Apple language locked from sketch 035, VISUAL_DENSITY raised to 6 for the grid (it is a work tool), everything else stays calm.

## v1 Scope (agreed in brainstorm)

Core: member list + roles + locations, weekly shift grid (15), coverage warnings (17), publish + notify (19), recurring availability (24), time-off requests (25), swap requests (29), cert expiry alerts (34), shift notes (44).

## Layout

Single page, two zones:

1. **Roster strip** (top) — horizontal member cards: photo/monogram, name, position, cert status dot only when expiring, availability on hover
2. **Shift grid** (hero) — Excel-style: rows = people, columns = Mon-Sun, cells = shift chips (AM / PM / split / double). Toolbar: week nav, copy last week, labor summary, Publish

Supporting drawers (mocked as static panels in sketch): pending swaps, time-off requests, shift notes per day.

## What the sketch shows

- Coverage warning row under the grid (Fri dinner short 2)
- Cert expiry chip on one member (alcohol service, 12 days)
- One pending swap + one time-off request in the side rail
- Draft vs Published state on the week
- Shift note on Friday ("80-top private event 7pm")
- Reduced-motion safe; grid is plain DOM, no canvas

## How to View

```
open .planning/sketches/036-team-shifts-v1/index.html
```

## Production notes

- Grid = CSS grid, sticky first column, horizontal scroll on mobile
- Shift chips = shadcn `Popover` for edit; drag-to-paint later (v2)
- Coverage rules configurable per shift template (v2)
- Data model: `shifts(member_id, location_id, date, start, end, role, note)`
