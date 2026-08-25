---
type: page
route: /reports
slug: reports
component: apps/web/src/pages/Reports.tsx
audience: owner
tier: plus
signals_today: none
rebrand_strings: 2
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[settings]]", "[[orders]]", "[[inventory]]", "[[team]]", "[[promotions]]", "[[recommendations]]", "[[recommendations-catalog]]"]
---

# /reports — Reports

## Surface — buttons → where they go

- **Configure POS** (placeholder-data banner) → [[settings]] `/settings?tab=pos`
- **Act on engine insight** → by category: [[orders]], [[inventory]], [[team]], [[promotions]], or stays here (sales/efficiency/tables/goals); fallback [[recommendations]]
- **Browse table insight types** (seating panel menu) → [[recommendations-catalog]] `/recommendations/catalog?dim=table`
- **Open in Inventory** (zone menu) → [[inventory]] `/inventory`

## 1. Purpose

"Refactored with Notion-style DashboardCanvas. Uses react-grid-layout for
drag/resize blocks with inline configuration" (`Reports.tsx:1-4`). The understand
layer in one page: KPI spotlight, headline insights bar, the analytics-engine
insights panel (347-type generator output with act/hide/pin), seating density,
monthly reconciliation, period compare, report generator, and per-user layout
persistence.

## 2. Entry

In-degree 2 ([PAGE_MAP](../foundation/PAGE_MAP.md):144): from `/` (:64) and
`/recommendations` (:89). Sidebar "Reports" (`components/layout/Sidebar.tsx:99`).

## 3. Files

- Route binding: `apps/web/src/App.tsx:261` (lazy import :84).
- `apps/web/src/pages/Reports.tsx` (966 lines).
- Organisms: `components/reports/organisms/{TopBar, HeadlineInsightsBar, EngineInsightsPanel, SeatingDensityPanel, DataTablesSection, AICommandPalette, MonthlyReconciliation}.tsx`; canvas: `components/reports/{DashboardCanvas, EditToolbar, dashboardMeta, dashboardTypes}.tsx`; molecules incl. `KPISpotlightView` (Reports.tsx:23-52).
- Dead sibling: `pages/Reports.v1.backup.tsx` ships in the bundle (`v3.0-TECH-DEBT.md:257`).

## 4. Endpoints

The widest analytics consumer among the 17 core-ops pages. Atlas rows:
[ENDPOINTS](../foundation/ENDPOINTS.md):10 (`analytics`, 39 — **⚠ all unguarded**),
:618 (`user-preferences`), :249 (`inventory`), :389 (`procurement`), :663 (`wines`).

| Method | Path | Call site |
|---|---|---|
| GET | `/analytics/insights/:rid` (+ `?refresh=true`) | `EngineInsightsPanel.tsx:155,234` |
| GET/POST | `/analytics/goals/:rid` | `EngineInsightsPanel.tsx:158,251` |
| GET/POST | `/analytics/recommendations/:rid/actions`, `…/action` | `EngineInsightsPanel.tsx:159,281,309` (hide/pin disposition) |
| GET | `/analytics/table-performance/:rid` | `SeatingDensityPanel.tsx:120` |
| GET/PATCH | `/users/:userId/preferences` | layout + block persistence, `Reports.tsx:187,466` → `hooks/useUserPreferences.ts:73,83` |
| GET | `/inventory/:rid` family | `useInventoryData` (Reports.tsx:11) → `services/api/inventory.ts:66,118,129` |
| GET | `/procurement/orders` | `useOrdersMetrics` (Reports.tsx:12) → `services/api/orders.ts:53` |
| GET | `/wines?ids=` | `useWinesByIds` (Reports.tsx:13) → `services/api/wines.ts:58` |

All analytics calls are raw `fetch` against `VITE_API_GATEWAY_URL`
(`EngineInsightsPanel.tsx:27,147`), not `apiClient`.

## 5. Signals

**None.** No tracking, no `data-ux-key`; reporter dark (`lib/uxSignals.ts:15`).

## 6. Tier cut

**Plus** — understand ([TIER-MAP](../03-scenarios/TIER-MAP.md):10). Scenario
surface: S15 (this page renders what is reachable for this restaurant), S08 Plus
drift chips, S02/S03 Plus scorecards, S10 Plus days-of-cover. Pro depth (forecasting,
`tables`, `efficiency`) is POS-gated: 429/573 insight types need `checks`
(TIER-MAP:91-93).

## 7. Rebrand surface

**2 user-visible strings** in export artifacts: filename prefix `wineops-report-…`
(`Reports.tsx:530`) and document title "WineOps AI Report · <range>"
(`Reports.tsx:531`). Layout chrome per dashboard.md §7.

## 8. State & config

- Per-user layout/blocks persist via the preferences API (`Reports.tsx:195,206,466`).
- Insight visibility is a server-side manager disposition (hidden/pinned via
  recommendation actions, `EngineInsightsPanel.tsx:163-170`), not local state.
- No feature flags read client-side; POS-connectedness changes what the engine
  returns, not what the page requests.

## 9. Gaps

- 39 unguarded analytics endpoints serve every number on this page
  ([ENDPOINTS](../foundation/ENDPOINTS.md):10 — "classify these").
- `Reports.v1.backup.tsx` is registered dead code (`v3.0-TECH-DEBT.md:257`).
- Analytics truth-suite work is carried-forward unbuilt scope
  (`v3.0-TECH-DEBT.md:322-324`, was Phase 41).
