---
sketch: 030
name: inventory-honest-integration
question: "How does Sketch 027 (Honest Inventory) integrate into the real /inventory page?"
winner: null
tags: [inventory, integration, trust, valuation, ledger, explain, status, production]
---

# Sketch 030: Honest Inventory → Real /inventory Page

## Design Question
How do the 027 trust concepts — cost-based valuation, value truth-toggle, "explain this number" ledger drawer, unified status, trust badges, unknown-vs-zero — land on the **actual** Inventory page chrome (6 stat cards, Insights panel, All/Live/Shadow tabs, real toolbar, wide table)?

## How to View
```bash
open .planning/sketches/030-inventory-honest-integration/index.html
```

## Variants
- **A · Minimal Retrofit** — Value truth-toggle in header, Total Value stat + column become cost-based with basis labels, ledger-in-sync chip. Everything else untouched.
- **B · Explain-First** — Every money number is clickable → ledger drawer; trust badge column; Health score NaN-guarded; unknown stock shown as "unknown" not 0.
- **C · Synthesis ★** — Full retrofit: truth-toggle + cost-based values + trust column + explain drawer + unified status + honest empty/unknown states, all on the real page.

## What to Look For
- Does the truth-toggle feel native to the existing header/stat row?
- Is the cost-vs-retail distinction unmistakable at a glance?
- Does "Explain" turn a suspicious number into a defensible one?
- Do trust badges and unified status fit the real table without crowding it?

## Audit Grounding
Implements 027 (menu-price valuation fix, ledger explainability, single status source, unknown≠zero) inside the production page layout from `apps/web/src/pages/Inventory.tsx`.
