---
sketch: 007
name: locations-chains
question: "How do chains and locations nest visually without feeling bureaucratic?"
winner: null
tags: [locations, chains, crud, settings, interactive]
---

# Sketch 007: Locations & Chains

## Design Question
Restaurant owners may have 1 chain with 3 locations, or 3 chains with 1 location each, or just standalone locations. The component must show hierarchy clearly without feeling like an org chart.

## How to View
```
open .planning/sketches/007-locations-chains/index.html
```

## Variants
- **A: Nested Rows** — Single card, chain header rows + indented locations below. Classic B2B pattern (Stripe, Linear). The ⋯ menu is **fully interactive** — click it on Joe's Bistro to see Rename + Delete. Clicking a location opens the full edit dialog with visual chain radio cards.
- **B: Chain Buckets** — Each chain is its own card. More spatial, clearly separated. The standalone "dashed" card visually distinguishes unassigned locations.
- **C: Tree View** — Dot-and-line connectors show parent-child clearly. Elegant, minimal. Best when chains have many locations. Empty chains show an inline "Add one" CTA.

## What to Look For
- Does Variant A feel too dense when there are 4+ chains?
- Do the chain "buckets" in Variant B feel wasteful of vertical space?
- Does the tree connector in Variant C feel too technical for restaurant managers?
- In Variant A: does the rename-inline UX (chain header becomes an input) feel natural?
- In Variant A: does the "visual radio card" chain selector in the Edit dialog beat a plain select?
- How does the empty chain state read? ("No locations yet. Add one →")
