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

**Shipping page (flag off) — unchanged:**
- Notion-style dashboard canvas: drag/resize blocks with inline configuration; your layout persists per user
- KPI spotlight and headline insights bar
- Engine insights panel (analytics-engine output) with act / hide / pin and goals
- Seating density panel; monthly reconciliation; period compare
- Data tables section; AI command palette (searches the real insight feed — see §10)
- Export the visible tables (client-side, 8 formats); the report **generator is
  catalogue-only and says so** (`ReportGenerator.tsx:1-16`)

**Mudavym redesign (flag `mudavym_design_reports`, default OFF):**
- **The sheet** — cuttings on a twelve-column ruling; **drag anywhere on a
  cutting to move it, pull its bottom-right corner to resize**, "Take off" to
  remove one, "Add a cutting" to put any catalogued analysis on. One toggle
  ("Arrange the sheet") enters arranging; "Rule it off" saves; "Put it all
  back" restores the house sheet.
- **A catalogue of eleven analyses**, each an endpoint the gateway actually
  serves (§4). Eight lie on the default sheet; `seats`, `service` and `restock`
  are one click away.
- **Per cutting: "Show instead"** — change which analysis occupies that square
  of paper, keeping its position and size. An analysis already on the sheet is
  offered but disabled (a duplicate is not a comparison).
- **Per cutting: "Draw as"** — line · bars · area · heat map · scatter · table ·
  one figure, **offered only where the drawing is true of that register's data**
  (the week's shape has no heat map; figures of record has no bars), with one
  line under the controls saying what is not offered and why.
- **Per-user arrangement, subject AND drawing** persisted together under the
  `reportsSheet` preference key (`PATCH /users/:id/preferences`, v2 blob),
  separate from the legacy `dashboardBlocks`; a v1 blob upgrades in place
- **The reading** — the analytics engine's sentences verbatim, filtered by the
  categories this restaurant actually has
- **Deep plots**: both axes labelled with their unit, the window printed under
  every cutting's title, hover detail naming the row and spelling the unit out,
  the server's `basis` behind "Show the working", and the engine's own medians
  drawn as reference rules where the endpoint publishes them (the
  menu-engineering crosshair; the forecast seam)
- **A weekday × week heat map** on the one register with a date on every row
  (`pos-revenue`), drawn as a real table so an unrecorded day is blank paper
  rather than the coldest colour on the ramp
- **Figures of record** — the capital-efficiency register (`financial`), tabular
  mono, em dash wherever the engine returned `null`
- **"Ask the book" (⌘K)** — searches the engine's sentences; states in one line
  that free-text answers do not exist. Reads the insight feed whether or not
  "The reading" is on the sheet.
- **The writing desk — DARK on purpose**: the report-generator control renders
  disabled with the reason (no writer exists behind `POST /reports/generate`;
  OD-81), and links to `/documents-reports`
- **Not carried over** (deliberate, see §1b): the global 7/30/90 selector, the
  KPI spotlight modal, add-block / preset / reset, the export menu, the
  monthly-reconciliation and data-tables blocks

### What this page can do now

Plain list, for the question "what are the capabilities of the new model".
Everything below is built and tested on `feat/mudavym-design-p4`; the last block
is what it still cannot do, and why.

**The eleven analyses you can put on a sheet** (each is one gateway endpoint):

| Cutting | What it answers | Window | Drawings offered |
|---|---|---|---|
| The reading | What the engine has noticed, in its own sentences | the stored insight feed, hourly | table · bars |
| Through the till | What guests actually paid, day by day | 7 / 30 / 90 days, your choice | area · line · bars · **heat map** · table · one figure |
| Spend pacing | Whether buying runs hot or cold against last month | 180 days, two 30-day windows | bars · table · one figure |
| The week's shape | Which nights carry the week | last 90 days of consumption | bars · line · area · table |
| What's coming | What the model expects the next fortnight to take | 120 days of history, 14 ahead | line · area · bars · table · one figure |
| Margin against movement | Which wines earn their place | the list, against 90 days of movement | scatter · bars · table |
| Figures of record | What the cellar is worth, how hard the capital works | 365 days of COGS | table · one figure |
| The room | Which tables earn, which seats sit idle | last 90 days of checks | bars · scatter · table |
| Who served it | What each server's checks look like | last 90 days of checks | bars · table |
| What to buy back | What is about to run out, and how likely | 90 days of demand | table · bars |
| The writing desk | Nothing — no report writer exists (OD-81) | — | none, and it says so |

**What you can do to a sheet**

- **Move** any cutting by dragging it anywhere on the ruling, while arranging.
- **Resize** any cutting by pulling its bottom-right corner, while arranging.
- **Change what a cutting shows** ("Show instead") to any of the eleven; the
  square of paper keeps its position and size.
- **Change how it is drawn** ("Draw as") to any drawing that is true of that
  register's data. A drawing that would misrepresent it is not offered, and one
  line says why.
- **Take a cutting off**, and **add any catalogued one back** — including the
  three that are not on the house sheet.
- **Put it all back**: one button restores the house arrangement.
- **Rule it off**: positions, sizes, subjects and drawings are saved together,
  per user, across devices and restaurants.
- **Change the till's window** (7 / 30 / 90) from inside the till cutting. That
  is the only period control on the page, because it is the only register whose
  endpoint takes one.

**What every drawing tells you**

- Both axes are labelled, with the unit.
- The window is printed under the cutting's title, always.
- Hovering names the row and spells the unit out in words.
- "Show the working" prints the SERVER's own `basis` sentence — never one this
  page wrote.
- A projection is always dashed, whichever drawing you pick.
- A reference rule is drawn only where the engine published one (the
  menu-engineering medians; the forecast seam). Where it publishes none, the
  cutting says so instead of inventing a line.
- An unknown is an em dash. An absent feed is a sentence. A register that
  refused names itself, and only offers "Read it again" when retrying could help.

**Keyboard**

- ⌘K / Ctrl-K opens "Ask the book"; Escape closes it.
- Every chip, filter, window button, "Show instead", "Draw as", "Take off",
  "Add a cutting" and "Show the working" is a real control with a visible focus
  ring, reachable by Tab.

**What it still cannot do, and why**

- **Move or resize a cutting from the keyboard.** `react-grid-layout` exposes no
  keyboard affordance and the shipping canvas has the same limitation. Everything
  else is reachable, and the default sheet is usable without ever arranging.
- **Draw a weekday × hour heat map.** No analytics endpoint returns hour-of-day
  grain today — `pos_checks.opened_at` would have to be bucketed by hour in the
  gateway first (§13.13). Weekday × week is offered because `pos-revenue` really
  does return a date per row.
- **Discard an arrangement mid-edit.** "Rule it off" saves and "Put it all back"
  resets to the house sheet; there is no cancel. Adding a fourth button was not
  worth it until the founder says it is.
- **Write a report.** `POST /reports/generate` still files a `pending` row that
  nothing fills (OD-81). The button is off, with the reason.
- **Show two cuttings of the same register.** Deliberate: a duplicate is not a
  comparison, and the two would issue the same request twice.

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
something happening); no cutting stagger; **nothing animates when a cutting
changes its drawing or its subject** (a cross-fade would suggest two pictures
are the same measurement in transit); the seal appears once, pressed **dry**,
at "Ruled off." — wax is for committing to another party, not to your own layout.

### Design used, and why (ADR 0044 p4 wave · MAKEOVER-VERDICTS:177-181 — MERGE)

> **This is the FIRST pass, 2026-09-02, kept as written.** Where a count or a
> claim below has since changed — eight cuttings became a catalogue of eleven,
> five plots became seven drawings offered per register, and three gateway
> honesty gaps were closed at the source — the `### Second pass, 2026-09-03`
> subsection below is authoritative and says exactly what moved.

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
pair of spend bars both at zero, and a forecast with no fitted model. Ties are
not rankings: a shared extreme reads `—`, because an arbitrary tie-break would
invent a pattern out of a flat week. The palette states in words that free-text
answers do not exist.

> **Retired 2026-09-03.** This paragraph used to add that the page detects
> `totalForecastDemand: 0` and `bestDay === worstDay` *itself*, because the
> endpoints reported an absence as a figure. Both are now fixed in the gateway
> (§9.3, §9.4): the server sends `null` with `modelFitted: false`, and `null`
> with `tie: true`. The page reads the server's verdict and prints the server's
> reason; the client-side detection is kept only as a fallback for an older
> gateway, and is labelled as such in `rp-catalogue.tsx`.

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

### Second pass, 2026-09-03

**What the founder asked**, verbatim where it matters: *"we still need to have
those functionality and flexibility, especially different type of graphs — some
people might need lines, some bar charts, some heat maps… while we're editing
the /reports page for our personalized customized versions, we should ask them
either to change the type of graph or to change the graph or the data analysis
itself. Meaning, if it was showing the wine analysis, then maybe people don't
want it — they're going to select from that aspect. We're going to have a lot of
deep detailed graphs there… are we still able to drag and drop, or now it's
fixed locations? If it's drag and drop and we can still adjust it, then it's
perfect… fix every 'honest about' part error or obstacle to bulletproof profound
solutions."*

**The structural change: a cutting is a QUESTION, not a chart.** Pass one gave
each register its own component, so each register owned its own drawing and
neither could be exchanged. Every analysis now reduces to one shape
(`rp-view.ts` — `AnalysisView`: a categorical series, a scatter, a matrix, a
table, figures, notes, basis) and one renderer draws it (`Cutting.tsx`). That is
what makes both switches possible, and it is what makes them *safe*: the
honesty rules live in the renderer, so they cannot be forgotten by the
eleventh analysis the way they could by the eighth component.

**What was built**

1. **"Draw as" per cutting** — line · bars · area · heat map · scatter · table ·
   one figure, from the `graphs` list on each catalogue entry
   (`rp-catalogue.tsx`). Recharts throughout, except the heat map (below).
   A type the data cannot carry is **not offered**, and `graphNote` says why in
   one line under the control. Persisted with the layout.
2. **"Show instead" per cutting** — the whole catalogue, built from endpoints
   verified in `analytics.controller.ts` (§4). Swapping keeps the slot and
   resets the drawing to the new analysis's own default, because the old one may
   not be true of the new data. Three analyses that had no cutting before are in
   it: the room (`table-performance`), who served it (`waiters`), what to buy
   back (`inventory-science`). Taking one off and adding it back are the same
   mechanism.
3. **Deep plots** — axis labels with units on both axes, the window under every
   title, a tooltip that names the row and spells the unit out, the server's
   `basis` behind "Show the working", and reference rules **only** where the
   endpoint publishes one.
4. **Drag and resize survive** — `isDraggable` and `isResizable` are one flag,
   `onDragStop` and `onResizeStop` both write the slot, and the two new selects
   sit inside `draggableCancel` so choosing from them never starts a drag
   (`Sheet.tsx`). **Tested in `Sheet.test.tsx`** (5 cases), which stands a
   capture in for the grid, reads the props `Sheet` hands it, and then
   invokes `onDragStop` / `onResizeStop` with the layout react-grid-layout
   would have produced. That is a narrower claim than "drag works end to end" —
   it is "the callbacks are bound, and the layout they receive becomes the slot
   we save", which is the half that can regress silently. jsdom cannot produce
   RGL's pointer-delta math, so the other half is exercised by using the page;
   it was, on the running dev server, on 2026-09-03.
5. **The fetch follows the DRAFT, not the saved sheet.** Found by driving the
   real page: swapping a cutting showed a skeleton until the sheet was ruled
   off, because the query list still followed the saved arrangement. You cannot
   choose an analysis you cannot see, so `useReportsNextData` takes the ids
   currently on screen (`useReportsNextData.ts`, `showing`).

**The heat map is deliberately not recharts.** Recharts 2.x has no heat-map
primitive; the two ways of faking one (fat-square scatter, stacked bars) both
lose the row and column headers that make a calendar readable, and neither can
tell "nobody rang anything up" from "the quietest service of the quarter". It is
a real `<table>`: headers are headers, every cell carries its date and figure,
the ramp is one hue (the seal at proportional opacity), and an **unrecorded day
is blank paper with a hairline**, not the coldest colour. Verified against the
live gateway: 20 filled cells and 15 blank over the 30-day window.

**What was fixed in the gateway** (module `apps/api-gateway/src/analytics/**`,
all three specified in `absent-not-zero.spec.ts` (15 cases; all 15 fail against
the pre-fix tree), each verified with curl against the local gateway on :4000,
restaurant `550e8400-…0000`):

| Was | Is | Where |
|---|---|---|
| `financial.cogs` and `financial.revenue` summed `[]` to `$0` — and both loaders degrade a FAILED query to `[]`, so "the read failed" and "bought nothing all year" rendered identically | `null` when no row came back, with a `basis` naming both possibilities; the real total, and a count of the rows summed, when rows exist. `inventoryTurnover` / `daysInventoryOutstanding` and the three ratios now also withhold on a null numerator or denominator | `analytics.service.ts:428-441` (`cogs`, `revenue`), `:444-466` (the ratios), `:531-542` (`basis`) |
| `forecast.totalForecastDemand` was `0` when nothing fitted — and worse, `toDailySeries` zero-fills, so a restaurant with no consumption handed Holt-Winters 120 zeros, HW "fitted" them, and a 14-day projection of nothing was published as a prediction | `totalForecastDemand: null`, `modelFitted: false`, `model: null`, `forecast: []`, and a `basis.model` saying every day of the history reads zero | `analytics.service.ts:895-937` |
| `seasonality.bestDay` / `worstDay` came from `reduce((a,b) => b.mean > a.mean)`, which resolves an exact tie to whichever weekday came first — so a flat week named **Sunday as both the busiest and the quietest night** | both `null` with `tie: true` when an extreme is shared, plus a `basis.extremes` sentence. Only the *ambiguous* end is withheld when the other is separable — nulling a true answer to be safe is its own dishonesty | `engine/comparisons.ts:208-238` (`separableExtremes`, new), `advanced-analytics.service.ts:389-393,424-452` |

Curl proof, live: `financial.cogs = null` with *"no delivered order was returned
for this window, which is either no purchasing or a read that failed, and $0
would claim the first"*; `forecast.modelFitted = false`, `model = null`,
`totalForecastDemand = null`; `seasonality.tie = true` with all seven weekday
means at 0 — the exact payload that used to answer "Sunday" twice.

**Two alternative directions considered and not built** (this pass):

1. **A per-type chart gallery**, the Lightspeed shape DESIGN-FOUNDATION §6 warns
   against ("a chart-type picker — a spreadsheet in disguise"). Rejected in that
   form and built in the other: the picker here is not "draw anything any way",
   it is "this register can honestly be read these ways", and the list shrinks
   to what is true. That distinction is the whole reason it is safe to ship.
2. **Named house layouts** ("Before service", "Buying week") — §6's "a house
   layout, not an empty one". It is a good idea and it now costs almost nothing,
   because a layout is `{id, slot, graph}[]` and the codec is versioned. Held
   because the founder asked for *personalisation* this pass, and a preset menu
   arriving in the same release as two per-cutting switches would bury them.
   Filed as §13.14.

**Substituted or left out, and why.** (a) `Cuttings.tsx` was deleted, not
extended — its eight bespoke bodies became eleven `view` builders in
`rp-catalogue.tsx`, which is the only way "Show instead" can be uniform. (b) The
`basket` (pairings) and `vendor-scorecard` endpoints were left out of the
catalogue: both are real, but their payload shapes were not read closely enough
this pass to write an honest decoder, and a decoder that guesses at a field name
renders an em dash that means "we did not look". §13.15. (c) A weekday × **hour**
heat map is not built because no endpoint has hour grain (§9.5). (d) No
`HoldToApprove` anywhere: nothing on this page commits anything to another party.

## 2. Entry

In-degree 2 ([PAGE_MAP](../foundation/PAGE_MAP.md):144): from `/` (:64) and
`/recommendations` (:89). Sidebar "Reports" (`components/layout/Sidebar.tsx:99`).

## 3. Files

- Route binding: `apps/web/src/App.tsx:261` (lazy import :84).
- `apps/web/src/pages/Reports.tsx` (966 lines).
- Organisms: `components/reports/organisms/{TopBar, HeadlineInsightsBar, EngineInsightsPanel, SeatingDensityPanel, DataTablesSection, AICommandPalette, MonthlyReconciliation}.tsx`; canvas: `components/reports/{DashboardCanvas, EditToolbar, dashboardMeta, dashboardTypes}.tsx`; molecules incl. `KPISpotlightView` (Reports.tsx:23-52).
- Dead sibling: `pages/Reports.v1.backup.tsx` ships in the bundle (`v3.0-TECH-DEBT.md:257`).
- **Mudavym redesign** (`mudavym_design_reports`, default OFF):
  `apps/web/src/pages/reports/next/` — `ReportsNext.tsx` (shell, opening, four
  actions, the arrange bar), `Sheet.tsx` (the react-grid-layout canvas: move +
  resize), `Cutting.tsx` (one renderer for every analysis, plus the two
  switches), `rp-spec.ts` (the contract a catalogue entry signs),
  `rp-registers-trade.tsx` + `rp-registers-house.tsx` (**the eleven analyses**:
  path, window, truthful drawings, decoder and view builder each),
  `rp-catalogue.tsx` (assembles them; the only file that names all eleven),
  `rp-view.ts` (the one shape every analysis reduces to), `rp-plot.tsx`
  (recharts kit, the heat-map table, the four honest states, "show the
  working"), `ReadingList.tsx` (the insight feed's own stateful list),
  `AskTheBook.tsx` (⌘K palette + ranker),
  `useReportsNextData.ts` (`useQueries` over whatever is on the sheet + the v2
  sheet codec), `rp-sheet.ts` (ids, drawings, slots, the house arrangement),
  `rp-format.ts`, `reports-next.css`, `MOTIONS.md`, `ReportsNext.test.tsx`
  (31 tests) and `Sheet.test.tsx` (5 — the drag/resize contract).
  `Cuttings.tsx` was **deleted** in the second pass — its eight bespoke bodies
  are now `view` builders in the two register files. Route already gated at
  `App.tsx:306`.
  **Size, honestly:** 18 files; 14 of them source, totalling 3,608 lines
  (counted 2026-09-03, excluding the two test files, the CSS and `MOTIONS.md`).
  That is well past the p4 brief's "~900 lines across its files" — pass one
  already shipped 2,213, and this pass roughly doubled what the page does
  (eleven analyses against eight cuttings, seven drawings against one apiece).
  The response was to split rather than to cut: the largest source
  file is `rp-registers-house.tsx` at 662 lines, and the two largest are
  declarative register definitions, not logic. Recorded here rather than left
  for a reader to discover.

## 4. Endpoints

The widest analytics consumer among the 17 core-ops pages. Atlas rows:
[ENDPOINTS](../foundation/ENDPOINTS.md):10 (`analytics`, 39 — atlas's **all-unguarded warning**
is stale; guarded at class level since 2026-08-24 (#31),
`apps/api-gateway/src/analytics/analytics.controller.ts:84`),
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
`apps/api-gateway/src/analytics/analytics.controller.ts:84`):**

| Method | Path | Cutting | Verified at |
|---|---|---|---|
| GET | `/analytics/insights/:rid?limit=40` | The reading · Ask the book | `analytics.controller.ts:292` |
| GET | `/analytics/pos-revenue/:rid?days=` | Through the till | `analytics.controller.ts:671` |
| GET | `/analytics/cashflow/:rid` | Spend pacing | `analytics.controller.ts:644` |
| GET | `/analytics/seasonality/:rid` | The week's shape | `analytics.controller.ts:634` |
| GET | `/analytics/forecast/:rid?horizon=14` | What's coming | `analytics.controller.ts:209` |
| GET | `/analytics/menu-engineering/:rid` | Margin against movement | `analytics.controller.ts:614` |
| GET | `/analytics/financial/:rid` | Figures of record | `analytics.controller.ts:126` |
| GET | `/analytics/table-performance/:rid?sinceDays=90` | The room (added 2026-09-03) | `analytics.controller.ts:425` |
| GET | `/analytics/waiters/:rid?sinceDays=90` | Who served it (added 2026-09-03) | `analytics.controller.ts:443` |
| GET | `/analytics/inventory-science/:rid` | What to buy back (added 2026-09-03) | `analytics.controller.ts:156` |
| GET/PATCH | `/users/:userId/preferences` | the sheet: slots, subjects and drawings, key `reportsSheet` | `hooks/useUserPreferences.ts:73,83` |

**Only what is on the sheet is fetched.** `useQueries` builds its query list from
the cuttings currently on screen (the arrangement draft included), so taking a
cutting off stops its request and putting one on starts it. The one exception is
`insights`, which is read whether or not "The reading" is on the sheet, because
the ⌘K palette searches it — stated in `useReportsNextData.ts` rather than
hidden in the palette.

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
  preference key `reportsSheet` — **v2**: `{ v: 2, blocks: [{ i, x, y, w, h, g,
  on }] }`, where `g` is the drawing and `on` says whether the cutting is on the
  sheet at all. A new key on purpose: writing to the legacy page's
  `dashboardBlocks` would rewrite a layout in a block vocabulary the legacy
  canvas cannot read. The decoder drops unknown ids, falls back to the default
  slot for a missing one, and falls back to an analysis's first truthful drawing
  when the stored one is no longer offered — so adding a cutting, or withdrawing
  a drawing that turned out to be a lie, never orphans a saved sheet. **A v1
  blob upgrades in place** (same ids; `hidden: true` becomes off the sheet), and
  every id is written on or off so "I took that one off" is a stored fact rather
  than an absence a later release could read as "never seen".

## 9. Gaps

- The 39 analytics endpoints behind every number on this page are guarded since
  2026-08-24 (#31) — `@UseGuards(JwtAuthGuard)` at class level
  (`apps/api-gateway/src/analytics/analytics.controller.ts:84`); the atlas row
  ([ENDPOINTS](../foundation/ENDPOINTS.md):10 — "classify these") is stale.
- `Reports.v1.backup.tsx` is registered dead code (`v3.0-TECH-DEBT.md:257`).
- Analytics truth-suite work is carried-forward unbuilt scope
  (`v3.0-TECH-DEBT.md:322-324`, was Phase 41).

**Found by the Mudavym rebuild, 2026-09-02 — status after the second pass:**

1. ~~`scripts/check_no_seeded_defaults.py` does not scan the rebuilt page.~~ —
   **THIS FINDING WAS ITSELF WRONG, struck 2026-09-03.** `SCAN_ROOTS` already
   contains `Path("apps/web/src/pages/reports/next")`
   (`scripts/check_no_seeded_defaults.py:199`), added by the parent session's
   wave commit `9b6607e2`, which predates this page's own commits — so the
   finding was authored against a tree that no longer existed and never
   re-checked. Re-run 2026-09-03: `PASS — 129 web file(s) and 13 gateway
   file(s) across 19 root(s)`, this directory among them. The lesson is the
   register's own: a gap recorded once and not re-verified rots into a false
   claim about health, which is the same fault in the opposite direction.
2. ~~`financial.cogs` / `financial.revenue` are unconditional sums~~ —
   **FIXED 2026-09-03**, `analytics.service.ts:428-441`. Both return `null` when
   the loader came back empty, with a `basis` naming both possibilities; the
   ratios that divide by them withhold too. Spec: `absent-not-zero.spec.ts`.
   Verified with curl against the local gateway.
3. ~~`forecast.totalForecastDemand` is `0` when no model fits~~ —
   **FIXED 2026-09-03**, `analytics.service.ts:895-937`, and the fix went
   further than the finding: `toDailySeries` zero-fills, so Holt-Winters always
   "fitted" and the endpoint published a 14-day projection of nothing as a
   prediction. It now publishes nothing at all when the history holds no
   observation (`modelFitted: false`, `model: null`, `forecast: []`).
4. ~~`seasonality.bestDay` / `worstDay` break ties arbitrarily~~ —
   **FIXED 2026-09-03**, `engine/comparisons.ts:208-238` +
   `advanced-analytics.service.ts:389-393,424-452`. `separableExtremes` returns
   an extreme only where exactly one weekday holds it, and reports `tie`.
   `recommendations.service.ts:243` already gated its staffing advice on
   `bestDay !== worstDay`, so the fix strictly widens a guard that was already
   there.

**Found by the second pass, 2026-09-03 — OUTSIDE this page's paths:**

5. **No analytics endpoint returns hour-of-day grain**, so a weekday × **hour**
   heat map — the shape the founder named first — cannot be drawn honestly.
   `pos_checks.opened_at` carries the timestamp and `table-analytics.service.ts`
   already loads it (`loadChecks`, :98-117); an endpoint bucketing non-voided
   checks by `(weekday, hour)` would make it real, and the page's `matrix`
   renderer already exists. Weekday × week is built because `pos-revenue` really
   does return a date per row. **Not built**: a new endpoint is outside the three
   fixes this pass was scoped to.
6. **A global rule in the app's stylesheet paints every `<select>`
   `background: white !important; color: #1F2937 !important`** (and a charcoal
   pair under `.dark`), overriding the house tokens on any form control on any
   Mudavym page: `apps/web/src/styles/globals.css:433-438`, with the `.dark`
   counterpart at `:464-468`. Measured in the browser on 2026-09-03, then
   located in source. This page beats it
   locally with a more specific `!important` pair (`reports-next.css`,
   `.rp-page .rp-select`), which is a patch, not a fix — the global belongs in
   the foundation's own audit.

**Known limitations inside this page's own build:**

- **Dragging and resizing a cutting is pointer-only.** `react-grid-layout`
  exposes no keyboard affordance, and the shipping canvas has the same
  limitation. Everything else on the sheet is keyboard-reachable (every chip,
  filter, window picker, "Show instead", "Draw as", "Take off", "Add a cutting",
  "Show the working" and the ⌘K palette are real controls with visible focus
  rings), and the default arrangement is usable without ever entering Arrange. A
  keyboard path — move/resize the focused cutting with the arrow keys while
  arranging — is the honest fix and is not built.
- **There is no cancel while arranging.** "Rule it off" saves; "Put it all back"
  resets to the house sheet. A reader who swaps a cutting to see what it holds
  and then wants their old sheet must swap it back by hand.
- **`basket` (pairings) and `vendor-scorecard` are real endpoints with no
  catalogue entry.** Their payload shapes were not read closely enough this pass
  to write a decoder that could not silently guess a field name — and a guessed
  field renders an em dash that means "we did not look", which is the one dash
  this page must never print. §13.15.

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

**Ten live registers** in the catalogue, all authenticated and tenant-keyed,
plus the writing desk that is honest about having none. Seven drawings, offered
per register only where they are true of its data. Every register renders four
distinct states, every cutting prints its window and can print the server's own
`basis` sentence, and both the subject and the drawing of every cutting are the
reader's choice and persist with the layout. 36 tests hold the honesty rules,
the two switches and the drag/resize contract (31 render-contract in
`ReportsNext.test.tsx`, 5 canvas in `Sheet.test.tsx`).

**And three gateway shapes that were reporting absence as fact** — `financial`
COGS/revenue, the forecast total, the seasonality tie-break — are fixed at the
source rather than papered over here (§9.2-9.4), each with a spec and each
verified live with curl.

**Why not "complete":** the report writer is still absent (§13.2); goals has no
cutting yet (§13.6); two real endpoints are catalogued nowhere (§9); no endpoint
has hour grain, so the weekday × hour heat map the founder named first cannot be
drawn (§9.5). The shipping page keeps its monthly reconciliation and data-tables
sections, which the redesign deliberately does not carry (§1b).

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/analytics/insights/:rid` (+`?refresh=true`) | JWT (class, `analytics/analytics.controller.ts:84`) | same file | Generated insights (347-type generator) |
| GET/POST | `/analytics/goals/:rid` | JWT | `analytics.controller.ts` | Goals + progress |
| GET/POST | `/analytics/recommendations/:rid/actions`, `…/action` | JWT | `analytics.controller.ts` | Server-side hide/pin disposition |
| GET | `/analytics/table-performance/:rid` | JWT | `analytics.controller.ts` | Seating density |
| GET/PATCH | `/users/:userId/preferences` | JWT | `user-preferences` module | Canvas layout + block set |
| GET | `/inventory/:rid` family | JWT | `inventory` module | Stock for the inventory blocks |
| GET | `/procurement/orders` | JWT | `procurement.controller.ts` | Order metrics |
| GET | `/wines?ids=` | JWT | `wines` module | Names for ids |
| GET | **AI Command Palette** → `/analytics/insights/:rid` | JWT | `analytics.controller.ts:292` | ~~No request is made~~ — corrected 2026-09-02: it queries the real feed via `useEngineInsights` (`AICommandPalette.tsx:1-27`) |
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
| Redesign: till revenue · pacing · weekday shape · forecast · quadrants · capital efficiency · the room · servers · reorder list | `pos-revenue` · `cashflow` · `seasonality` · `forecast` · `menu-engineering` · `financial` · `table-performance` · `waiters` · `inventory-science` (see §4) | Yes — and three of the four honesty caveats in §9 were fixed at the source on 2026-09-03 |
| Generated reports | **none** — and the generator here does not even attempt one. ~~the only `generated_reports` writer is `/communications`~~ → as of 2026-08-26 (OD-81) `/communications` no longer calls it either: the "Generate Now" handler was deleted for claiming success it did not have. `POST /reports/generate` remains the table's only writer in the repo, with **no caller in the product**. Scoping for a real generator: [[OD-81-REPORT-GENERATOR-SCOPING]] | No |

### Writes

| Write | Downstream reaction |
|---|---|
| `PATCH /users/:id/preferences` | Canvas layout persists per user across devices (`Reports.tsx:187,466`) |
| `POST /analytics/recommendations/:rid/action` | Manager disposition (hide/pin) persists server-side and suppresses the insight for everyone (`EngineInsightsPanel.tsx:163-170,281,309`) |
| `POST /analytics/goals/:rid` | Goal appears in the goals block and in insight generation |
| Command palette / report generator | **none** — the palette only reads; the generator is not wired (§10) |
| Redesign: `PATCH /users/:id/preferences` key `reportsSheet` (v2) | the reader's sheet — slots, subjects AND drawings — persists across devices; deep-merged server-side, so it cannot disturb `dashboardBlocks` or any other key |

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
4. ~~`financial.cogs` / `financial.revenue` render `$0` for "no rows *or* no
   answer"; `forecast.totalForecastDemand` returns `0` when no model fits;
   `seasonality` names one day as both busiest and quietest~~ — **all three
   fixed in the gateway on 2026-09-03** (§9.2-9.4). The page no longer has to
   detect any of them: it renders `null` as an em dash, and prints the server's
   own reason under "Show the working".
5. **Still true, and outside this page**: every `<select>` in the app is painted
   white by a global `!important` rule (§9.6). On this page the two arrange
   controls override it locally; everywhere else the house tokens lose.

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
6. **Goals still has no cutting** (`GET/POST /analytics/goals/:rid`,
   `analytics.controller.ts:484,496`). Seating density
   (`table-performance`, :425) **was built** on 2026-09-03 as "The room", along
   with `waiters` and `inventory-science`. Adding goals is now one entry in
   `rp-catalogue.tsx` — a path, a decoder, a view builder and the drawings that
   are true of it — plus its id in `rp-sheet.ts`; the stored sheet is versioned,
   so existing arrangements survive it. Goals is the harder one because it also
   WRITES (`POST`), and every other cutting on this sheet is read-only.
7. Analytics truth suite — carried-forward unbuilt scope
   (`v3.0-TECH-DEBT.md:322-324`).
8. Rebrand export artifacts (§7) — shipping page only.

### Outside this page's paths, needed by the rebuild (see §9)

9. ~~`scripts/check_no_seeded_defaults.py`: add
   `Path("apps/web/src/pages/reports/next")` to `SCAN_ROOTS`~~ — **it was
   already there** (`:199`, added by the wave commit `9b6607e2`). Struck
   2026-09-03; see §9.1 for why the finding was wrong when it was written.
10. ~~`analytics.service.ts`: return `null` rather than `0` for
    `financial.cogs` / `financial.revenue` and `forecast.totalForecastDemand`~~
    — **done 2026-09-03** (§9.2-9.3).
11. ~~`advanced-analytics.service.ts`: return `null` for `seasonality.bestDay` /
    `worstDay` when no weekday is separable~~ — **done 2026-09-03** (§9.4).
12. **Nav**: none needed — `/reports` is already in the sidebar
    (`components/layout/Sidebar.tsx:99`) and the route already gated
    (`App.tsx:306`).
13. **An hour-grain sales endpoint**, for the weekday × hour heat map the
    founder named first (§9.5). Shape: `GET /analytics/pos-hours/:rid?days=`
    returning non-voided `pos_checks` bucketed by `(weekday, hour)` with a count
    and a total per bucket, and a `basis` naming the window. The page's `matrix`
    renderer and its blank-means-unrecorded rule already exist; this is the only
    missing half.
14. **Named house layouts** — DESIGN-FOUNDATION §6's "a house layout, not an
    empty one" ("Before service", "Buying week"). Now cheap: a layout is
    `{ id, slot, graph }[]` and the codec is versioned. Held this pass so two
    per-cutting switches could land without a preset menu burying them.
15. **Catalogue `basket` and `vendor-scorecard`** (`analytics.controller.ts:460`,
    `:624`) once their payload shapes have been read line by line (§9).
16. **Foundation**: the global `select { background: white !important }` rule
    (`apps/web/src/styles/globals.css:433-438`, `.dark` at `:464-468`; §9.6)
    overrides the house tokens on every Mudavym page. This page patches it
    locally; the rule itself should be scoped or dropped.
