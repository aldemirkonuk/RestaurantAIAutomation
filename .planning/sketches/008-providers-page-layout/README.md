---
sketch: 008
name: providers-page-layout
question: "How should the overall page hierarchy and layout feel for the Providers page?"
winner: "A"
tags: [providers, layout, toolbar, grid, filters]
---

# Sketch 008: Providers Page Layout

## Design Question
How should the overall page hierarchy feel? Specifically: does organizing providers by type add value, or does a flat filtered grid work better? Does a sidebar for filters feel more powerful, or does it add complexity?

## How to View
```
open .planning/sketches/008-providers-page-layout/index.html
```

## Variants

- **A: Editorial Grid** — Two-row toolbar (search + filters), horizontal "Pinned" favorites strip, flat 3-col card grid. Clean, content-forward. Matches the Providers.tsx we built.
- **B: Type-Organized** — Grouped sections (Distributors / Importers / Wholesalers) with colored section banners. No type filter chips — browsing is structural. Feels more like a curated directory.
- **C: Split-Panel** — Fixed left sidebar with type, rating, and view filters; stats row at top of main area; 4-col compact grid. Most powerful but most complex.

## What to Look For
- Does the pinned strip in A feel useful or redundant given favorites are already sorted to the top of the grid?
- Does B's type-organized layout make it easier to browse, or does it fragment the view when you're searching?
- Does C's sidebar feel like a productivity upgrade or like unnecessary complexity for ~50 vendors?
- Compare information density: how many vendors can you evaluate at a glance in each variant?
