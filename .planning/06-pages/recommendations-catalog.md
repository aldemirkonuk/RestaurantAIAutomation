---
type: page
route: /recommendations/catalog
slug: recommendations-catalog
component: apps/web/src/pages/InsightCatalog.tsx
audience: owner
tier: plus
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]"]
---

# /recommendations/catalog — Insight Catalog

## 1. Purpose

"'Browse all 375 insight types' explorer" (`InsightCatalog.tsx:1-2`): full-screen
dimension × measure × comparator grid with per-cell detail (description,
requirements, example), readiness/blocked states with what's-missing, fuzzy search,
category filter, coverage meter, `?type=` deep links, and JSON/CSV export (UX paths
NEW-707…NEW-727, header comment :4-11).

## 2. Entry

- From `/recommendations` (`Recommendations.tsx:560`;
  [PAGE_MAP](../foundation/PAGE_MAP.md):88).
- Command palette ×2 (`components/command/commands.ts:78,99`).
- Contextual-insight "browse" links on Orders/Inventory
  (`components/insights/ContextualInsights.tsx:244`) and Reports' seating panel
  (`components/reports/organisms/SeatingDensityPanel.tsx:571,604`).
- Self-produced share links `…?type=<key>` (`InsightCatalog.tsx:187`).

## 3. Files

- Route binding: `apps/web/src/App.tsx:263` (lazy import :86).
- `apps/web/src/pages/InsightCatalog.tsx` (544 lines) — self-contained
  (Header, Breadcrumbs, ExportMenu are the only shared renders, :26-31).

## 4. Endpoints

One call. Atlas row: [ENDPOINTS](../foundation/ENDPOINTS.md):10 (`analytics` —
**⚠ unguarded**).

| Method | Path | Call site |
|---|---|---|
| GET | `/analytics/insight-catalog/types` | raw fetch, `InsightCatalog.tsx:102` (`API_URL` const :34) |

## 5. Signals

**None.** No tracking, no `data-ux-key`; reporter dark (`lib/uxSignals.ts:15`).

## 6. Tier cut

**Plus** — a browsing surface over the insight space; readiness display is the
per-restaurant reachability discipline OD-33 demands. Scenario: S15's denominator
problem lives here ([TIER-MAP](../03-scenarios/TIER-MAP.md):51,108-111).

## 7. Rebrand surface

**0 user-visible strings** (no `wineops` hits). Layout chrome per dashboard.md §7.

## 8. State & config

- `?type=` and `?dim=` URL params drive selection (deep links produced at :187 and
  by ContextualInsights/SeatingDensityPanel).
- No flags or env gates beyond `VITE_API_GATEWAY_URL`.

## 9. Gaps

- **The headline number is the wrong one.** The page brands itself "375 insight
  types" while the enumerated space is **573** and only ~144 are satisfiable without
  POS — the exact labelling failure [TIER-MAP](../03-scenarios/TIER-MAP.md):108-111
  forbids: "Never headline a catalogue total … show the
  reachable-for-this-restaurant count (OD-33)". The palette entries repeat the 375
  (`components/command/commands.ts:78,99`).
- Endpoint unguarded ([ENDPOINTS](../foundation/ENDPOINTS.md):10).
