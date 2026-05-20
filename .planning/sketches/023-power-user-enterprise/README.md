---
sketch: "023"
name: power-user-enterprise
question: "How do power users (managers, sommeliers) efficiently manage 10–20+ locations with bulk ops?"
winner: null
tags: [storage, enterprise, bulk, table, tree, kanban, power-user]
---

# Sketch 023: Power User Enterprise View

## Design Question
When a restaurant has 12 storage zones across multiple floors, sorting, filtering, bulk-moving, and hierarchical organization become critical. Which paradigm handles scale best?

## How to View
```
open .planning/sketches/023-power-user-enterprise/index.html
```

## Variants
- **A: Dense Table** — Sortable table with all locations as rows. Checkboxes for bulk select. Keyboard shortcuts displayed. Inline mini fill bars. Bulk action bar on multi-select. Summary/totals row.
- **B: Zone Tree** — Left sidebar tree with collapsible zones > sections > shelves. Detail panel on right shows section wines. Supports deep hierarchical organization (Zone → Section → Shelf → Position).
- **C: Kanban Zones** — Each location is a column. Wine cards are draggable between columns to move them. Overflow column shows alert card with Auto-Locate CTA.

## What to Look For
- Does A's table feel powerful or clinical? Does showing mini-bars in cells work?
- Does B's tree map to how restaurants physically think about their cellar layout?
- Does C's kanban drag-to-move feel intuitive for wine movement, or is it too abstract?
- Which handles the "quickly move 10 bottles from Overflow to Main Cellar" task best?
- Which scales to 20+ locations without feeling overwhelming?
