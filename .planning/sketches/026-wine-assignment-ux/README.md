---
sketch: "026"
name: wine-assignment-ux
question: "How should wine assignment (view assigned, search, add, remove) work inside the StorageLocationManager modal without crowding the location form?"
winner: null
tags: [storage, modal, wine-assignment, drawer, inline, accordion, ux]
---

# Sketch 026: Wine Assignment UX

## Design Question
The existing modal stacks the wine section below the form fields in the right panel — it works but feels dense. Given that wine assignment is the most-used action after creating a location, it deserves more UX thought. Which pattern gives wine assignment the right amount of prominence without swamping the form?

## How to View
```
open .planning/sketches/026-wine-assignment-ux/index.html
```

## Variants
- **A: Inline Tabs in Form Panel** — Wine assignment lives at the bottom of the right panel, separated by a rule. Two tabs: "Assigned (41)" shows chips with remove buttons; "Add from Inventory" shows a search field + scrollable results. Capacity warning appears inline above tabs. Location cards show a wine peek (first 2 assigned wines).
- **B: Slide-in Wine Drawer** — The form panel shows a "Manage Wines →" button where the wine section used to be. Clicking it slides in a 300px drawer from the right edge of the modal. The drawer has its own Assigned/Add tabs and a close handle. The form remains accessible behind the drawer.
- **C: Expand-in-Card** — Wine assignment belongs to the expanded location card on the left, not the form. When you expand a card, it grows to reveal assigned wines inline with a quick-assign autocomplete at the bottom. Moving a wine is a "Move" button that opens a mini location picker. The right form panel is clean with just the fields plus a help tip.

## What to Look For
- Does A feel too tall when many wines are assigned, forcing a scroll-within-scroll?
- Does B's drawer feel discoverable — will users find the "Manage Wines" button without prompting?
- Does C blur the boundary between "browsing locations" (left) and "editing" (right)?
- Which pattern makes it fastest to: (1) see what's in a location, (2) add a wine, (3) remove a wine?
