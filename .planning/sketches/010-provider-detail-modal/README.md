---
sketch: 010
name: provider-detail-modal
question: "What's the right modal anatomy — sheet, drawer, or bottom sheet?"
winner: "A"
tags: [providers, modal, detail, ux, interaction]
---

# Sketch 010: Provider Detail Modal

## Design Question
What container pattern works best for provider details? The modal needs to: (1) make Call/Email/Website immediately obvious; (2) show rich detail (portfolio, regions, contacts); (3) allow Edit/Remove without too many clicks.

## How to View
```
open .planning/sketches/010-provider-detail-modal/index.html
```

## Variants

- **A: Centered Sheet** — Classic centered modal with backdrop blur. Header contains vendor name + type + rating + icon action buttons (♥ ✏️ 🗑️). Below header: prominent CTA row (green Call button with phone number, blue Email, ghost Website). Scrollable body for details.
- **B: Right Drawer** — Slides in from the right edge. Page content stays partially visible on the left — good for "keep browsing while reading details." Compact header; smaller CTA buttons.
- **C: Bottom Sheet (2-col)** — Slides up from bottom. Two-column layout: left column has large stacked action buttons + key info; right column has full portfolio text + regions. More spacious but takes 90% viewport height.

## What to Look For
- Does A's prominent green "Call +1 (305) 555-0191" button feel right, or is the phone number too much info at the top?
- Does B's drawer feel natural for a desktop app? Does the partial page visibility add value or distraction?
- In C, does the two-column layout feel premium or overengineered for this use case?
- Press Escape or click the backdrop to close in any variant.
