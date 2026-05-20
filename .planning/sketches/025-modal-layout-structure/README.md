---
sketch: "025"
name: modal-layout-structure
question: "How should the StorageLocationManager modal divide its space between location list, edit form, and wine assignment?"
winner: null
tags: [storage, modal, layout, wine-assignment, split-pane, tabs]
---

# Sketch 025: Modal Layout Structure

## Design Question
The existing modal uses a 50/50 split (list left, form right) which works at rest but gets crowded once wine assignment is open. Which layout structure gives each panel the room it needs without the modal feeling too wide?

## How to View
```
open .planning/sketches/025-modal-layout-structure/index.html
```

## Variants
- **A: 3-Column (960px)** — Dedicated third panel (260px) for wine assignment alongside the location list (220px) and form. All three panels are always visible; wine panel has Assigned/Add tabs. Nothing collapses.
- **B: Wider 2-Panel with Tabs (860px)** — Keeps the 2-panel structure but adds a tab bar to the right panel: "Details" (form) and "Wines (41)". Switching tabs replaces the form with the wine manager. Familiar and low-width.
- **C: Side-by-Side Independent Cards** — Two rounded cards sit next to each other instead of one unified modal chrome. Location list is a standalone card; detail/wine card has a split layout — form on top half, wine list on bottom half.

## What to Look For
- Does A's 3-column feel premium or cramped at 960px wide?
- Does B's tab switching lose context — will users forget they need to save the form before switching to Wines?
- Does C's two-card feel sufficiently "modal" or does it drift toward a full-page layout?
- Which layout best survives when the location list is very short (1–2 locations) vs. very long (20+)?
