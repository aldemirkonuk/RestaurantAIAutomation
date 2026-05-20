---
sketch: "024"
name: new-features-integration
question: "How do new features (health monitoring, AI auto-locate, QR codes, quick-add) integrate without adding visual noise?"
winner: null
tags: [storage, ai, qr, health, auto-locate, quick-add, new-features]
---

# Sketch 024: New Features Integration

## Design Question
Each new feature (health dashboard, AI sidebar, QR/quick-add) is powerful on its own — the risk is that adding them turns a clean page into a cluttered one. Which integration strategy keeps the core UI clean while surfacing these features where they're needed?

## How to View
```
open .planning/sketches/024-new-features-integration/index.html
```

## Variants
- **A: Health Dashboard Sidebar** — Dark monitoring panel on the right shows real-time health KPIs, temperature status, active alerts, and trend sparklines on each card. Persistent but collapsible.
- **B: AI Auto-Locate Panel** — Right panel is the AI engine: shows analyzed assignments, checkboxes to select/deselect, manual override capability, and apply button. Cards show "good for X type" badges from AI analysis.
- **C: QR + Quick-Add Panel** — Three-tab right panel: QR Code generator (per location, with download/print), Quick Add form (wine name, quantity, location pills), and Activity feed. Cards have a visible QR button.

## What to Look For
- Does A's health sidebar feel like a control room or unnecessary clutter for a small restaurant?
- Does B's AI panel feel trustworthy and inspectable, or like a black box?
- Does C's tab system feel versatile or scattered? Would staff actually use all 3 tabs?
- Which panel earns its right-panel real estate for both small (2-person) and large (50+) restaurants?
- Is a persistent right panel the right pattern, or should these features live as modals/drawers?
