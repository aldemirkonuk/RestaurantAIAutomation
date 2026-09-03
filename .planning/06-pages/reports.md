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
- **A catalogue of thirteen analyses**, each an endpoint the gateway actually
  serves (§4). Ten lie on the default sheet; `seats`, `service` and `restock`
  are one click away.
- **Move and resize a cutting from the keyboard** (fourth pass): Tab to a
  cutting's **Move** grip, Space to pick it up, arrow keys to move one grid
  unit, Shift+arrow to resize, Enter to place, Escape to put it back — with a
  live region announcing the position the ruling GAVE. Every one of those ten
  outcomes is also a real button (the placing bar), so a pointer that cannot
  drag has the same reach (WCAG 2.2 SC 2.5.7).
- **A ghost outline** marks where a picked-up cutting started, so "Escape puts
  it back" names a place the reader can see.
- **Named house layouts** — "The house sheet", "Before service", "Buying week",
  "Month end". Applying one writes the DRAFT, never the saved sheet: it is a
  starting point you then edit.
- **The Goals desk** (`goals`, on the default sheet): every goal against its own
  target with the SERVER's own `progressPct`, pace, days left and Holt
  projection; set, edit and archive in place; and **"Ask the book"** — the
  assistant picks which catalogued analysis shows a goal, validated against a
  closed catalogue on both sides, and proposes it for the reader to place.
- **"Against ourselves"** (`bench`, on the default sheet): this house against
  its own past — buying this month against last, the week's own extremes, each
  goal against its baseline — and one sentence saying plainly that no other
  house's books are in the comparison.
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
| Goals | What this house said it would do, and how far along it is | each goal from the day it was set | table (the desk) · bars · one figure |
| Against ourselves | This house against its own past — and that no peer is in the data | 180d buying · 90d weekdays · each goal | bars · table · one figure |
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

- **Move** any cutting by dragging it anywhere on the ruling, while arranging —
  or from the keyboard (grip → Space → arrows → Enter), or with the placing
  bar's buttons, with no drag and no keyboard.
- **Resize** any cutting by pulling its bottom-right corner, while arranging —
  or with Shift+arrow, or with the four size buttons.
- **Start from a named house layout** and then edit it into your own.
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
- **Set, edit and archive a goal** on the goals desk (owners and managers), and
  ask the book which catalogued analysis to put on the sheet to watch it.

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
  "Add a cutting", "Show the working", every house layout and every goal control
  is a real control with a visible focus ring, reachable by Tab.
- **Arranging** (fourth pass): Tab reaches each cutting's **Move** grip;
  Space or Enter picks it up; arrows move one grid unit; Shift+arrow resizes;
  Enter or Space places; Escape puts it back. An `aria-live="assertive"` region
  announces the resulting position after every step.

**What it still cannot do, and why**

- ~~**Move or resize a cutting from the keyboard.**~~ **BUILT 2026-09-03**
  (fourth pass). `react-grid-layout` still exposes no keyboard affordance — its
  own request for one, react-grid-layout#936, went stale and was closed
  unimplemented — but its layout is a CONTROLLED prop and this page already
  holds it, so the keyboard writes the same draft the pointer writes and runs
  the library's own `moveElement` + `compact` to do it. No new dependency.
  `rp-arrange.ts`.
- **Draw a weekday × hour heat map.** No analytics endpoint returns hour-of-day
  grain today — `pos_checks.opened_at` would have to be bucketed by hour in the
  gateway first (§13.13). Weekday × week is offered because `pos-revenue` really
  does return a date per row.
- **Discard an arrangement mid-edit.** "Rule it off" saves and "Put it all back"
  resets to the house sheet; there is no cancel. Escape cancels a single
  keyboard MOVE, which is not the same thing. Adding a fourth button was not
  worth it until the founder says it is.
- **Compare this house with any other house.** No peer set exists — Mudavym
  holds one tenant's books (memory: production-tenant-shape). "Against
  ourselves" says so in words rather than drawing a median nobody measured.
- **Enforce the goals-desk role gate server-side.** The analytics routes carry
  `JwtAuthGuard` at class level and no role guard; the desk hides its controls
  from a role that is not owner or manager, which is a courtesy, not an
  enforcement (§9.8).
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
| `rp-lift` | `tuck` 300ms | a cutting's shadow rising while it is dragged **or held from the keyboard**; duration + easing injected as `--rp-tuck` from the token, so the curve on screen IS `tuck` |
| `rp-ink` | `ink` 160ms | hover/focus micro-states on cuttings, chips, buttons, links; nothing translates |
| `rp-working` | `turn` 420ms | "Show the working" — the server's `basis` sentences on `grid-rows 0fr→1fr` |
| `rp-ask` | `settle` 320ms | the ⌘K palette panel arriving |
| `rp-sheen` | — (not a token) | skeleton bars while a register is genuinely in flight; identical to the dashboard's `skel-sheen`. Never shown for an unknown |

The fourth pass added the keyboard path and **no new motion**: the ghost and the
placing bar appear and vanish with the pick-up, and a cutting moved by an arrow
key does not tween between grid positions — a tweened cutting would be somewhere
the live region says it is not.

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

### Fourth pass, 2026-09-03

**What the founder asked**, verbatim:

> - the Goals section that owners/managers decide, and it can be edited (will be
>   using AI to create the analytics and their wanted feature if not already
>   created), and then they will have access to edit change as they like. Will be
>   available to visible.
> - Keyboard drag and resize are not supported by the grid library; everything
>   else is keyboard-reachable. research web find a way to be able to do that,
>   engineering part is important research and analyze — if found ways create me
>   a sketch for it
> - For competitor lens, I understand it. but also it s a great feature to have,
>   but it has to be somehow editable for personalized screens.

#### 1. Keyboard drag and resize — the research, and why it needed no dependency

**The claim in §9 was true and the conclusion drawn from it was wrong.**
`react-grid-layout` still exposes no keyboard affordance; its own request for one
([react-grid-layout#936](https://github.com/react-grid-layout/react-grid-layout/issues/936),
opened 2019 — *"you should be able to tab to the resize handle, hit space or
enter to activate it, and then use the arrow keys to resize"*) went stale and was
closed unimplemented. What does not follow is that the limitation is the
library's to fix. Measured in the installed package rather than inferred from the
docs (`apps/web/node_modules/react-grid-layout@2.2.2/dist/chunk-XM2M6TC6.mjs`):

- `ResponsiveGridLayout` re-derives its internal layout whenever the `layouts`
  prop stops deep-equalling the previous one (`derivedLayout`, `:1348-1361`) —
  so the prop is **controlled**, and a parent that writes a new slot re-renders
  the grid at that slot without touching the library's event system.
- The library's own pointer path is two calls: `moveElement(...)` then
  `compactor.compact(...)` (`:800-811` for a drag, `:925-930` for a resize), and
  **both are exported from `react-grid-layout/core`**. The keyboard therefore
  runs the *same arithmetic the mouse runs*, not an approximation: a keyboard
  move and a dragged move to the same square produce a bit-identical layout,
  because they are the same function.

`apps/web/src/pages/reports/next/rp-arrange.ts` is that, and nothing else was
added to `package.json`.

**Where the interaction came from.** `@dnd-kit`'s `KeyboardSensor`
(<https://dndkit.com/api-documentation/sensors/keyboard>) is the canonical
implementation of the pick-up model, and its defaults are taken verbatim:
`start: ['Space','Enter']`, `end: ['Space','Enter']`, `cancel: ['Escape']`.
`react-aria`'s drag-and-drop (<https://react-aria.adobe.com/dnd>) contributes the
**drag affordance** — a real focusable named control rather than a `tabIndex` on
the panel — which is exactly the defect
[grafana#79627](https://github.com/grafana/grafana/issues/79627) records against
Grafana's dashboard, built on this same library: panels carry `tabIndex="0"` with
no accessible name and *"keyboard users are unable to interact with the move
panel functionality"*. Neither library was adopted: running either beside RGL
means two drag systems that must agree about collision and compaction on every
frame. React Flow's accessibility guide
(<https://reactflow.dev/learn/advanced-use/accessibility>) uses arrows to move a
selected node and **Shift for a bigger step**; Shift is resize here instead,
because one unit of a twelve-column ruling is already a coarse step and resize
has no other keyboard route at all.

**Why there is also a bar of buttons.** WCAG 2.2 SC 2.5.7 Dragging Movements
(<https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html>) requires
that *"all functionality that uses a dragging movement for operation can be
achieved by a single pointer without dragging"*, and its Understanding document
states that keyboard equivalence (2.1.1) and pointer operability *"are evaluated
independently"* — so the arrow keys alone do **not** satisfy it. The placing bar
gives every one of the ten outcomes a real button, which is the W3C's own listed
sufficient technique (G219; "up/down buttons to reorder list items").

**The strongest counter-argument, and why it loses here.** Atlassian's
`pragmatic-drag-and-drop` accessibility guidance
(<https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines>)
argues the opposite outright: do not build directional keyboard drag, give each
item an **action menu of named outcomes** instead — *"directional arrow movement
does not translate well to all experiences"*, menus avoid screen-reader mode
switching, and they user-tested as more discoverable. It is the better answer for
a board, where destinations have names ("move to Doing", "move to top"). It loses
on a free twelve-column canvas because the outcomes ARE the coordinates: a menu
would have to enumerate twelve columns times n rows, which is not a menu, and a
short list of swaps offers strictly less than the pointer can do — a second-class
path. Sketch 096 direction C draws it anyway, so the founder can see the trade.
What their argument DID win is the announcement discipline: a live region that
names the item and both its old and its new position.

**The one house rule this adds — announce the position the SHEET gave.**
Vertical compaction means a nudge can be undone by the ruling, and a nudge into
an occupied square displaces a neighbour. Every sentence is built from the layout
*after* `compact()` has run, read back out of the result; when the result equals
what was there before it says *"did not move"*. Announcing the intent would be
the page reporting its own request as an outcome — the same fault as reporting an
absence as health (ADR 0020). `rp-arrange.test.ts` pins it (21 cases).

**Sketch**: `.planning/sketches/096-reports-keyboard-arrange/` — index plus three
directions (the built grip-and-placing-bar, the compass card, the move-to menu),
each showing the focus ring, the ghost outline and the announcement.

#### 2. The Goals section

`GET/POST /analytics/goals/:rid` and `PUT …/status` already existed
(`analytics.controller.ts`); three things did not, and were built:

| Route | Why it did not exist before, and what it fixes |
|---|---|
| `GET /analytics/goals/:rid/progress` | `listGoals` returns the STORED `current_value`, written at creation as the baseline and refreshed only when one goal's progress is opened (`goals.service.ts:359`). A bar drawn off the list reads "nothing done yet" for a goal that is half met — an absence rendered as a measurement. This recomputes each one, caps at six and **reports the cap** rather than applying it silently |
| `PATCH /analytics/goals/:rid/:goalId` | There was no edit route at all; only status. `metricKey` is deliberately NOT editable — the baseline was measured against the old metric and every figure is counted from it — and the form says so |
| `POST /analytics/goals/:rid/:goalId/cutting-spec` | "AI will create the analytics" (below) |

**"AI will create the analytics", read honestly.** The forbidden reading is a
model writing a sentence or a figure that reaches a chart: the insight engine is
deterministic and its sentences are templates over computed arithmetic, which is
the whole reason a reader can trust them (ADR 0020/0051). The built reading is a
model **configuring** that engine. `apps/api-gateway/src/analytics/report-cuttings.ts`
holds a frozen catalogue of the eleven analyses a model may name, with the
drawings that are true of each and the windows the page offers;
`checkCuttingSpec` validates the model's three enum values and **refuses**
anything outside it rather than repairing it — a repaired spec would be shown to
the reader as the assistant's proposal while being something else. That refusal
is the lesson `ux-optimizer.service.ts` already learned the hard way
(`filterProposals`: *"the parser used to accept any string, so an invented kind
was written straight into `ux_proposals.kind` as though it were real"*). The one
free-text field the model returns is its reason, printed as *"the assistant's
words, not a measurement"* and never as a caption, an axis or a figure. The call
goes through `common/model-client` with NF-A metadata (`taskType:
"goal_cutting_spec"`), so it is attributable and separable in the spend ledger.
Without `ANTHROPIC_API_KEY` the route answers `available: false` with the reason
and proposes nothing — no hand-written "sensible" fallback, because a fallback
dressed as an assistant's answer is the fabrication this seam exists to prevent.
The page validates the returned id AGAIN against its own catalogue, so a drift
between the two copies surfaces as a sentence, never as a blank square.

#### 3. Competitor lens — both readings, on the founder's call

- **(a) "the lens ideas landing as cuttings a person can keep or remove per
  personal sheet" is ALREADY TRUE, and here is where.** Every §6 idea that got
  built is a catalogue entry, and the catalogue is the "Show instead" list; the
  arrangement — which cuttings, where, how drawn — is stored per USER under
  `reportsSheet` (§8), not per restaurant. §6's *"blocks that cite their
  working"* is "Show the working" (the server's own `basis`). §6's *"a house
  layout, not an empty one"* was the one "need it: now" idea still missing and
  is now built: four named layouts that write the DRAFT, so they are a starting
  point you then edit — which is the literal reading of *"editable for
  personalized screens"*.
- **(b) The benchmark cutting is built as "Against ourselves"** — one call to
  `GET /analytics/overview/:rid`, drawing only comparisons the SERVER computed:
  buying this 30 days against the 30 before with the engine's own
  `paceDeltaPct`, the week's own extremes (withheld on a tie), and each active
  goal's baseline → now → target printed side by side with **no delta computed
  here**, because both operands are on screen and the page has no business
  making a claim about the distance. It states in words that **no other house's
  books are in the comparison**, and points at the one median the engine does
  publish (the menu-engineering crosshair) rather than duplicating it. There is
  no peer set to draw and none was invented.

#### Two alternative directions considered and not built (this pass)

1. **The compass card** (sketch 096-B) — the same handlers behind a floating
   3×3 pad anchored to the held cutting, with named outcomes underneath. Calmer
   inside a small cutting; it costs a floating layer that must chase a cutting
   which moves on every keystroke, and can end up off-screen at the foot of a
   long sheet. It is a swap, not a rewrite, if the founder prefers it.
2. **A role guard on the goals write routes.** The desk gates its controls on
   `activeRole`, which is a courtesy. Adding `RolesGuard` to the analytics
   controller would gate `EngineInsightsPanel`'s existing goal POST on the
   shipping page too — a behaviour change to a surface this pass does not own.
   Filed as §9.8 and §13.17.

**Substituted or left out, and why.** (a) The goals desk lives on the **Table**
drawing, because it is a list of records with a form, and a form is not a
picture; the other two drawings say so in one line rather than hiding the desk
silently. (b) `suggestedActions` (the insight sentences `getGoalProgress`
already returns) are not rendered — "The reading" is the cutting for engine
sentences, and printing four of them inside every goal would be the same feed
twice. (c) No `HoldToApprove`: nothing here commits anything to another party.

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
  `rp-registers-trade.tsx` + `rp-registers-house.tsx` + `rp-registers-bench.tsx`
  + `rp-registers-goals.tsx` (**the thirteen analyses**: path, window, truthful
  drawings, decoder and view builder each; the last two added in the fourth
  pass — the benchmark, and the goals desk, which is the only one that writes),
  `rp-catalogue.tsx` (assembles them; the only file that names all thirteen),
  `rp-arrange.ts` (**the keyboard's half of the canvas** — RGL's own
  `moveElement`/`compact` over the same controlled layout, plus every sentence
  the live region reads), `Placing.tsx` (the grip, the placing bar and the
  announcer), `useGoalsDesk.ts` (the goals desk's four writes and the one
  question),
  `rp-view.ts` (the one shape every analysis reduces to), `rp-plot.tsx`
  (recharts kit, the heat-map table, the four honest states, "show the
  working"), `ReadingList.tsx` (the insight feed's own stateful list),
  `AskTheBook.tsx` (⌘K palette + ranker),
  `useReportsNextData.ts` (`useQueries` over whatever is on the sheet + the v3
  sheet codec + the desk, so the page has exactly one data seam), `rp-sheet.ts`
  (ids, drawings, slots, the house arrangement, the named house layouts and
  their packer), `rp-format.ts`, `reports-next.css`, `MOTIONS.md`,
  `ReportsNext.test.tsx` (50 tests), `rp-arrange.test.ts` (21 — the keyboard
  arithmetic and every announcement) and `Sheet.test.tsx`
  (5 — the pointer drag/resize contract).
  `Cuttings.tsx` was **deleted** in the second pass — its eight bespoke bodies
  are now `view` builders in the two register files. Route already gated at
  `App.tsx:306`.
  **Size, honestly:** 24 files; 19 of them source, totalling **5,759 lines**
  (counted 2026-09-03 after the fourth pass, excluding the three test files, the
  CSS and `MOTIONS.md`; pass one shipped 2,213 and pass two 3,608). That is far
  past the p4 brief's "~900 lines across its files", and it keeps growing
  because the page keeps being asked to do more: thirteen analyses against
  eight, seven drawings against one apiece, a register that writes, and a second
  input path for the whole canvas. The response has been to split rather than to
  cut — the largest source files are `rp-registers-house.tsx` (662) and
  `rp-registers-goals.tsx` (576), and both are declarative register definitions
  rather than logic; the keyboard engine is 477 lines of which roughly half is
  the research it encodes. Recorded here rather than left for a reader to
  discover, and it is a real argument for splitting the catalogue into its own
  directory the next time this page is opened.

## 4. Endpoints

The widest analytics consumer among the 17 core-ops pages. Atlas rows:
[ENDPOINTS](../foundation/ENDPOINTS.md):10 (`analytics`, 39 — atlas's **all-unguarded warning**
is stale; guarded at class level since 2026-08-24 (#31),
`apps/api-gateway/src/analytics/analytics.controller.ts:85`),
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
`apps/api-gateway/src/analytics/analytics.controller.ts:85`):**

| Method | Path | Cutting | Verified at |
|---|---|---|---|
| GET | `/analytics/insights/:rid?limit=40` | The reading · Ask the book | `analytics.controller.ts:293` |
| GET | `/analytics/pos-revenue/:rid?days=` | Through the till | `analytics.controller.ts:738` |
| GET | `/analytics/cashflow/:rid` | Spend pacing | `analytics.controller.ts:711` |
| GET | `/analytics/seasonality/:rid` | The week's shape | `analytics.controller.ts:701` |
| GET | `/analytics/forecast/:rid?horizon=14` | What's coming | `analytics.controller.ts:210` |
| GET | `/analytics/menu-engineering/:rid` | Margin against movement | `analytics.controller.ts:681` |
| GET | `/analytics/financial/:rid` | Figures of record | `analytics.controller.ts:127` |
| GET | `/analytics/table-performance/:rid?sinceDays=90` | The room (added 2026-09-03) | `analytics.controller.ts:426` |
| GET | `/analytics/waiters/:rid?sinceDays=90` | Who served it (added 2026-09-03) | `analytics.controller.ts:444` |
| GET | `/analytics/inventory-science/:rid` | What to buy back (added 2026-09-03) | `analytics.controller.ts:157` |
| GET | `/analytics/goals/:rid/progress?status=active` | Goals — **new route, fourth pass** | `analytics.controller.ts:518` |
| GET | `/analytics/overview/:rid` | Against ourselves (added 2026-09-03) | `analytics.controller.ts:788` |
| PATCH | `/analytics/goals/:rid/:goalId` | Goals desk, edit — **new route, fourth pass** | `analytics.controller.ts:542` |
| PUT | `/analytics/goals/:rid/:goalId/status` | Goals desk, archive | `analytics.controller.ts:603` |
| POST | `/analytics/goals/:rid` | Goals desk, set a goal | `analytics.controller.ts:497` |
| POST | `/analytics/goals/:rid/:goalId/cutting-spec` | "Ask the book" — **new route, fourth pass**; model-configured, catalogue-validated | `analytics.controller.ts:563` |
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
- **Redesign arrangement** persists per USER (not per restaurant) under the
  preference key `reportsSheet` — **v3 since 2026-09-03** (fourth pass). v3 adds
  the `goals` and `bench` ids and one rule about a MISSING id: `encodeSheet`
  writes every id, on or off, so an id absent from a stored blob cannot mean
  "the reader took it off" — it can only mean the analysis did not exist when
  that sheet was written. Those ids, and only those (`IDS_ADDED_IN_V3`), are put
  back on at the foot. A reader who ruled off a sheet last week therefore gets
  the goals desk the founder asked to be visible, and a reader who deliberately
  took a cutting off keeps it off. The v2 shape, unchanged, was: `{ v: 2, blocks: [{ i, x, y, w, h, g,
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
  (`apps/api-gateway/src/analytics/analytics.controller.ts:85`); the atlas row
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

- ~~**Dragging and resizing a cutting is pointer-only.**~~ **CLOSED 2026-09-03**
  (fourth pass, §1b). The library still exposes no keyboard affordance
  (react-grid-layout#936, stale and closed), but its `layouts` prop is
  controlled and its `moveElement`/`compact` are exported from
  `react-grid-layout/core`, so the keyboard runs the pointer path's own
  arithmetic over the same draft: `apps/web/src/pages/reports/next/rp-arrange.ts`,
  `Placing.tsx`. No new dependency. A single-pointer path (the placing bar's ten
  buttons) ships with it, because WCAG 2.5.7 is evaluated independently of 2.1.1.
- **There is no cancel while arranging.** "Rule it off" saves; "Put it all back"
  resets to the house sheet. A reader who swaps a cutting to see what it holds
  and then wants their old sheet must swap it back by hand.
- **The goals-desk role gate is client-side only.** `useGoalsDesk` hides the
  set/edit/archive/ask controls unless `activeRole` is `owner` or `manager`
  (`useAuth().activeRole`, from `user_restaurant_access`). The routes themselves
  carry only the class-level `JwtAuthGuard`
  (`apps/api-gateway/src/analytics/analytics.controller.ts:85`) and no
  `RolesGuard`, so a `staff` token could still POST a goal by hand. **Not
  fixed here**: adding a role guard to the analytics controller would also gate
  `EngineInsightsPanel`'s existing goal POST on the shipping page, which is a
  behaviour change to a surface this pass does not own. §13.17.
- **`cashflow.spendLast30d` / `spendPrev30d` are unconditional sums, and a
  failed loader degrades to `[]`.** Measured live on the dev tenant on
  2026-09-03: both windows came back `0` while `openOrderCount` was `0` too, so
  "bought nothing for two months" and "the `procurement_orders` read did not
  answer" render identically. `loadOrders` logs the failure
  (`advanced-analytics.service.ts:125-146`, `logQueryFailure`) but the payload
  carries no signal of it, and `toDaily` zero-fills on top
  (`:162-178`). This is the SAME shape §9.2 fixed for `financial.cogs`, in a
  lens that pass fixed around. **Not fixed here**: `getCashflow` also feeds the
  "Spend pacing" cutting and `getOverview`, so the fix is a payload change with
  three readers and belongs in its own pass with its own spec — the honest fix
  is a `basis.rows` count and a `null` when the loader returned nothing at all.
  Both cuttings say the ambiguity in words in the meantime
  (`rp-registers-bench.tsx`). §13.19.
- **The "Ask the book" happy path was not exercised against a live model.** The
  local gateway's Anthropic key has no credit balance (measured with curl,
  2026-09-03: `Anthropic 400: Your credit balance is too low`), so what was
  proven live is the DEGRADE path — the route answered `available: true`,
  `spec: null`, with the reason, rather than throwing. The parse-and-validate
  path is covered by `goal-cutting-spec.spec.ts` against a stubbed client.
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

**Twelve live registers** in the catalogue, all authenticated and tenant-keyed,
plus the writing desk that is honest about having none. Seven drawings, offered
per register only where they are true of its data. Every register renders four
distinct states, every cutting prints its window and can print the server's own
`basis` sentence, and both the subject and the drawing of every cutting are the
reader's choice and persist with the layout. **The whole canvas has a second
input path**: a keyboard and a set of buttons that run react-grid-layout's own
move/compact arithmetic over the same controlled layout, with a live region that
reports the position the ruling gave rather than the one that was asked for. One
register now WRITES (the goals desk), and the assistant attached to it may
configure the deterministic engine but never speak a figure. 76 tests hold all
of it (50 render-contract in `ReportsNext.test.tsx`, 21 keyboard arithmetic and
announcements in `rp-arrange.test.ts`, 5 pointer canvas in `Sheet.test.tsx`),
plus 25 in the gateway (`goal-cutting-spec.spec.ts`).

**And three gateway shapes that were reporting absence as fact** — `financial`
COGS/revenue, the forecast total, the seasonality tie-break — are fixed at the
source rather than papered over here (§9.2-9.4), each with a spec and each
verified live with curl.

**Why not "complete":** the report writer is still absent (§13.2); two real
endpoints are catalogued nowhere (§9); no endpoint has hour grain, so the
weekday × hour heat map the founder named first cannot be drawn (§9.5); the
goals-desk role gate is client-side only (§9.8); and there is no peer benchmark,
because there is no peer data (§13.16). The shipping page keeps its monthly reconciliation and data-tables
sections, which the redesign deliberately does not carry (§1b).

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/analytics/insights/:rid` (+`?refresh=true`) | JWT (class, `analytics/analytics.controller.ts:85`) | same file | Generated insights (347-type generator) |
| GET/POST | `/analytics/goals/:rid` | JWT | `analytics.controller.ts` | Goals + progress |
| GET/POST | `/analytics/recommendations/:rid/actions`, `…/action` | JWT | `analytics.controller.ts` | Server-side hide/pin disposition |
| GET | `/analytics/table-performance/:rid` | JWT | `analytics.controller.ts` | Seating density |
| GET/PATCH | `/users/:userId/preferences` | JWT | `user-preferences` module | Canvas layout + block set |
| GET | `/inventory/:rid` family | JWT | `inventory` module | Stock for the inventory blocks |
| GET | `/procurement/orders` | JWT | `procurement.controller.ts` | Order metrics |
| GET | `/wines?ids=` | JWT | `wines` module | Names for ids |
| GET | **AI Command Palette** → `/analytics/insights/:rid` | JWT | `analytics.controller.ts:293` | ~~No request is made~~ — corrected 2026-09-02: it queries the real feed via `useEngineInsights` (`AICommandPalette.tsx:1-27`) |
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
| Redesign: `PATCH /users/:id/preferences` key `reportsSheet` (v3) | the reader's sheet — slots, subjects AND drawings — persists across devices; deep-merged server-side, so it cannot disturb `dashboardBlocks` or any other key |
| Redesign: `POST /analytics/goals/:rid`, `PATCH …/:goalId`, `PUT …/:goalId/status` | the goals desk. A goal appears in the desk, in "Against ourselves", and in insight generation |
| Redesign: `POST /analytics/goals/:rid/:goalId/cutting-spec` | **no row is written.** One model call through `common/model-client` (NF-A `task_type: goal_cutting_spec`, so it lands in the spend ledger) returning three enum values the gateway validates against a frozen catalogue. Nothing is applied: the reader places the proposed cutting, or does not |

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
6. ~~**Goals still has no cutting**~~ — **DONE 2026-09-03** (fourth pass):
   `goals` is a catalogue entry on the default sheet, reading a NEW
   `GET /analytics/goals/:rid/progress`, and it writes (set / edit / archive /
   ask the book). The original note, kept because its reasoning still holds for
   the next writing cutting: (`GET/POST /analytics/goals/:rid`,
   `analytics.controller.ts:485,497`). Seating density
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
14. ~~**Named house layouts**~~ — **DONE 2026-09-03** (fourth pass). Four:
    "The house sheet", "Before service", "Buying week", "Month end". A layout is
    a LIST OF IDS and carries no geometry of its own — `packSlots` lays each one
    out at the size it is declared with, which keeps a hand-written slot table
    (and `check_no_seeded_defaults.py` S1's shape) out of the file. Applying one
    writes the draft, never the saved sheet.
15. **Catalogue `basket` and `vendor-scorecard`** (`analytics.controller.ts:461`,
    `:691`) once their payload shapes have been read line by line (§9).
16. **A peer benchmark that is not ourselves** — DESIGN-FOUNDATION §6 files it
    "later", and it is still not buildable: no other house's books are in this
    product (memory: production-tenant-shape — ten restaurant rows, one real
    tenant). "Against ourselves" occupies the shape and says so. What a real one
    would need, in order: a consented, anonymised cohort; a cohort size floor
    below which a median is re-identifiable; and a basis sentence naming the
    cohort and its n. None of the three is a page change.
17. **A role guard on the goals write routes** (§9). `POST /analytics/goals/:rid`,
    `PATCH …/:goalId` and `PUT …/status` should be owner/manager-only server
    side. The guard exists (`auth/guards/roles.guard.ts`); applying it touches
    the shipping page's existing goal POST, so it is a decision, not a patch.
19. **`getCashflow` must distinguish "no delivered order" from "the read did not
    answer"** (§9). Shape: count the rows the loader actually returned, publish
    it in `basis`, and return `null` for `spendLast30d`/`spendPrev30d` when the
    loader came back empty AND the query errored — the same repair
    `analytics.service.ts:428-441` already made for `financial.cogs`. Three
    readers: "Spend pacing", "Against ourselves" and `getOverview`.
20. **Foundation**: the global `select { background: white !important }` rule
    (`apps/web/src/styles/globals.css:433-438`, `.dark` at `:464-468`; §9.6)
    overrides the house tokens on every Mudavym page. This page patches it
    locally; the rule itself should be scoped or dropped.
