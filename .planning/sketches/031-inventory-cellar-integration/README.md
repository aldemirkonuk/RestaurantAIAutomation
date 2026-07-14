---
sketch: 031
name: inventory-cellar-integration
question: "How does Sketch 028 (Living Cellar) integrate into the real /inventory page as a first-class view?"
winner: null
tags: [inventory, integration, living-cellar, spatial, digital-twin, view-mode, production]
---

# Sketch 031: Living Cellar → Real /inventory Page

## Design Question
How does the isometric Living Cellar become a native view mode on the **actual** Inventory page — alongside All/Live/Shadow tabs, Insights panel, and toolbar?

## How to View
```bash
open .planning/sketches/031-inventory-cellar-integration/index.html
```

## Variants
- **A · Cellar Tab** — New "Cellar Map" view tab replaces table with front-facing rack wall
- **B · Insights Upgrade** — Insights panel hosts a compact rack wall; table stays primary
- **C · Synthesis ★** — Cellar Map tab + location-filtered map + lot detail drawer + overlay toggles

## v2 change (orientation fix)
Replaced sideways isometric (`rotateZ(-42deg)`) with a **front-facing rack wall**:
- Racks **A → B → C** read top to bottom
- Slots **1 → 5** read left to right
- Bottle tiles with fill level, neck cap, and shelf shadow — no CSS 3D rotation

## What to Look For
- Is switching between table and cellar natural?
- Do storage location chips in Insights still make sense?
- Does the cellar feel embedded, not bolted on?
- Can you read rack/slot labels without tilting your head?
