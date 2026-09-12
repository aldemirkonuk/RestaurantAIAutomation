---
type: page
route: /reports
slug: reports
softwares: [reports-analytics]
component: apps/web/src/pages/Reports.tsx
audience: owner
tier: plus
archetype: canvas # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 2
maturity: hollow
status: documented
updated: 2026-09-03
links: ["[[PAGE-CONTRACT]]", "[[settings]]", "[[orders]]", "[[inventory]]", "[[team]]", "[[promotions]]", "[[recommendations]]", "[[recommendations-catalog]]"]
---

# /reports — Reports

> **Part of** [[08-softwares/reports-analytics|Reports & Analytics]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

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

## 1a. Features
- Notion-style dashboard canvas: drag/resize blocks with inline configuration; your layout persists per user
- KPI spotlight and headline insights bar
- Engine insights panel (analytics-engine output) with act / hide / pin and goals
- Seating density panel; monthly reconciliation; period compare
- Data tables section; AI command palette
- Generate and export a report (lands in the `/documents-reports` archive)

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
[ENDPOINTS](../foundation/ENDPOINTS.md):10 (`analytics`, 39 — atlas's **⚠ all unguarded**
is stale; guarded at class level since 2026-08-24 (#31),
`apps/api-gateway/src/analytics/analytics.controller.ts:51`),
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

- The 39 analytics endpoints behind every number on this page are guarded since
  2026-08-24 (#31) — `@UseGuards(JwtAuthGuard)` at class level
  (`apps/api-gateway/src/analytics/analytics.controller.ts:51`); the atlas row
  ([ENDPOINTS](../foundation/ENDPOINTS.md):10 — "classify these") is stale.
- `Reports.v1.backup.tsx` is registered dead code (`v3.0-TECH-DEBT.md:257`).
- Analytics truth-suite work is carried-forward unbuilt scope
  (`v3.0-TECH-DEBT.md:322-324`, was Phase 41).

- **Lens run 2026-09-03 (`v3.0-TECH-DEBT.md`, POS lens; `03-scenarios/S04` §9.1):** the page says "Sales revenue needs a connected POS and is not shown here" over 44 ingested `pos_checks`, 34 depleted bottles and 55 consumption rows — honest about the gap, wrong about the cause (the checks carry no money; defect 9) — and each "— —" KPI carries a green "↗ 0% vs prev period". Three fabrications remain in the molecules: `PeriodCompareBar.tsx:21-25` (last period = 75–120 % of this one), `BusyHoursHeatmap.tsx:23` (static weights × `Math.random()`, never reads `pos_checks`), `MonthlyReconciliation.tsx:28-33` (invented purchased/variance) — absence 2–4.

- **Intelligence lens 2026-09-03 (`v3.0-TECH-DEBT.md`, customer + intelligence lens):** the Purchased Wines badge shows "30 orders" over 0 `procurement_orders` — `Reports.tsx:391` counts `purchaseData.length`, one row per day of the 30D window (`:351`), rendered at `PurchasedWinesTable.tsx:52` (defect 2). The page says "no sales data" at the top and shows $2,236 of real sales in Wine Consumption Analytics below, without saying the two read different tables.

## 10. Maturity

**hollow** — and this is the worst finding in the communication/config cluster.

The analytics engine behind most of this page is real (memory: analytics-engine; 87
tests; `EngineInsightsPanel` reads live `/analytics/insights/:rid`). Two blocks
mounted alongside it are not, and neither announces itself:

| Block | Line | What it does |
|---|---|---|
| **AI Command Palette** (⌘K, mounted `Reports.tsx:950`) | `components/reports/organisms/AICommandPalette.tsx:59` calls `generateMockAnswer(text, timeRange)`, defined `:212-231` | Returns **hand-written fake analysis with invented numbers**, keyed off substrings of the question. Ask about Tuesday and it replies "Tuesday's revenue was ~18% below weekly average… fewer covers during the 7–9 PM window". Ask about stock: "Barolo, Sangiovese will hit the reorder threshold in ~6 days". Ask about margin: "Prosecco (+72%), house Pinot Noir (+64%)". None of it touches the restaurant's data. The only marker is a source comment, `:210` |
| **Report Generator** | `Reports.tsx:759-766` | `onGenerate={(templateId, options) => { console.log('Generating report:', templateId, options) }}` — the handler is a `console.log`. No request, no row, no toast |

The placeholder-metrics banner (`Reports.tsx:790-808`) is the honest counter-example:
when `totalRevenue === 0 && totalOrders === 0` it says so in words and links to
`/settings?tab=pos`. It is the model the two blocks above should follow.

Also confirmed on this page: the guard fix §9 records is real —
`analytics.controller.ts:51` carries class-level `@UseGuards(JwtAuthGuard)`, so the
atlas's "all unguarded" row is stale. `Reports.v1.backup.tsx` still ships
(`v3.0-TECH-DEBT.md:257`).

- **Lens run 2026-09-03 (`v3.0-TECH-DEBT.md`, POS lens; `03-scenarios/S04` §9.1):** still hollow in the only sense that matters: with a real night of checks on the tenant, no revenue, busy-hour or reconciliation figure on this page is derived from them.

- **Intelligence lens 2026-09-03 (`v3.0-TECH-DEBT.md`, customer + intelligence lens):** Wine Consumption Analytics is exact to the dollar against `wine_consumption_log` (15 bottles $1,348 + 41 glasses $888 = $2,236) — the one sales figure on the page, and it is not a headline.

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/analytics/insights/:rid` (+`?refresh=true`) | JWT (class, `analytics/analytics.controller.ts:51`) | same file | Generated insights (347-type generator) |
| GET/POST | `/analytics/goals/:rid` | JWT | `analytics.controller.ts` | Goals + progress |
| GET/POST | `/analytics/recommendations/:rid/actions`, `…/action` | JWT | `analytics.controller.ts` | Server-side hide/pin disposition |
| GET | `/analytics/table-performance/:rid` | JWT | `analytics.controller.ts` | Seating density |
| GET/PATCH | `/users/:userId/preferences` | JWT | `user-preferences` module | Canvas layout + block set |
| GET | `/inventory/:rid` family | JWT | `inventory` module | Stock for the inventory blocks |
| GET | `/procurement/orders` | JWT | `procurement.controller.ts` | Order metrics |
| GET | `/wines?ids=` | JWT | `wines` module | Names for ids |
| — | **AI Command Palette** | — | **none** | No request is made (`AICommandPalette.tsx:59`) |
| — | **Report Generator** | — | **none** | `console.log` (`Reports.tsx:761`) |

All analytics calls are raw `fetch` against `VITE_API_GATEWAY_URL`
(`EngineInsightsPanel.tsx:27,147`), not `apiClient`.

### Fed by

| Data | Producer | Live? |
|---|---|---|
| Insights | `@Cron(EVERY_HOUR)` insight scheduler (`analytics/insights/insight-scheduler.service.ts:42`) + on-demand `?refresh=true` | Yes |
| POS-dependent depth | Toast/SimPOS ingestion → `pos_checks` (memory: pos-bridge-state — bridge proven, 1.4%→67.4% of insights) | Yes where a POS is connected; 429/573 insight types need `checks` (TIER-MAP:91-93) |
| Layout | This page's own preference writes | Yes |
| Command-palette answers | **none — fabricated in the browser** | No |
| Generated reports | **none** — and the generator here does not even attempt one. ~~the only `generated_reports` writer is `/communications`~~ → as of 2026-08-26 (OD-81) `/communications` no longer calls it either: the "Generate Now" handler was deleted for claiming success it did not have. `POST /reports/generate` remains the table's only writer in the repo, with **no caller in the product**. Scoping for a real generator: [[OD-81-REPORT-GENERATOR-SCOPING]] | No |

### Writes

| Write | Downstream reaction |
|---|---|
| `PATCH /users/:id/preferences` | Canvas layout persists per user across devices (`Reports.tsx:187,466`) |
| `POST /analytics/recommendations/:rid/action` | Manager disposition (hide/pin) persists server-side and suppresses the insight for everyone (`EngineInsightsPanel.tsx:163-170,281,309`) |
| `POST /analytics/goals/:rid` | Goal appears in the goals block and in insight generation |
| Command palette / report generator | **none** |

## 12. Design intent

**Should be:** the understand layer — what happened, why, and the one thing to do
about it, with a visible line back to the data.

| State | Handled? | Evidence |
|---|---|---|
| Loading | Yes | Full-page spinner `Reports.tsx:774-784` |
| Empty | **Yes, and well** | The POS banner names the condition instead of drawing zeros (`:790-808`) |
| Error | Partial | Panels degrade to empty; no page-level error surface |
| Permission-denied | **No** | No 403 branch; guarded server-side since #31 |

**Where the UI misleads**

1. The palette is the sharpest case of fabrication in the product: plausible,
   specific, numeric advice about a restaurant whose data it never read. A ⌘K pill
   invites exactly the trusting use it cannot support.
2. "Generate" in the report-generator block gives no error and no result.
3. Export filename/title still say WineOps (`Reports.tsx:530-531`, §7).

## 13. Roadmap

1. **Disable the AI Command Palette until it queries the engine.** Deleting
   `generateMockAnswer` (`AICommandPalette.tsx:212-231`) and showing "not yet
   available" is strictly better than shipping it. Do this before anything else on
   this page — it is a correctness and trust defect, not a gap.
2. **Wire or remove the report generator** (`Reports.tsx:759-766`). Blocked on the
   same missing report-artifact decision as communications.md item 1.
3. Then wire the palette for real against `/analytics/insights/:rid` — the engine
   already produces template sentences (memory: analytics-engine).
4. Page-level error surface for the analytics fetches.
5. Delete `pages/Reports.v1.backup.tsx` (`v3.0-TECH-DEBT.md:257`).
6. Analytics truth suite — carried-forward unbuilt scope (`v3.0-TECH-DEBT.md:322-324`).
7. Rebrand export artifacts (§7).
