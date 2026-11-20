# /reports — software walk audit (2026-11-07)

Read from `origin/main` at e26a5152d. I only read code with `git show` and `git grep`. Nothing was rendered, built or run against production. Every `file:line` below is on origin/main. Paths are short forms of these:

- `web/` means `apps/web/src/`
- `next/` means `apps/web/src/pages/reports/next/`
- `gw/` means `apps/api-gateway/src/`

**Shortcuts taken (§0.5):**
- The bundle size was not measured, because no build was run.
- No chart was seen in a browser, so every render claim comes from reading code.
- The goals register (`next/rp-registers-goals.tsx`, about 900 lines) and AskTheBook were only skimmed.
- The tooltip-clipping finding (G16) is plausible, not observed.

---

## 1. What it is for, in the restaurant's words

> "Show me how the house is doing: what came through the till, what we spent with suppliers, which dishes and wines earn their place, how the week runs, what the next two weeks look like, and whether we are on pace for our goals. Let me lay the sheet out my way, and keep it that way."

The page is a **sheet of cuttings**. Each cutting is one register, which can be drawn as a line, bars, area, heatmap, scatter, table or a single figure.

- The owner chooses **Arrange the sheet**, drags and resizes the cuttings, then chooses **Rule it off**. That saves the layout under the account preference `reportsSheet` v3 (`next/useReportsNextData.ts:87`, `:324-329`).
- Under the sheet sit an exports shelf (CSV/PDF) and a goals desk.
- The planning doc `.planning/08-softwares/reports-analytics.md` calls this the "understand layer". It is dated 2026-09-01 and says no one owns it (§6).

## 2. Path map

### Screen and grid

| Layer | Where |
|---|---|
| Route | `web/App.tsx:440` `/reports` → `PageGate page="reports" next={<ReportsNext/>}` (lazy, `:96`) |
| Page | `next/ReportsNext.tsx`, 477 lines. Arrange draft `:157-173`, house layouts `:205-215`, move/remove/add/swap/graph `:217-264`, cuttings built `:317-335`, empty/no-house `:430-448`, ExportsShelf `:452-458`, AskTheBook `:474` |
| Grid | `next/Sheet.tsx`: `WidthProvider(Responsive)` `:61`, layouts `:88-97`, change handler `:99-107`, grid `:144-158`, items keyed `c.id` `:159-163` |
| Sheet model | `next/rp-sheet.ts`: 13 analysis ids `:18-32`, 7 graph types `:46-54`, default slots `:102-130`, row height 34 `:145`, minimum 3×3 `:155-156`, breakpoints/cols lg12/md12/sm6/xs4/xxs2 `:165-172`, `packSlots` `:222-240` |
| Keyboard arrange | `next/rp-arrange.ts` uses RGL `moveElement`/`compact`; `colsForWidth` at `:133-137` |
| Data hook | `next/useReportsNextData.ts`: decode/encode `:141-191`, prefs `:242-244`, active ids `:248-253`, role hold-back (ADR 0348) `:264-271`, `useQueries` (key `[ROOT,id,rid,window]`, stale 60 s, retry 1) `:273-287`, registers `:289-315`, `sheetKnown` `:348` |
| Cutting chrome | `next/Cutting.tsx`: till window picker 7/30/90 `:80-103`, `Drawing` switch `:107-137`, arrange controls `:249-310` |
| Plots | `next/rp-plot.tsx`, recharts `ResponsiveContainer` debounce 1 `:77-85`. Cat (line/area/bars + projected) `:268-387`, scatter `:395-446`, heat `<table>` `:462-514`, table `:517-549` |
| Format | `next/rp-format.ts`: `money()` → `web/lib/utils.ts:16-33` (`$`, en-US) `:32-35`; `failureOf` `:157-162` |

### Registers → endpoint → service → table

| Cutting | Register file | Endpoint (`gw/analytics/analytics.controller.ts`) | Service | Tables |
|---|---|---|---|---|
| reading | `rp-registers-trade.tsx:45-102` | `GET /analytics/insights/:rid?limit=40` `:433` → `readInsights` `:504-550` | `insights/insight-generator.service.ts:635-786` | `analytics_insights`. A cold start computes live. |
| till | `trade.tsx:139-276` | `GET /analytics/pos-revenue/:rid?days=` `:1183-1239` (1–365) | consumption breakdown | `pos_checks`, `wine_consumption_log` (whole-window reads) |
| pacing | `trade.tsx:290-371` | `GET /analytics/cashflow/:rid` `:1156` | `advanced-analytics.service.ts:672-728` | `procurement_orders` via `loadOrders` `:202-223` |
| week | `trade.tsx:385-483` | `GET /analytics/seasonality/:rid` `:1146` | `advanced…:572-666` | consumption, `restaurant_inventory` `:607-611` |
| ahead | `trade.tsx:499-595` | `GET /analytics/forecast/:rid?horizon=14` `:266` | forecast lens | consumption |
| quadrants | `rp-registers-house.tsx:39-44` | `GET /analytics/menu-engineering/:rid` `:1126` | advanced menu lens | consumption, inventory |
| ledger | `house.tsx:169-174` | `GET /analytics/financial/:rid` `:175` | `analytics.service.ts` (`loadDeliveredOrders` `:203-224`, `loadConsumption` `:226-254`, `loadInventory` `:127-201`) | `procurement_orders`, consumption, inventory, lots |
| seats | `house.tsx:333-340` | `GET /analytics/table-performance/:rid?sinceDays=90` `:723`, owner/manager | `table-analytics.service.ts:219-244` | `pos_checks` |
| service | `house.tsx:509-516` | `GET /analytics/waiters/:rid?sinceDays=90` `:747`, owner/manager | same | `pos_checks` |
| restock | `house.tsx:656-661` | `GET /analytics/inventory-science/:rid` `:207` | `analytics.service.ts` | inventory, consumption |
| bench | `rp-registers-bench.tsx:74-122` | `GET /analytics/overview/:rid` `:1241-1252` | `advanced…:824-869` (8 lenses, allSettled) | all of the above |
| goals | `rp-registers-goals.tsx:795-800` | `GET /analytics/goals/:rid/progress` `:937` | `goals.service.ts` (`procurement_orders` `:1008`, `pos_checks` `:1181`) | `goals`, orders, checks |
| writing | `house.tsx:769-774` | none (path null) | — | — |

**Other paths:**
- **Writes from the goals desk** (`next/useGoalsDesk.ts`): POST goals `:174`, PATCH `:190`, PUT status `:199`, POST cutting-spec `:221`, POST scenario request `:331`.
- **Exports** (`next/useReportExports.ts`): list `:131-141`, which polls while a job is queued. The routes are in `gw/reports/exports/report-exports.controller.ts` (owner/manager `:54-56`): POST `:69`, GET `:93`, GET `:117`, retry `:132`, download `:149`. A retention cron runs at `report-export-retention.cron.ts:45`.
- **Jobs:**
  - The insight scheduler runs an hourly cron (software doc §4, `insight-scheduler.service.ts:42`).
  - `reporting_agent` is dormant (same doc).
  - The legacy `gw/reports/reports.controller.ts:29-242` (generate, schedules, cross-file) is not called by this page.
- **Guards:** `JwtAuthGuard` is on the controller class (`:132`), and TenantGuard is a global APP_GUARD (`gw/app.module.ts:183-187`).

## 3. Performance today

- **Bundle weight: not measured.**
  - `vite.config.ts:48-49` splits out only `vendor: [react, react-dom, react-router-dom]`. Recharts (^2.10.3) and react-grid-layout (^2.2.2) therefore land in the route chunk or in a shared chunk, and no build was run to size them.
  - About 1,800 lines of dead legacy grid code in `web/components/reports/` are imported by nothing outside that folder (G23). Tree-shaking probably drops them, but this is unverified.
- **First paint waterfall:**
  1. JWT
  2. preferences (shown as `{}` placeholder data, so the default sheet fires at once, see G2)
  3. 9 parallel GETs for the default sheet, plus the exports list
  4. when preferences arrive and differ, a second set of GETs for any cuttings that only the saved sheet has
- **Server fan-out:**
  - The bench cutting's `/overview` re-runs financial, risk, inventory-science, menu, seasonality, cashflow, stored insights and active goals (`advanced…:824-869`). Five of those are already fetched by their own cuttings.
  - The tech-debt note estimates about **60 page requests** for the overview alone (`.planning/tech-debt.d/2026-10-03-fix-analytics-reads-past-row-cap.md:34`, marked "Not measured").
  - Nothing is shared between lenses, so each re-reads its own 90-day consumption window. That is an N+1 at the lens level.
- **Slow reads:**
  - `pos-revenue?days=365` is estimated at about 4 s in sequence (same note, `:33`).
  - `wine_consumption_log` is filtered on `created_at`, but its only window index is on `recorded_at` (`:24`).
  - Neither latency has been measured.
- **Client re-render:**
  - `registers` (`useReportsNextData.ts:289-315`) and every cutting body (`ReportsNext.tsx:317-335`) are rebuilt on each render. So each drag-stop rebuilds every chart's element tree.
  - `ResponsiveContainer` with debounce 1 (`rp-plot.tsx:77-85`) re-measures every plot on resize.

## 4. Gaps

**G1 — blocker. Arranging on a narrow screen overwrites the desktop layout.**
- `Sheet.tsx:96` passes the same 12-column `lg` layout for every breakpoint (`{ lg, md: lg, sm: lg, xs: lg, xxs: lg }`), but `rp-sheet.ts:165-172` rules sm/xs/xxs into 6, 4 and 2 columns. RGL clamps the layout at those widths.
- On drag or resize stop, `handleChange` (`Sheet.tsx:99-107`) writes the clamped narrow coordinates back as *the* slots. `colsForWidth` (`rp-arrange.ts:133-137`) does the same for keyboard moves.
- There is one saved layout (`encodeSheet`, `useReportsNextData.ts:180-191`), so arranging on a phone or tablet and ruling it off rewrites the desktop sheet into a 2- to 6-column stack.
- This is the "cards switched places" bug, and the main mobile bug.

**G2 — blocker. Arranging before preferences arrive saves the default sheet over the saved one, and the sheet jumps.**
- `useUserPreferences.ts:133` sets `placeholderData: {}`, so `isLoading` is false immediately. Its own comment at `:198-205` says to use `isPlaceholderData`.
- `useReportsNextData.ts:242,348` reads `isLoading` into `sheetKnown`, and `ReportsNext.tsx` never reads `sheetKnown` at all.
- So the default sheet renders and fetches first, then jumps to the saved layout.
- "Arrange" pressed in that window copies the default sheet (`ReportsNext.tsx:160-163`), and "Rule it off" saves it over the founder's layout.

**G3 — major. "Ruled off." is shown before the save lands, and a failed save reverts silently.**
- `ReportsNext.tsx:165-171` calls the fire-and-forget `updatePreferences` (`useUserPreferences.ts:181-184`), then shows the stamp.
- `onError` (`:162-169`) restores the old layout with no message.
- `updatePreferencesAsync` already exists (`:193`) for exactly this case (ADR 0169).

**G4 — major. No chart has a full-screen or expanded view.**
- No fullscreen or expand control exists anywhere under `next/`. The only `aria-expanded` is on the Working list (`rp-plot.tsx:203`).
- Cuttings are bounded by grid cells (minimum 3×3 cells, `rp-sheet.ts:155-156`), so a 90-day till chart or a dense scatter cannot be read at full width. This is worst on mobile.

**G5 — major. Every money figure prints in `$` and en-US for a Turkish house.**
- `rp-format.ts:32-35` → `web/lib/utils.ts:16-33` hard-codes the dollar sign and locale.
- The house-currency formatter at `web/lib/mudavym/format.ts:63-96` is not used.
- Goal money targets are printed with no unit at all (`rp-registers-goals.tsx:94`).

**G6 — major. Purchase-order reads are capped at 1000 rows, and an error becomes an empty list.**
- `advanced-analytics.service.ts:202-223` (`loadOrders`) and `analytics.service.ts:203-224` (`loadDeliveredOrders`) have no `readWholeWindow`, and on error they `return data || []`.
- Consequences:
  - Pacing then says "No delivered purchase order…" (`rp-registers-trade.tsx:338`), reporting a failed read as a quiet period (absence reported as health).
  - The ledger's COGS is understated past 1000 orders.
  - An uncosted order counts as 0 (`advanced…:681`).

**G7 — major. Seasonality and cashflow bucket by UTC date, not the house's day (ADR 0296).**
- `toDaily` (`advanced…:239-255`) and seasonality (`:585-594`) key on `toISOString().substring(0,10)`.
- In Istanbul (UTC+3), the UTC day starts at 03:00 local time, so late sales between 03:00 and the house's own day boundary land on the next weekday.
- In a US house (UTC-5 to -8), every sale after 17:00–19:00 local time lands on the next weekday.
- Known as C02/F-129 (tech-debt note `:27`), still open.

**G8 — major. The cashflow projection is biased low.**
- 180 days are split into weeks (`advanced…:690-692`), so the 26th bucket holds only 5 days.
- That short week is the most recent point fed to `holtLinear(weekly,0.4,0.2,4)` (`:693`), which drags the level and trend down, so `projectedNext4Weeks` understates spend.
- Orders are selected by `created_at` but bucketed by `delivered_at` (`:680`, `:220`), which also drops orders created before the window but delivered inside it.

**G9 — major. The bench cutting recomputes the whole house.**
- `rp-registers-bench.tsx:74-122` calls `/analytics/overview` (`advanced…:824-869`) to read only cashflow, seasonality and active goals.
- The overview also runs financial, risk, inventory-science and menu, which is about 60 page requests (tech-debt `:34`). This duplicates five sibling cuttings on the default sheet.

**G10 — major. Confidence numbers are shown to people (ADR 0104).**
- "Backtest error (MAPE)" at `rp-registers-trade.tsx:585-587`.
- "Table-adjusted fit (R²)" at `rp-registers-house.tsx:546-547`.
- The raw model name is printed at `trade.tsx:589`.

**G11 — major. A failure reads "Request failed with status code 500".**
- `failureOf` (`rp-format.ts:157-162`) uses axios's `error.message`, so the gateway's own sentence is dropped.
- The exports shelf already uses `reasonOf` (`useReportExports.ts:224`).
- The four lens routes also answer 500 where a refused whole-window read should answer 503 (tech-debt `:16`, `:36`).

**G12 — minor. The till chart joins across missing days and turns null into 0.**
- `revenue: num(r.revenue) ?? 0` (`trade.tsx:161`).
- The sparse series is drawn on a categorical axis (`rp-plot.tsx:268-387`), so the line or area bridges closed days, and a day with no reading shows as zero.

**G13 — minor. In bars mode the projection is a second grouped bar.**
- `CatPlot` (`rp-plot.tsx:268-387`) draws `projected` as another `<Bar>`.
- So a measured bar and a projected bar sit side by side, and the seam category has both. There is no `ComposedChart` with bar plus dashed line.

**G14 — minor. The heat cell formats null.**
- `rp-plot.tsx:501-502` calls `format(v as number)` when the cell exists but its value is null.

**G15 — minor. Working list keys collide.**
- `rp-plot.tsx:216-217` keys rows by line text, so duplicate lines collide on remount.

**G16 — minor (plausible, not rendered). Tooltips are clipped at the cutting edge.**
- `.rp-cut { overflow: hidden }` (`next/reports-next.css:69`) clips recharts' absolutely positioned tooltip near the edges of small cuttings.

**G17 — minor. Every chart is rebuilt on each render.**
- `registers` (`useReportsNextData.ts:289-315`) and the cuttings array (`ReportsNext.tsx:317-335`) are not memoised.
- Every draft change during arranging rebuilds all plots.

**G18 — minor. The "Ruled off." timer is never cleared.**
- `window.setTimeout(...)` (`ReportsNext.tsx:170`) has no cleanup, so the state is set after unmount.

**G19 — minor. The till window offers only 7/30/90 days, and there is no period comparison.**
- `Cutting.tsx:80-103` offers 7, 30 and 90, while the route accepts 1–365 (`analytics.controller.ts:1183-1239`).
- No register shows this week against last week or the same week last year.

**G20 — minor. The seasonality inventory read is unbounded, and an error becomes "unknown".**
- `advanced…:607-611`.

**G21 — minor. Dead legacy grid code.**
- `web/components/reports/` holds about 1,800 lines that nothing outside the folder imports:
  - `ChartArrangementModal` 306
  - `ChartConfigModal` 294
  - `DashboardGrid` 424
  - `EditLayoutPanel` 536
  - `WidgetSelector` 238

**G22 — minor. The records are stale.**
- `.planning/08-softwares/reports-analytics.md` (2026-09-01) cites the retired `Reports.tsx`.
- `rp-catalogue.tsx:63-72` cites controller lines that have moved (for example, insights is now `:433`).
- The software has no owner (doc §6).

**G23 — minor. Consumption reads miss an index.**
- `wine_consumption_log` window reads filter `created_at`, but the index is on `recorded_at` (tech-debt `:24`).
- The 365-day ribbon is estimated at about 4 s (`:33`). Neither has been measured.

**Checked and not a gap:**
- Owner/manager-only registers (seats, service) do not fire for staff. `heldBack` (`useReportsNextData.ts:264-271`) disables the query when the role is unknown or not listed.

## Open PRs touching this area (checked 2026-11-07)

| PR | Touches |
|---|---|
| #730, #725, #722 | Goal pace and sales gate: insights route, goals service |
| #619 | Stockout risk lens (analytics) |
| #615 | Owner sales figures read net (analytics) |
| #565 | Failed dashboard reads say they failed |
| #564 | Goal writes need owner/manager |
| #562 | Role-unknown wording on the reports desks |
| #597 | Analytics sketch |

None of these fixes G1–G5 or G8. #565 and #562 are near G11's wording; check them before any `failureOf` change. #725 and #730 touch `analytics.controller.ts` insights.
