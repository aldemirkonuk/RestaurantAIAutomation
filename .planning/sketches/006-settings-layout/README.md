---
sketch: 006
name: settings-layout
question: "Single scroll vs. sticky left rail vs. top tabs — which structure reduces cognitive load?"
winner: null
tags: [settings, layout, navigation, feature-flags]
---

# Sketch 006: Settings Layout

## Design Question
The Settings page has 4 sections (Team, Locations, Measurement, 22 Feature Flags). How do we structure them so a user can find what they need without feeling overwhelmed?

## How to View
```
open .planning/sketches/006-settings-layout/index.html
```

## Variants
- **A: Single Column** — Everything stacks vertically in one scroll. Simple, no learning curve. Works perfectly for casual users. The search bar makes the 22 flags navigable.
- **B: Left Rail** — Sticky sidebar nav with section anchors. Power-user layout. Great for owners who visit Settings often and know what they want. Section labels in the rail give a mental map.
- **C: Top Tabs** — One section per tab, complete isolation. Least overwhelming per-tab, but hides other sections from casual discovery.

## What to Look For
- Does the single-column feel too long or just right?
- Does the left rail feel like overkill for a settings page, or like a genuine UX upgrade?
- Does tab isolation help focus or hide features that users would want to discover?
- Feature flag search — does it make the 22-toggle list feel manageable in Variant A?
- Try the ⋯ menu on the Joe's Bistro chain header (Variant A shows it open by default)
