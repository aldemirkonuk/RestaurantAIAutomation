---
sketch: 009
name: provider-card-design
question: "How much should a provider card surface at rest — actions, info, or relationship status?"
winner: "A"
tags: [providers, card, grid, actions, ux]
---

# Sketch 009: Provider Card Design

## Design Question
What's the right information hierarchy for a provider card at rest? The card needs to serve two use cases: (1) quickly act on a vendor — call, email, open website; (2) evaluate a vendor — portfolio quality, last order, rating. Which should lead?

## How to View
```
open .planning/sketches/009-provider-card-design/index.html
```

## Variants

- **A: Action-First** — Contact buttons (Call / Email / Web) are always visible below portfolio text. Stars at the top. Fastest path to action from the grid.
- **B: Info-First** — Portfolio text is the dominant element (3 lines visible). Contact actions are hidden until hover — reveals smoothly. Focuses attention on evaluating the vendor.
- **C: Relationship-Status** — Last order date, order history count, and a health bar lead the card. Status pill (Active / No orders). Good for operators managing an existing supplier roster.

## What to Look For
- In A: do the action buttons feel cluttered when scanning 9–12 cards at once?
- In B: is the hover-reveal for actions discoverable? Does hiding them feel too clever?
- In C: is the "relationship health" concept valuable or confusing without explanation?
- Which variant makes you *want* to click a card vs. feeling like there's too much to parse?
