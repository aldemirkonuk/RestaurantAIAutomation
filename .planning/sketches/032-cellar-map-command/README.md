---
sketch: 032
name: cellar-map-command
question: "Can the cellar map be an all-in-one command surface — spatial zones, at-a-glance thresholds, and a rich bin sidebar with sales heatmap, order history, and one-tap reorder?"
winner: null
tags: [inventory, cellar, map, command, threshold, heatmap, reorder, sidebar, all-in-one, production]
---

# Sketch 032: Cellar Map Command

## Design Question
How does the cellar map become a **super-efficient, all-in-one command surface** — where the map itself shows threshold health at a glance, zones have real spatial identity (not "A/B/C top to bottom"), and clicking a bin opens a sidebar that does everything: lot detail, **hours-sold heatmap (past week)**, **previous orders**, a **better threshold gauge**, and **one-tap reorder** at the bottom?

## How to View
```bash
open .planning/sketches/032-cellar-map-command/index.html
```

## What's new vs. 031
- **Named spatial zones** instead of A/B/C rows — each rack is a titled station (Aging Wall, Service Bay, Reserve Nook) with its own accent, capacity ring, and temperature badge, laid out like a floor plan.
- **Threshold-on-the-map** — every bin carries a colored status strip (critical / low / healthy / overstock) so you read stock health without opening anything.
- **All-in-one sidebar** (on bin click):
  - Threshold gauge — segmented Min → Par → Max bar with a live level marker.
  - Hours-sold heatmap — 7 days × dayparts grid showing when this wine actually sells.
  - Previous orders — recent POs (date, vendor, qty, cost, status).
  - Lots / FEFO + multi-location (kept from 031).
  - **Sticky reorder footer** — suggested qty stepper + "Create Reorder", always in reach.

## Variants
- **A · Zone Floor Plan ★** — Named zone stations + threshold strips + full command sidebar
- **B · Density Map** — Compact heat-first grid for large cellars (100+ bins), same sidebar
- **C · Split Command** — Map left, persistent sidebar right (no overlay) for desk/back-office use

## What to Look For
- Do named zones read better than "A/B/C top to bottom"?
- Can you triage low stock from the map alone (threshold strips)?
- Is the sidebar genuinely all-in-one, or overloaded?
- Is reorder reachable without hunting?
