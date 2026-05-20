---
sketch: "020"
name: storage-location-layout
question: "What overall layout philosophy feels right — card grid, list+detail, or dashboard-first?"
winner: null
tags: [storage, layout, grid, list-detail, dashboard]
---

# Sketch 020: Storage Location — Layout Philosophy

## Design Question
Three fundamentally different ways to organize the Storage Locations page. Which one fits how restaurant teams actually think about their cellar?

## How to View
```
open .planning/sketches/020-storage-location-layout/index.html
```

## Variants
- **A: Card Grid** — Visual cards in a responsive grid. Each card shows fill bar, temp, humidity, quick actions. Scales from 2 to 20+ locations naturally. Stats bar across the top.
- **B: List + Detail** — Left sidebar lists all locations compactly. Clicking one opens a full detail panel with wine table, capacity blocks, and action buttons. Zero scrolling.
- **C: Dashboard First** — Hero stats block at top (total bottles, utilization %, alerts). Compact location cards below. Strong top-to-bottom hierarchy.

## What to Look For
- Does A feel too card-heavy for large restaurants with 15+ locations?
- Does B's split-pane feel right for a desktop-primary experience, or too rigid?
- Does C's "status first" approach match how managers actually open this page?
- Which layout makes an alert (overflow, near-full) most visible without being noisy?
