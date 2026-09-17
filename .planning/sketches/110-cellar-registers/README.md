---
sketch: 110
name: cellar-registers
question: "A register is open. What do you actually see — a list with depth in the margin, a gazetteer of the building in the house's own words, or a wall of tiles you scan?"
winner: null
tags: [cellar, wines, registers, list, gazetteer, wall, mudavym, directions, sketch-only, adr-0044, adr-0108]
---

# Sketch 110 · /cellar and its registers

## Design question

Sketches 092 and 095 settled the parent: registers this house carries, a floor
strip of confirmed zones, a whole-cellar table. They did not settle how a
register is *looked at*. The shipped answer is still an eight-to-ten-column
table with a reading stand above it. The founder asked for three other readings.

## How to view

```
open .planning/sketches/110-cellar-registers/index.html
```

Renders from `file://`, no server. Charcoal is the live default (ADR 0131);
paper is the one escape, toggled on every page.

| File | Direction |
|---|---|
| `index.html` | the fork, stated once |
| `the-list.html` | A — one plain list per register, depth in the margin |
| `the-gazetteer.html` | B — the cellar as a place, entries in the house's own words |
| `the-wall.html` | C — bottles as a wall of tiles you scan |

Same invented house on every direction (Kadıköy Meyhane, five registers, four
confirmed zones). Soft drinks are not drawn; two unconfirmed zones are not
drawn. `j`/`k` move on A and C.

## What this does not retire

092 and 095 stay. They answered a different question (what the parent *is*).
This pass does not reopen the floor, the kind facet, or the merged row-expander.
It also does not pick a winner — the three are drawn so the founder can.

## Related

- `.planning/sketches/092-cellar-directions/` — parent: floor vs kind facet
- `.planning/sketches/095-cellar-merged/` — those two merged
- `06-pages/wines.md` § Design used — the shipped stand
- `06-pages/DESIGN-FOUNDATION.md` § `/cellar` — "see everything" and the house's own record
- ADR 0080 (zones are not invented), ADR 0108 (a register is this house's books first)
