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
maturity: partial
status: documented
updated: 2026-09-02
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

**Shipping page (flag off) — unchanged:**
- Notion-style dashboard canvas: drag/resize blocks with inline configuration; your layout persists per user
- KPI spotlight and headline insights bar
- Engine insights panel (analytics-engine output) with act / hide / pin and goals
- Seating density panel; monthly reconciliation; period compare
- Data tables section; AI command palette (searches the real insight feed — see §10)
- Export the visible tables (client-side, 8 formats); the report **generator is
  catalogue-only and says so** (`ReportGenerator.tsx:1-16`)

**Mudavym redesign (flag `mudavym_design_reports`, default OFF):**
- **The sheet** — eight cuttings on a twelve-column ruling; drag to move, pull a
  corner to resize, "Take off" to remove one, "Put back <name>" to return it.
  One toggle ("Arrange the sheet") enters it; "Rule it off" saves.
- **Per-user arrangement** persisted under a new `reportsSheet` preference key
  (`PATCH /users/:id/preferences`), separate from the legacy `dashboardBlocks`
- **The reading** — the analytics engine's sentences verbatim, filtered by the
  categories this restaurant actually has
- **Five graphs, each with a named producer**: sales through the till (area,
  `pos-revenue`), spend pacing (bars, `cashflow`), the week's shape (bars,
  `seasonality`), what's coming (measured + dashed projection, `forecast`),
  margin against movement (scatter on the engine's medians, `menu-engineering`)
- **Figures of record** — the capital-efficiency register (`financial`), tabular
  mono, em dash wherever the engine returned `null`
- **"Show the working"** on every cutting — the SERVER's own `basis` sentence
- **"Ask the book" (⌘K)** — searches the engine's sentences; states in one line
  that free-text answers do not exist
- **The writing desk — DARK on purpose**: the report-generator control renders
  disabled with the reason (no writer exists behind `POST /reports/generate`;
  OD-81), and links to `/documents-reports`
- **Not carried over** (deliberate, see §1b): the global 7/30/90 selector, the
  KPI spotlight modal, add-block / preset / reset, the export menu, the
  monthly-reconciliation and data-tables blocks

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_reports`)

Canonical source with curves: `apps/web/src/pages/reports/next/MOTIONS.md` —
this list is the note-side index (ADR 0044 §2).

| id | token | fires |
|---|---|---|
| `rp-open` | `settle` 420ms | the opening line on mount — opacity + 6px rise, once |
| `rp-rule` | `settle` 320ms | the twelve-column feint ruling fading up when Arrange is entered, down when the sheet is ruled off |
| `rp-lift` | `tuck` 300ms | a cutting's shadow rising while it is dragged; duration + easing injected as `--rp-tuck` from the token, so the curve on screen IS `tuck` |
| `rp-ink` | `ink` 160ms | hover/focus micro-states on cuttings, chips, buttons, links; nothing translates |
| `rp-working` | `turn` 420ms | "Show the working" — the server's `basis` sentences on `grid-rows 0fr→1fr` |
| `rp-ask` | `settle` 320ms | the ⌘K palette panel arriving |
| `rp-sheen` | — (not a token) | skeleton bars while a register is genuinely in flight; identical to the dashboard's `skel-sheen`. Never shown for an unknown |

Deliberate non-motions: no `tally` (a figure of record is read, not watched, and
half of them are em dashes); no chart entrance animation (`isAnimationActive=
{false}` everywhere — a line that draws itself makes a *projection* look like
something happening); no cutting stagger; the seal appears once, pressed **dry**,
at "Ruled off." — wax is for committing to another party, not to your own layout.

### Design used, and why (ADR 0044 p4 wave · MAKEOVER-VERDICTS:177-181 — MERGE)

> *"Used to like today's drag-to-rearrange canvas — where we can just swipe and
> change everything to its place."* The new version is *"more modern."* Wants:
> some blocks **moved**, some **actions removed**, **more graphs**, and *"more
> focus on the insights plus the reports part."* Be **more creative** here.

**The structure that enforces it — the grid is the paper's ruling.** A report
here is a sheet of paper with cuttings laid on it. While you read, the sheet is
plain: eight cuttings flush, no handles, no chrome. "Arrange the sheet" draws
the twelve-column feint ruling (`settle`), gives every cutting a dashed edge and
a grab cursor, and lifts the one under your finger (`tuck`); "Rule it off"
writes the arrangement to your own preferences and presses the die dry. The
ruling is not decoration — it is the visible promise that a cutting lands
square, which is what "swipe everything to its place" actually asks for. Same
engine as the page it merges from (`react-grid-layout`, already the canvas under
`components/reports/DashboardCanvas`), so this is a re-clothing of a proven
interaction and **no new dependency**.

**Actions removed** (the founder's second ask, and the largest single deletion):
edit-mode + add-block + apply-preset + reset (four toolbar controls → one
toggle), the KPI spotlight modal, the eight-format export menu, and — the
important one — **the global 7/30/90 period selector**. Only ONE register on
this page takes a window (`pos-revenue?days=`); the rest are computed over
windows the server fixes (90 days of consumption, 180 of purchasing, 365 of
COGS). A control that appeared to move all of them would be lying about six of
the seven. The picker now lives inside the single cutting it governs, and every
other cutting states its own window under "show the working".

**Blocks moved**: the reading (the engine's own sentences) takes the head of the
sheet, because the honest way to give an insight feed more weight is *more of
it* — not a bigger typeface on a summary somebody wrote. The writing desk is
last, because it is honest about having no writer behind it.

**More graphs, all with producers**: five plots against the legacy default
sheet's vendor-spend charts — area (till), bars (pacing), bars (week's shape),
measured-plus-dashed-projection (forecast), and a scatter with the engine's own
medians as the crosshair (menu engineering). Uncosted wines are **not** plotted:
they have no margin axis, and dropping them to y=0 would file every uncosted
wine as a "dog" — the server refuses that too (`quadrant: null`), and the count
is printed instead.

**The most creative move is also the most honest one: every cutting can show its
working, and the working is the SERVER's sentence.** The analytics endpoints
already return a `basis` object describing the rows they actually covered
(`financial.basis.revenue`, `menuEngineering.basis.margin`,
`cashflow.basis.outflow`) — written after a hand-authored basis once claimed
"on-hand qty × WAC" for a figure computed from WAC on 2 rows in 72. Reprinting
it verbatim is the only version of that line that cannot go stale, and it is the
"visible line back to the data" §12 asks for.

**Honesty rules applied.** Four real states per register, never shared: in
flight = skeleton; refused = a sentence naming *which* register and a retry only
when retrying can help (a 401/403 gets no button); empty = a real empty; unknown
= an em dash. Beyond that, three cases where a chart is the *wrong* rendering of
a true answer, each replaced by a sentence: a weekday profile of seven zeros, a
pair of spend bars both at zero, and a forecast with no fitted model (the
endpoint returns `totalForecastDemand: 0` there — a zero standing in for an
absent model, which is not printed). Ties are not rankings: when the engine's
`bestDay` equals its `worstDay` both read `—`, because an arbitrary tie-break
would invent a pattern out of a flat week. The palette states in words that
free-text answers do not exist.

**Two alternative directions considered and not built** — the founder decides
after seeing the page:

1. **A fixed editorial layout with no canvas at all** (the insight column ruled
   into the page, graphs beneath in a fixed order). It is the calmer page and it
   removes a whole interaction; it was rejected because the drag canvas is the
   one thing the verdict names by name. Worth revisiting only if the founder
   finds they never rearrange.
2. **Per-restaurant saved "views"** (several named sheets — a service sheet, a
   month-end sheet — switchable from the header) instead of one arrangement per
   user. It is the richer idea and the preferences API could hold it, but it
   adds a second concept (naming, switching, deleting) on top of the one the
   verdict asked for, and a sheet you cannot find is worse than one you cannot
   name. The storage shape (`reportsSheet: {v, blocks[]}`) is versioned so this
   is an additive change if it is wanted.

**Substituted or left out, and why.** (a) The legacy **monthly reconciliation**
and **data tables** sections are not carried over — the note's own §12 asked for
"what happened, why, and the one thing to do about it", and two more tabular
blocks would push the sheet past what one screen can hold; they remain on the
shipping page. (b) The **export menu** is gone rather than reduced; the working
archive is `/documents-reports`, linked from the writing desk. (c) **Goals**
(`GET /analytics/goals/:rid`) and **seating density**
(`GET /analytics/table-performance/:rid`) are real endpoints with no cutting on
this sheet — held back to keep the default arrangement readable, and listed in
§13 as the next two cuttings rather than dropped. (d) No `HoldToApprove`
anywhere: nothing on this page commits anything to another party.

## 2. Entry

In-degree 2 ([PAGE_MAP](../foundation/PAGE_MAP.md):144): from `/` (:64) and
`/recommendations` (:89). Sidebar "Reports" (`components/layout/Sidebar.tsx:99`).

## 3. Files

- Route binding: `apps/web/src/App.tsx:261` (lazy import :84).
- `apps/web/src/pages/Reports.tsx` (966 lines).
- Organisms: `components/reports/organisms/{TopBar, HeadlineInsightsBar, EngineInsightsPanel, SeatingDensityPanel, DataTablesSection, AICommandPalette, MonthlyReconciliation}.tsx`; canvas: `components/reports/{DashboardCanvas, EditToolbar, dashboardMeta, dashboardTypes}.tsx`; molecules incl. `KPISpotlightView` (Reports.tsx:23-52).
- Dead sibling: `pages/Reports.v1.backup.tsx` ships in the bundle (`v3.0-TECH-DEBT.md:257`).
- **Mudavym redesign** (`mudavym_design_reports`, default OFF):
  `apps/web/src/pages/reports/next/` — `ReportsNext.tsx` (shell, opening,
  four actions), `Sheet.tsx` (the react-grid-layout canvas), `Cuttings.tsx`
  (the eight register bodies), `rp-plot.tsx` (recharts kit + the four honest
  states + "show the working"), `AskTheBook.tsx` (⌘K palette + ranker),
  `useReportsNextData.ts` (seven tenant-keyed queries + the sheet codec),
  `rp-sheet.ts` (block vocabulary + default arrangement), `rp-format.ts`,
  `reports-next.css`, `MOTIONS.md`, `ReportsNext.test.tsx` (14 tests).
  Route already gated at `App.tsx:306`.

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

**Mudavym redesign reads (all via `apiClient`, all tenant-keyed on
`activeRestaurantId`, all behind the class-level `JwtAuthGuard` at
`apps/api-gateway/src/analytics/analytics.controller.ts:82`):**

| Method | Path | Cutting | Verified at |
|---|---|---|---|
| GET | `/analytics/insights/:rid?limit=40` | The reading · Ask the book | `analytics.controller.ts:289` |
| GET | `/analytics/pos-revenue/:rid?days=` | Through the till | `analytics.controller.ts:668` |
| GET | `/analytics/cashflow/:rid` | Spend pacing | `analytics.controller.ts:641` |
| GET | `/analytics/seasonality/:rid` | The week's shape | `analytics.controller.ts:631` |
| GET | `/analytics/forecast/:rid?horizon=14` | What's coming | `analytics.controller.ts:206` |
| GET | `/analytics/menu-engineering/:rid` | Margin against movement | `analytics.controller.ts:611` |
| GET | `/analytics/financial/:rid` | Figures of record | `analytics.controller.ts:123` |
| GET/PATCH | `/users/:userId/preferences` | the sheet arrangement, key `reportsSheet` | `hooks/useUserPreferences.ts:73,83` |

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
- No feature flags read client-side on the shipping page; POS-connectedness
  changes what the engine returns, not what the page requests.
- **Mudavym redesign gate**: feature flag `mudavym_design_reports` (gateway
  registry `apps/api-gateway/src/settings/feature-flag-registry.ts`), default
  **OFF**; per-browser override `localStorage["mudavym.design.reports"]`
  (`"1"|"true"|"on"` forces the redesign, `"0"|"false"|"off"` forces legacy).
  Precedence and defaults: `lib/mudavym/useMudavymDesign.ts:1-23`.
- **Redesign arrangement** persists per USER (not per restaurant) under the new
  preference key `reportsSheet` — `{ v: 1, blocks: [{ i, x, y, w, h, hidden }] }`.
  A new key on purpose: writing to the legacy page's `dashboardBlocks` would
  rewrite a layout in a block vocabulary the legacy canvas cannot read. The
  decoder drops unknown ids and falls back to the default slot for missing
  ones, so a later release adding a cutting never orphans a saved sheet.

## 9. Gaps

- The 39 analytics endpoints behind every number on this page are guarded since
  2026-08-24 (#31) — `@UseGuards(JwtAuthGuard)` at class level
  (`apps/api-gateway/src/analytics/analytics.controller.ts:51`); the atlas row
  ([ENDPOINTS](../foundation/ENDPOINTS.md):10 — "classify these") is stale.
- `Reports.v1.backup.tsx` is registered dead code (`v3.0-TECH-DEBT.md:257`).
- Analytics truth-suite work is carried-forward unbuilt scope
  (`v3.0-TECH-DEBT.md:322-324`, was Phase 41).

**Found by the Mudavym rebuild, 2026-09-02 — all OUTSIDE this page's paths:**

1. **`scripts/check_no_seeded_defaults.py` does not scan the rebuilt page.**
   `SCAN_ROOTS` (:187-198) lists nine rebuilt surfaces and not
   `apps/web/src/pages/reports/next`. The guard therefore passes without having
   looked. Rules S1–S3 were run against the directory by hand and it is clean
   (0 row sets, 0 placeholders, 0 write loops) — but a hand check is not a
   guard. **Add `Path("apps/web/src/pages/reports/next")` to `SCAN_ROOTS`.**
2. **`financial.cogs` and `financial.revenue` are unconditional sums**
   (`analytics.service.ts`, `getFinancialSummary`): `E.stats.sum([])` is `0`, and
   `loadDeliveredOrders` degrades a failed query to `[]`, so "no delivered
   orders" and "the query failed" both render as `$0`. Every *cost-derived*
   figure beside them is correctly `null` (that work was done); these two were
   not. The redesign prints the server's number and its basis string rather than
   inventing a null the server did not send — but the fix belongs in the
   gateway. Same shape as `absence reported as health`.
3. **`forecast.totalForecastDemand` is `0` when no model fits**
   (`analytics.service.ts`, `result ? sum : 0`) — a zero standing in for an
   absent model. The redesign detects it via `forecast.length === 0` and says
   the absence instead; the endpoint should return `null`.
4. **`seasonality.bestDay` / `worstDay` break ties arbitrarily**, so a flat
   week reports the same day as busiest and quietest. The redesign suppresses
   both to `—` when they are equal; the endpoint should return `null` when no
   day is separable.

**Known limitation inside this page's own build:** dragging and resizing a
cutting is pointer-only — `react-grid-layout` exposes no keyboard affordance,
and the shipping canvas has the same limitation. Everything else on the sheet is
keyboard-reachable (every chip, filter, window picker, "Take off", "Put back",
"Show the working" and the ⌘K palette are real buttons/inputs with visible focus
rings), and the default arrangement is usable without ever entering Arrange. A
keyboard path — move/resize the focused cutting with the arrow keys while
arranging — is the honest fix and is not built.

## 10. Maturity

**partial** — moved from **hollow** on 2026-09-02. Two things moved it, and one
of them is a correction to this section rather than new work.

### The two "hollow" findings were already fixed — this note was stale

Both were repaired in `58113e26` ("fix: security holes, the honesty sweep, and
46 page dossiers", #70) — the *same* commit that wrote this dossier, so the
dossier was authored against the pre-fix tree and never caught up. Verified on
`feat/mudavym-design-p4`, 2026-09-02:

| Was recorded | Actually true today |
|---|---|
| "AI Command Palette calls `generateMockAnswer`, hand-written fake analysis with invented numbers" | **Gone.** `generateMockAnswer` does not exist anywhere in `apps/web/src` (only in comments and in two tests that assert its absence — `insightSearch.test.ts:100`). The palette now searches the real feed through `useEngineInsights` + `insightSearch.rankInsights` and says free-text answers are unavailable: `AICommandPalette.tsx:1-27` |
| "Report Generator's `onGenerate` is a `console.log` (`Reports.tsx:759-766`)" | **Gone.** `<ReportGenerator>` is mounted at `Reports.tsx:917` with **no `onGenerate` prop at all**, under a comment (`:911-916`) explaining that `POST /reports/generate` would only manufacture records the archive cannot open; `ReportGenerator.tsx:1-16` states the same in the component and the UI says so |

The underlying platform gap is unchanged and still real: **no report writer
exists** (OD-81). What changed is that no surface claims otherwise.

### What the rebuild adds (flag `mudavym_design_reports`, default OFF)

Seven live registers behind the sheet, all authenticated and tenant-keyed, five
of them graphs that had no equivalent on this page: till revenue, spend pacing,
weekday shape, demand forecast, and the margin×velocity quadrants. Every
register renders four distinct states, and every cutting can print the server's
own `basis` sentence. 14 render-contract tests hold the honesty rules.

**Why not "complete":** the report writer is still absent (§13.2), and two real
endpoints — goals and seating density — have no cutting yet (§13.6). The
shipping page keeps its monthly reconciliation and data-tables sections, which
the redesign deliberately does not carry (§1b).

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
| GET | **AI Command Palette** → `/analytics/insights/:rid` | JWT | `analytics.controller.ts:289` | ~~No request is made~~ — corrected 2026-09-02: it queries the real feed via `useEngineInsights` (`AICommandPalette.tsx:1-27`) |
| — | **Report Generator** | — | **none** | ~~`console.log`~~ — corrected 2026-09-02: no `onGenerate` prop is passed at all (`Reports.tsx:911-917`); the component states generation is unavailable |

All analytics calls are raw `fetch` against `VITE_API_GATEWAY_URL`
(`EngineInsightsPanel.tsx:27,147`), not `apiClient`.

### Fed by

| Data | Producer | Live? |
|---|---|---|
| Insights | `@Cron(EVERY_HOUR)` insight scheduler (`analytics/insights/insight-scheduler.service.ts:42`) + on-demand `?refresh=true` | Yes |
| POS-dependent depth | Toast/SimPOS ingestion → `pos_checks` (memory: pos-bridge-state — bridge proven, 1.4%→67.4% of insights) | Yes where a POS is connected; 429/573 insight types need `checks` (TIER-MAP:91-93) |
| Layout | This page's own preference writes | Yes |
| Command-palette answers | `/analytics/insights/:rid` — the engine's own sentences, selected not composed (`insightSearch.ts`). ~~"fabricated in the browser"~~ was true before `58113e26`; corrected 2026-09-02 | Yes |
| Redesign: till revenue · pacing · weekday shape · forecast · quadrants · capital efficiency | `pos-revenue` · `cashflow` · `seasonality` · `forecast` · `menu-engineering` · `financial` (see §4) | Yes — with the four honesty caveats in §9 |
| Generated reports | **none** — and the generator here does not even attempt one. ~~the only `generated_reports` writer is `/communications`~~ → as of 2026-08-26 (OD-81) `/communications` no longer calls it either: the "Generate Now" handler was deleted for claiming success it did not have. `POST /reports/generate` remains the table's only writer in the repo, with **no caller in the product**. Scoping for a real generator: [[OD-81-REPORT-GENERATOR-SCOPING]] | No |

### Writes

| Write | Downstream reaction |
|---|---|
| `PATCH /users/:id/preferences` | Canvas layout persists per user across devices (`Reports.tsx:187,466`) |
| `POST /analytics/recommendations/:rid/action` | Manager disposition (hide/pin) persists server-side and suppresses the insight for everyone (`EngineInsightsPanel.tsx:163-170,281,309`) |
| `POST /analytics/goals/:rid` | Goal appears in the goals block and in insight generation |
| Command palette / report generator | **none** — the palette only reads; the generator is not wired (§10) |
| Redesign: `PATCH /users/:id/preferences` key `reportsSheet` | the reader's sheet arrangement persists across devices; deep-merged server-side, so it cannot disturb `dashboardBlocks` or any other key |

## 12. Design intent

**Should be:** the understand layer — what happened, why, and the one thing to do
about it, with a visible line back to the data.

| State | Handled? | Evidence |
|---|---|---|
| Loading | Yes | Full-page spinner `Reports.tsx:774-784`; redesign: per-register skeletons (`rp-plot.tsx` `Waiting`) |
| Empty | **Yes, and well** | The POS banner names the condition instead of drawing zeros (`:790-808`); redesign: `Nothing` per register, plus three cases where a true answer is *said* rather than drawn (§1b) |
| Error | Partial → **Yes on the redesign** | Shipping page: panels degrade to empty, no page-level error surface. Redesign: every register renders `Refused`, naming which register could not be read |
| Permission-denied | **No** → **Yes on the redesign** | Shipping page has no 403 branch. Redesign: `failureOf()` separates 401/403 from a 5xx and withholds the retry button, because retrying a refusal changes nothing (`rp-format.ts`) |

**Where the UI misleads**

1. ~~The palette fabricates answers~~ — **fixed before this note was written and
   recorded late; see §10.** It queries `/analytics/insights/:rid`.
2. ~~"Generate" gives no error and no result~~ — **also fixed**: no handler is
   passed and the component says generation is unavailable (§10).
3. Export filename/title still say WineOps (`Reports.tsx:530-531`, §7) — **still
   true** on the shipping page. The redesign ships no exporter at all.
4. **New, and outside this page**: `financial.cogs` / `financial.revenue` render
   `$0` for "no rows *or* no answer" (§9.2), and `forecast.totalForecastDemand`
   returns `0` when no model fits (§9.3). The redesign renders the server's
   number with its basis, and refuses to print the forecast total at all when no
   model fitted — but the endpoints should return `null`.

## 13. Roadmap

1. ~~**Disable the AI Command Palette until it queries the engine.**~~ **Done**
   before this note was written; recorded 2026-09-02 (§10). It queries
   `/analytics/insights/:rid` and states that free-text answers do not exist.
2. **Wire or remove the report generator.** Still open, and still the same
   blocker: `POST /reports/generate` inserts a `pending` row nothing fills
   (OD-81). The shipping page no longer offers the button; the redesign renders
   it disabled with the reason. **A real writer is the only thing that closes
   this.**
3. ~~Wire the palette for real against `/analytics/insights/:rid`~~ — **done**
   (item 1).
4. ~~Page-level error surface for the analytics fetches~~ — **done on the
   redesign** (per-register `Refused`, with 401/403 separated from 5xx). Still
   open on the shipping page.
5. Delete `pages/Reports.v1.backup.tsx` (`v3.0-TECH-DEBT.md:257`).
6. **Two more cuttings, both on endpoints that already exist**: goals
   (`GET/POST /analytics/goals/:rid`, `analytics.controller.ts:481,493`) and
   seating density (`GET /analytics/table-performance/:rid`, `:422`). Held back
   from the first sheet only to keep the default arrangement readable; adding
   one is a `rp-sheet.ts` entry plus a body in `Cuttings.tsx`, and the stored
   sheet is versioned so existing arrangements survive it.
7. Analytics truth suite — carried-forward unbuilt scope
   (`v3.0-TECH-DEBT.md:322-324`).
8. Rebrand export artifacts (§7) — shipping page only.

### Outside this page's paths, needed by the rebuild (see §9)

9. **`scripts/check_no_seeded_defaults.py`**: add
   `Path("apps/web/src/pages/reports/next")` to `SCAN_ROOTS` (:187). The guard
   currently passes on this page without scanning it.
10. **`apps/api-gateway/src/analytics/analytics.service.ts`**: return `null`
    rather than `0` for `financial.cogs` / `financial.revenue` when the loader
    degraded to `[]`, and for `forecast.totalForecastDemand` when no model fit.
11. **`apps/api-gateway/src/analytics/advanced-analytics.service.ts`**: return
    `null` for `seasonality.bestDay` / `worstDay` when no weekday is separable,
    instead of breaking the tie arbitrarily.
12. **Nav**: none needed — `/reports` is already in the sidebar
    (`components/layout/Sidebar.tsx:99`) and the route already gated
    (`App.tsx:306`).
