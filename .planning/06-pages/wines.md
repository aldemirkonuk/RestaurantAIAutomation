---
type: page
route: /wines
slug: wines
softwares: [wine-library-sommelier]
component: apps/web/src/pages/WineLibrary.tsx   # legacy, flag OFF
component_next: apps/web/src/pages/cellar/next/CellarNext.tsx  # flag ON — /cellar + 4 children
audience: owner
tier: core
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: hollow
status: documented
updated: 2026-09-25
links: ["[[PAGE-CONTRACT]]", "[[TIER-MAP]]", "[[orders]]", "[[inventory]]", "[[providers]]"]
---

# /wines — Wine Library → the Cellar

> **This one note covers the whole cellar family.** The IA was decided
> 2026-08-29/30: **`/cellar` is the parent surface** (what is in the building)
> with **`/wines` · `/beer` · `/whiskey` · `/cocktails`** as its children. All
> five render from one component, `CellarNext`, taking a `category` prop
> (`undefined` = the parent). The note keeps the filename `wines.md` because
> `/wines` is still the route the vault's link graph points at and the
> retire-to-write rule (CLAUDE.md §4) forbids spawning four more notes for one
> component; the three children have no note of their own and are documented in
> §1b/§9 here. **With the flag off, `/wines` renders the legacy page byte for
> byte and `/cellar` `/beer` `/whiskey` `/cocktails` redirect to it.**

> **Part of** [[08-softwares/wine-library-sommelier|Wine Library & Sommelier]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

*Legacy (flag off):*

- **Add Wine** → (modal — AddWineSelectionModal → scanner / manual-entry flows)
- **Add to Inventory** → (modal — AddToInventoryFromLibraryModal)
- **Reorder → Contact Provider** → stages the pending order, then hard-navigates → [[orders]] `/orders`

*Mudavym cellar (flag `mudavym_design_cellar` on):*

- **Wines · Beer · Whiskey · Cocktails** (register strip, on every cellar screen) → `/wines` `/beer` `/whiskey` `/cocktails`
- **A register card** on `/cellar` → the same four routes
- **The Cellar** (breadcrumb, on every child) → `/cellar`
- **Read a menu** → (modal on this page — the existing `MenuScannerModal`; detection only, see §1a)
- **Bring into the cellar** → API `POST /api/v1/inventory/:restaurantId/items`
- **Hold to order N from <vendor>** → API `POST /api/v1/procurement/orders`, then the order is visible on [[orders]] `/orders`

## 1. Purpose
Browse the master wine catalogue as this restaurant sees it — search/filter/sort ~500
wines, see stock overlay from inventory, compare list price to market price, and add
catalogue wines into inventory. Owner/manager surface; staff can read.

## 1a. Features
- Browse the master wine catalogue as your restaurant sees it: search, 9 filters, sort cycle, view modes (~500 wines)
- Stock overlay from inventory; list price vs market price (PARTIAL: market price renders "—" until enrichment data exists)
- Add a catalogue wine into inventory
- Vendor recommendations for the selected wine
- Scan a menu photo to add wines; manual add modals
- Bulk selection and column sorting
- Live wine updates over WebSocket

**Mudavym cellar behind `mudavym_design_cellar` (OFF by default):**

- `/cellar` — the parent surface: four registers (Wines, Beer, Whiskey, Cocktails) and *In the building tonight* — bottles on hand, titles carried, titles at or under their own par, titles carried but off this read. Every figure counted from real inventory rows
- `/wines` — the register kept at full breadth: every title, eight sortable columns (Bottle · Style · Vintage · Origin · Format · List · Market · On hand), search across name/producer/grape/region/country/appellation, six filters (Style, Country, Region, Vintage, Format, Cellar) and two view modes (Register table / Shelf cards)
- The **reading stand** — a bottle opens above the register with everything the library actually knows: style, vintage, origin, format, list and market price, the producer/tasting/pairing notes, and what this house holds (on hand, its own par, the vendor on the row, when it was last counted)
- **Recalled vs reasoned** — each set of notes carries the gateway's own `data_enrichment.knowledge` mark, so a fact recorded about *this* bottle is never printed like a profile inferred from its grape and region (76% of the library is `inferred`)
- **Bring into the cellar** — a catalogue-only bottle can be booked into inventory (real write, `POST /inventory/:rid/items`)
- **Order more** — hold-to-approve sends a real purchase order (`POST /procurement/orders`); it is offered only for a bottle that already has a cellar row and a chosen vendor, because the gateway keys an order line on `inventoryId`. Vendor recommendations for the bottle mark the suggested vendors in the picker
- Live catalogue updates over WebSocket (the `wine_update` event re-reads the book)
- **PARTIAL** &middot; **Market price renders `—` for every bottle** and says why — `retail_price_avg` is null on all 442 rows and its writer has no deployed worker
- **PARTIAL** &middot; **`/beer` `/whiskey` `/cocktails` are honest empty registers** — the tables exist (`public.beverages`, `public.cocktails`) but **no gateway controller serves them**, so each child states what is missing and lists the columns the register would carry. No rows, no counts, no zeros
- **PARTIAL** &middot; **"Read a menu" detects but does not add** — `scanMenuImage` is real; neither the scanner tab nor the legacy caller writes a detected title anywhere, so the control is named for what it does and says plainly that nothing was written
- **NOT CARRIED OVER** &middot; **Not carried over: "Reorder" and "save as recurring"** — both reported success and wrote nothing (§10). Replaced by one real order path and by nothing, respectively
- **NOT CARRIED OVER** &middot; **Not carried over: the Body filter** — `body` was the constant `'medium'` on every row, so the control could only match all or none
- **NOT CARRIED OVER** &middot; **Not carried over: bulk selection and CSV export** — the export shipped six fabricated attribute columns (Body / Sweetness / Acidity / Alcohol % / Aromas / Flavors) as measured data, and that is the most damaging thing on the legacy page because it leaves the building as a file. It returns when there are real columns to export (§13)

**Second pass, 2026-09-03 — the cellar adapts to the house:**

- **The registers are the house's own, not a constant.** Seven in the vocabulary
  (Wines, Beer, Whiskey, Spirits, Cocktails, Non-alcoholic, Soft drinks); the
  parent draws only the ones this restaurant carries, and says in one line how
  that was decided and where to change it
- **Inferred, then confirmed at onboarding** (founder's decision) — inference
  reads this tenant's own `restaurant_inventory` (via `master_wine_library.beverage_kind`),
  its `menu_items` section headers and names, and its `cocktails` rows, and
  returns each register with a count, a confidence and a sentence of evidence
- **`CellarRegistersStep`** — the onboarding confirm surface, exported from this
  directory for `/get-started` to mount (§13). Shows the proposal with the
  evidence behind each line, every line editable, and records all seven at once
- **`CellarRegistersControl`** — the Settings control, exported for the settings
  register to mount (§13). Seven switches, the evidence beside each, and the
  manual-on path for a category the books cannot yet see
- **The ask, never an interrupt** — a register on with nothing behind it shows a
  persistent, dismissible **inline** notice with a **register-aware** sentence
  ("Put your beers on the menu. /inventory cannot hold a keg yet"); several at
  once collapse into **one** notice, never a stack
- **The symmetric state** — a register switched OFF while this house's books
  still hold items in it gets its own inline notice, and those items keep showing
  on the parent under a **"Not on the list"** band rather than disappearing with
  the register
- **`/beer` `/whiskey` `/cocktails` are now WIRED** — `GET /beverages/:rid?register=`
  and `GET /cocktails/:rid` are real, tenant-named, JWT-guarded reads (new gateway
  module). Spirits and Non-alcoholic open on the parent as `?register=`
- **PARTIAL** &middot; **Beer, whiskey, spirits, cocktails and non-alcoholic are
  browsable catalogues, not stock** — `restaurant_inventory` is keyed on
  `master_wine_id`, so none of them can be counted, ordered or received. Every
  one of those registers says so and shows no "On hand" column at all
- **PARTIAL** &middot; **Soft drinks have no source** — no value of
  `beverages.beverage_type` separates a cola from a kombucha (measured: the
  distinct values are whiskey, agave_spirit, beer, liqueur, amaro, sake, brandy,
  gin, spirit_other, rum, non_alcoholic, vodka, cider), so that register states
  the absence of a query rather than an empty result
- `beverage_kind` and `classification_status` now reach the browser on every
  `/wines` row, so the library's own classification is visible and countable

**Third pass, 2026-09-03 — the house's own record on the row:**

- **A register is this house's books first.** `public.house_beverage_ledger`
  (migration `20260903120000`) assembles one row per product THIS restaurant's
  own books name, across five tables that all carry a `restaurant_id`:
  `menu_items` (what we list and charge), `procurement_document_lines` on
  invoice documents (what we were charged, and when), `procurement_order_items`
  (what we ordered), `vendor_price_observations` (who quoted it, off what), and
  `pos_unresolved_lines` (what we actually sold). The shared catalogue is laid
  over that, not the other way round
- **First bought · Paid · Sold · Last quote are columns on the row**, with a
  five-mark strip showing which books name the bottle. The reading stand opens
  the whole record, and every block names the table it was read from
- **Beer · Whiskey · Spirits · Non-alcoholic · Soft drinks are real registers** —
  search, six sifts (Whose · In which book · Type · Match · plus free text) and
  ten sortable columns, over `GET /beverages/:rid/registers/:register`
- **Soft drinks are served.** No `beverage_type` can reach them, so the register
  is served by this house's menu and till alone, and says the catalogue was not
  asked rather than that the read was empty
- **Cocktails are the one register a house can WRITE** — add, amend and retire
  (`POST` / `PATCH` / `DELETE /cocktails/:rid`), soft-retire so a cocktail that
  came off in September stays a fact about the season
- **`cocktail_ingredients` has its first writer** (`PUT /cocktails/:rid/:id/ingredients`).
  It was empty because the extraction pass never ran — a fact about the
  extractor, never a reason a bartender could not type a recipe
- **A catalogue match says how strong it is** — `exact` (same words) or
  `contains` (every catalogue word inside a longer house line), marked in the
  row and explained on the stand. There is no third tier and no similarity score
- **A house line with no catalogue row keeps its record in full** — a bottle
  nobody catalogued is not a bottle nobody bought
- **House lines no register can hold are reported, not dropped** — the count and
  the first four labels, so a register never quietly returns fewer rows than the
  books contain
- **The menu lines the reader could not place, on `/cellar`** (OD-140, founder
  2026-09-25) — under the register cards: "N of the M menu lines could not be placed
  in any register", and **"Show me the N it could not place"**, which reads the lines
  (name and section) only when pressed. See §14
- **DARK / GATED** &middot; **"Count into the cellar" renders disabled on every
  row of every register**, with the gateway's own sentence beside it: every
  quantity path (`restaurant_inventory`, `inventory_lots`,
  `inventory_transactions`, `pour_events`) is keyed on `master_wine_id`, so
  stocking waits on the identity axis. **OD-113**, carried on the wire as
  `stocking.decision` so the browser cannot invent a cheerier reason
- **PARTIAL** &middot; **The house's record is dark until migration
  `20260903120000` is applied.** Measured live 2026-09-03 against :4000: all six
  registers return 200, the catalogue half renders (beer 57, whiskey 272,
  spirits 400 capped, non-alcoholic 10), and the house half returns
  `readable: false` with a reason naming that migration file. It renders as
  words, never as an empty record

**Fourth pass, 2026-09-03 — the columns, the gestures, the name and the row:**

- **Every column states what it represents**, per register and for the whole
  cellar at once — one vocabulary in `cellar-columns.ts` carrying each column's
  source table, its meaning in the operator's words, and its **measured fill**
- **A column that cannot be filled is offered, not drawn** — ABV, Format, Style,
  IBU, Age, Cask, Proof and Market are all real columns with no writer (measured
  0 rows on 2026-09-03) and sit in a "Columns not drawn" list with the figure
  beside each. An operator can turn one on and gets the em dash *with* its reason
- **Right-click a column header** (or press its caret, or `Shift+F10`) for the
  column's own menu: sort, hide, and **what this column is** — meaning, source
  table, measured fill
- **Double-click or right-click a cell** for the series behind that one figure:
  a graph and the ledger it was made of, from one read (`GET
  /beverages/:rid/row-record`, new). The founder's "order ledger when clicked on
  paid" is the lower half of that panel
- **A row opens IN PLACE**, `/inventory`'s dropdown anatomy: a fact strip, then
  cards — cost and markup, velocity, when it sells, the order ledger, quotes,
  and where this kind's facts come from
- **Everything at once** on the parent: one flat book across every register the
  house carries, with the eight columns that mean the same thing in all of them.
  It is **the default view for a house carrying three registers or fewer** and a
  button for everyone else, because it is one read per register — founder
  decision 2026-09-04. The rule is printed beside the naming rule, and an unread
  register set never opens it
- **The floor is built, over confirmed zones only** — the house's storage zones
  in the cellar's own infer-then-confirm shape: a manager confirms or renames
  each once, and only confirmed zones are drawn. Unconfirmed ones are a sentence
  with a count and the control, never a drawn room
- **PARTIAL** &middot; **No zone is confirmed anywhere yet**, so the floor draws
  nothing today and says how many are waiting. Measured 2026-09-04:
  `storage_locations` holds 4 rows across 2 tenants and all 4 carry one of the
  four seeded names. What is IN a zone is counted from the inventory rows
  assigned to it, never from `current_occupancy`, which disagrees with them
  (180/32/45 against 17/17/16 on the only tenant that has both)
- **The parent is named by what the house pours** — The Cellar (wine or
  spirits), The Bar (beer or cocktails, no wine), Drinks (no alcohol at all) —
  with the rule printed under the headline. The route stays `/cellar`
- **A live stock move is applied before the read comes back** — the figure the
  socket already carried is written into the cached row and the row flashes
  `ink`; measured transport p50 0.81 ms (real gateway) and apply p50 5 ms
- **PARTIAL** &middot; **The invoice and quote books hold 0 rows in the whole
  database**, so First bought, Paid and Last quote are structurally em dashes
  today and every panel says which book was read and found nothing. The till is
  the one book with real rows in it
- **DARK / GATED** &middot; **Live vs shadow and Par and reorder are drawn
  hatched on every expanded row**, because `restaurant_inventory` is keyed on
  `master_wine_id` (OD-113) and neither figure exists for a keg

- Curation queue: a house's provisional bottle identity is promoted into the library by Mudavym alone; nothing a house does writes to `master_wine_library` (ADR 0124 Q3)
- Two ways a bottle enters the register: search the recorded LWIN file and confirm a row, or nominate one by hand (which is provisional and curated) (ADR 0124 Q4)

**Fifth pass, 2026-09-17/18 — the founder's sketch review (ADR 0160 sec110,
`0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes.md`):
A and B combined, C's wall rejected. `mudavym_design_cellar` flipped to ON by
default this pass — every house now sees this component; the legacy
`WineLibrary.tsx` stays in the tree, reachable only by flipping the flag back,
until the founder approves its deletion separately (ADR 0149).**

- **Item 1, kept as found.** The register (`WineRegister.tsx`) already renders
  its full filtered/sorted set in one normal-flow table — no fixed-height
  wrapper, no cutoff past any count. There never was a wall here; sketch 110c's
  wall was a different component this build does not use. Not virtualised
  (500 rows is `BOOK_READ_LIMIT`'s ceiling and the founder's own bar was "if we
  can keep scrolling that will just work fine," not a frame budget), so a
  future register materially larger than the read cap should revisit this with
  real numbers rather than by assumption.
- **Item 2, built.** `restaurant_cellar_settings.gazetteer_measures`
  (migration `20260922230000`) — a per-house, ordered, additive list of tiles
  for "In the building tonight," configured in Settings › Cellar
  (`CellarSection.tsx`) and read by `Registers.tsx`. Two new measures beyond
  the original four, both computed from data already on the page (no new
  endpoint): `parUnset` (rows with no `threshold_min` at all — coverage, a
  different fact from `belowPar`) and `registers` (how many of the seven this
  house carries).
- **Item 3, built — corrected 2026-09-18.** The first pass overstated this as
  "the founder's own dictated fact set": he was reading sketch 110 B's peek
  aloud (direction-b.html:274, "9 on hand · par 12 / $62 a bottle · $15 a
  glass / 38 sold · 9 d of till"), and the build misheard "par 12" as "pack
  size" and duplicated on-hand as "Bottles" (its own note admitted as much).
  The fix pass corrected the primary fact set to On hand, Par (moved up from
  further down the leaf rather than duplicated), List price and Glass price
  — the last from `restaurant_inventory.menu_price_glass`, a real column a
  manager sets, not the wine library's reference price — then a divider, then
  the selling-pace line, now honest about a FAILED analytics read
  (`analyticsReadable`) versus a row with genuinely nothing sold yet. Two
  gaps remain and are open questions in that pass's `not_fixed`: there is
  still no per-house BOTTLE price column in this schema, so List price
  reuses the library's reference price rather than a true house figure; and
  the sketch's own "N sold · 9 d of till" (till lines over a stated window)
  is still the older velocity/days-since-sale figure, a different fact from
  a different table. The Space-triggered non-modal peek sketch B also
  describes (item 1c) is still not built anywhere on this page.
- **Item 4, NOT built here — a named placeholder only.** The wine detail
  surface (region, vintage, formats, taste notes, the model-derived features,
  wines only) needs its own drawing per the founder's words. See §13's roadmap
  entry and `not_fixed` on this build's report for the open question.
- **Item 5, built — corrected 2026-09-18.** The first pass overstated its own
  "(per-field confidence, low-confidence fields shown in italics)" as the
  sketch's contract; direction-a.html's own `IsThisTheBottlePanel.tsx`
  citation is a WORD and a percentage per field (sure / fairly sure / unsure)
  or "not scored" when the reader carries no confidence at all, never an
  italic on the value. The fix pass rebuilt the confirm step to that
  contract — `sureness()`, "not scored" fields no longer drawn as if
  certain, every field editable and reading in full ink once taken, "Not
  this bottle" replacing "Retake the photo" — and fixed three confidence
  keys that never matched anything real (`fieldConfidences.name`/
  `.grapeVariety`/`.wineType` against a snake_case dict keyed `wine_name`/
  `grape_variety`/`wine_type`), so three of six fields previously read "not
  scored" regardless of what the reader actually returned. It also fixed
  `scanWineLabel` conflating any 404 with "no wine could be read" — it now
  reads the orchestrator's own `detail` first and treats a 404 with none as
  the wrong service being reachable, not an unreadable label. Still built as
  `PhotographLabel.tsx`, one `Panel` (ADR 0112's centered-ask shape) with two
  steps: camera (over the shared `CameraCapture`, lazy-loaded — same
  disclosed framer-motion exception already granted to the menu scanner
  below) then "Is this the bottle?". Reads via `POST /api/v1/scan/wine`
  (`source_type: "label"`, the orchestrator's single-wine pipeline —
  `scanWineLabel`, `wineDetection.ts`); writes via `POST /wines/submissions`
  (`submitWine`, `services/api/wines.ts`) only on confirm, which queues into
  `master_wine_library_submissions` for the dedup pass and puts no bottle on a
  shelf. A label with no readable producer can now be typed in directly
  ("Fix a field") rather than only retaken. Not fixed in this pass: that
  scan route still takes `restaurant_id` in an unauthenticated request body
  — a pre-existing pattern shared with `scanMenuImage`/`researchWine`, not
  something this build introduced, and a genuine open question for whoever
  owns the orchestrator's auth boundary.
- **Item 6, built.** `restaurant_cellar_settings.hold_ceremony`
  (`hold` | `confirm` | `auto`, default `hold`) — the founder's three
  ceremonies, configured in Settings › Cellar. `OrderCeremony.tsx` renders the
  three shapes; `hold` still delegates to the existing `HoldToApprove`
  primitive rather than reimplementing it.
- **Item 7, built — corrected 2026-09-18.** `/menu` — a new route, no
  legacy page, no `mudavym_design_*` column. The first pass also had no
  house chrome (no header, bell or search — its "same posture as
  /connections" claim was false: `/connections` DOES go through `PageGate`)
  and no link from anywhere, so a person could not find it at all. The fix
  pass wired `/menu` through `PageGate` too (`ALWAYS_ON_PAGES` in
  `useMudavymDesign.ts` makes it on for every house without a stored column,
  the same mechanism blocker 3 gave `cellar`) and added a link from the
  cellar page's own register nav; a global sidebar entry is still an open
  IA question, in `not_fixed`. Money on this page now states the house's own
  currency (`check_money_states_its_currency.py`) rather than a hardcoded
  `$`. Discarding a line now also drops it from `house_beverage_ledger`,
  `cellar-registers.service.ts`'s register inference and
  `beverages.service.ts`'s row record (migration `20260922230200`) — the
  first pass's discard only ever reached `getMenu` itself. Add
  (`POST /menus/items`, existing route) and discard
  (`PATCH /menus/:restaurantId/items/:id/discard`, migration `20260922230100`,
  soft-remove via `status = 'discarded'`) are both real writes. Building this
  surfaced and closed a real tenant-isolation gap in `addMenuItem`
  (`menus.service.ts`): it trusted `dto.menuId` alone with no comparison
  against the caller's own restaurant. Not fixed in this pass, and in
  `not_fixed`: discard still has no undo, and add still reuses the
  onboarding review pipeline (forcing every new line to `status: 'flagged'`
  with no way to approve it from `/menu` itself).
- **Item 8, NOTE ONLY, not built.** The founder: the fast-moving
  non-alcoholic lines (Turkish coffee, tea, American black coffee, water) need
  their own analytics — the present heat map "looks blue as hell," unreadable.
  Recorded here per his instruction. **Correction, cellar fix pass
  2026-09-18:** a heat map DOES exist on this page today — `RowExpander.tsx`'s
  "When it sells" card (`.cl-heat`, ~lines 360-390) — and that is the one he
  found unreadable, not an absent one; the sentence above was wrong. The fast
  non-alcoholic lines still reach that same card through the general path
  every register reads (`house_beverage_ledger` / `pos_unresolved_lines`), so
  nothing here blocks redrawing it later — only the earlier claim that
  nothing existed to retire was false.

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_cellar`)

> **Chrome (2026-09-04).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree: the A+M mark, this page's name, the ⌘K
> "Search or act" trigger, the house (or the branch switcher when there is more
> than one), the bell, the theme menu and the account menu. Chrome is excluded
> from §Surface by PAGE-CONTRACT, so it is named here and nowhere else in this
> note; its motions live in `components/mudavym/MOTIONS.md`, not the table
> below.

Canonical source with curves: `apps/web/src/pages/cellar/next/MOTIONS.md` —
this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `cl-stand-settle` | The reading stand opens | a bottle is chosen on `/wines` — `settle`, 320ms house curve, CSS `grid-template-rows: 0fr → 1fr` (the row-expand the founder named on board 053) |
| `cl-leaf-turn` | The page turns | a *different* bottle is chosen while the stand is already open — `turn`, 420ms, opacity + 4px; the stand does not re-open |
| `cl-ink` | Ink micro-state | register cards, shelf cards, rows, chips, fields, register switches, buttons — border to seal ring, one paper step; nothing translates |
| `cl-tally` | Figures arrive | every count on `/cellar` — three on the wine register card, two on each catalogue card, four in *In the building tonight* — `tally`, 840ms overdamped spring off `springs.tally.samples`. **An em dash never tallies** |
| `cl-hold-pour` / `cl-seal-stamp` | The seal lands | inside `HoldToApprove`, sending a real purchase order — `pour` 620ms linear, then `stamp` 360ms. The only ceremony, and the only place the seal appears |
| `cl-live-ink` | A figure moves under the reader | *added in the fourth pass* — a row of the wine register whose stock a live socket event just moved (`data-live='true'`, `useInkOnChange`): `ink`, house micro curve, 160ms, background steps to `--seal-tint` and back. **Nothing translates**, so a row that changes while it is being read never pushes the rows below it, and it flashes once and stops — no repeat, no glow, no badge that persists |

**Disclosed: this directory is far over the page brief's size guidance.**
The p4 page brief asks a rebuilt page to stay "under ~900 lines across its
files, split into components inside your directory when it grows."
`apps/web/src/pages/cellar/next/` is **7,938 non-test lines across 22 files**
(1,412 comment, 469 blank, 6,057 code) plus 2,532 lines of test — roughly nine
times the guidance, and it is stated here rather than left to be discovered.

*Why it escalated.* The guidance sizes ONE page. This directory is not one page:
`CellarNext` renders **seven surfaces** from one component — the parent plus six
registers — and the parent itself now carries three sections of its own (the
registers, the floor, and the whole cellar). Three of the seven have a grammar
of their own (`WineRegister`
carries the inventory overlay and the order ceremony; `CocktailRegister` is the
only WRITE surface on the page, with full CRUD and a recipe editor;
`CatalogueRegister` serves the other four). On top of that it exports two
surfaces other pages mount (`CellarRegistersStep` for `/get-started`,
`CellarRegistersControl` for `/settings`), and ADR 0108 made the register a
five-book assembly rather than a table read. Divided by surface it is ~1,080
lines each, which is the shape the guidance is actually describing.

*Where it went, and what it retires.* The fourth pass added **eight new files,
2,569 non-test lines** (`cellar-columns.ts` 744, `RowExpander.tsx` 517,
`SeriesPanel.tsx` 344, `WholeCellar.tsx` 297, `FloorStrip.tsx` 184,
`ColumnMenu.tsx` 200, `registerCells.tsx` 144, `rowSeries.ts` 139) and rewrote
parts of the existing ones. The single largest new file is a **vocabulary, not behaviour**:
`cellar-columns.ts` is 744 lines of which 172 are the measurements and citations
behind each column, and it exists precisely so the same rule is not restated in
every register component. Against that, this pass **retires**
`CatalogueRegister`'s own `COLUMNS` constant, its `sortValue` switch and its
`Books` mark-strip (all three now live once, in `cellar-columns.ts` and
`registerCells.tsx` — and `WholeCellar` reuses them rather than adding a third
copy), and the reading-stand container that sat above the table, replaced by the
in-place expanded row. **`WineRegister` still carries its own `COLUMNS` and
`sortValue` (`WineRegister.tsx:71`, `:83`) and was NOT migrated** — its row is a
`BottleVM` with an inventory overlay, not a `RegisterRowVM`, so sharing the cell
vocabulary needs a common row shape first. That is one duplication this pass did
not remove, and it is filed rather than described as retired. Net: one of two
column duplications gone, and the total up.

*What would actually shrink it.* Splitting the three register grammars into
`registers/wines/`, `registers/cocktails/` and `registers/catalogue/`
subdirectories, and moving `CellarRegistersStep`/`CellarRegistersControl` to the
pages that mount them. Both are structural moves that touch other pages' paths,
so neither was taken here; filed in §13.

**One disclosed exception to "no framer-motion": the menu scanner.**
`WineRegister.tsx` lazily imports `components/wines/MenuScannerModal`, which is
**shipped legacy code carrying its own motion library** — both
`MenuScannerModal.tsx:1` and `MenuScannerTab.tsx:2` already
`import { motion } from 'framer-motion'`, and both are outside this page's owned
paths. There is no lighter path inside the directory: rendering the tab in a
Mudavym dialog would not drop the dependency, because the tab imports it too, so
removing framer-motion means rebuilding the scanner (§13.8). The import is
**code-split** (`lazy()`), so it reaches neither this page's first paint nor its
bundle until an operator opens the scanner, and it is **not part of this page's
motion system** — the five rows above are the whole of CellarNext's motion; the
scanner's animations are the legacy component's own, are not in that table, and
are not claimed as house motion. Its legacy white/indigo chrome inside the İznik
page is filed at §9.8.

*Carried forward unchanged, and still literally a DoD violation.* The pass-two
re-audit (2026-09-03) re-confirmed the import is present, still lazy, still
reachable only from `WineRegister.tsx`
(`grep -rln framer-motion apps/web/src/pages/cellar/next` → that file and this
note's own prose). The DoD rule is "framer-motion imported = DEFECT", and the
route violates it. It is **not** closed by disclosure and is not being counted as
closed: it closes when the scanner is rebuilt (§13.8), and until then this page
carries a real, named, third-time-of-asking exception rather than a resolved
one.

Deliberate non-motions: the register does not stagger in (500 titles arriving
one by one is the busyness the verdict rejected); switching Register ↔ Shelf and
moving between registers does not cross-fade; unknowns never animate or shimmer
(the market column is *permanently* unknown and must never look like it is
loading); the soft-drinks register has no motion at all. **Added 2026-09-03:** a
register card appearing or disappearing as the house changes its answer does not
animate — that is a fact about the business, not an event on screen, and
animating it would make a correction look like a transaction; and the
"add the rows" notice has no entrance motion and never interrupts.

### Design used, and why (ADR 0044 p4 wave · MAKEOVER-VERDICTS: REJECT + IA decided)

**The verdict, quoted:** *"I don't like the new version. It's so much crowded
and I don't like the way it looks."* — used to like today's page *"where we
could see everything"* — **"put more character into it."** Then the IA:
**"Cellar" is the parent surface, `/wines` `/beer` `/whiskey` `/cocktails` are
its children.**

**The structure that enforces it.** A cellar book, not a data grid. The parent
is the book's front matter — four registers and what the building holds
tonight. A register is the book opened at that section, at *full* breadth
(every title, eight columns, six filters, both views), and the crowding is gone
because **depth left the row**: a row states only facts of record, and
everything the library has learned about a bottle opens on one reading stand
above the register. That is the single structural idea — *breadth on the page,
depth on the stand* — and it is what makes "see everything" and "not crowded"
compatible rather than opposed. Character is the book's own voice: Fraunces
speaks the titles, the standing line and the notes; the double rule rules the
account off under each head; registers with no endpoint are drawn *unruled*
(dashed) rather than empty; and the seal appears exactly once, on the hold that
sends a real order.

**Honesty rules applied.** Market price is `—` on every bottle with the reason
stated on the stand. `body`/`sweetness`/`acidity`/`alcohol`/`aromas`/`flavors`
are absent from the data hook entirely, so nothing downstream can export them.
A bottle with no inventory row reads "not in the cellar", never `0` against a
par of `6`. The gateway maps `price: price_reference ?? 0`, so `0` is read back
as *unrecorded* and rendered `—` rather than as "$0". An absent vintage is `—`,
not "NV" (which is a claim). The three unwired children say what is missing and
show the schema's columns — an empty list there would read as "no beer in the
building". A failed book read says so in words with a retry and renders no
register at all; a failed cellar read leaves "on hand" unknown for every row.
The order control is *disabled with its reason* whenever it would fail, because
the gateway needs an `inventoryId`.

**The two alternatives considered, and not built — the founder decides after
seeing this one.**

1. **The cellar floor (a spatial parent).** `/cellar` as a plan of the room —
   storage locations as zones, each zone showing what it holds, and a register
   reachable by walking the floor. It is the most characterful reading of "what
   is in the building" and it fits the charcoal ground. Not built because
   `storage_locations` is exactly the table the seeded-defaults incident
   corrupted — measured on production 2026-09-02 and written into the guard's
   own header (`scripts/check_no_seeded_defaults.py:20-33`): **87 rows across
   7 tenants, 84 of them carrying one of four invented zone names**, first
   written 2026-05-20. A floor plan today would be a picture of fabricated
   data. It becomes the best parent surface the moment locations are
   trustworthy.
2. **One flat register with a `kind` facet.** Drop the four child routes and
   give the wine register a Beer/Whiskey/Cocktails filter — the founder's
   "see everything" taken literally, one table for the whole cellar. Not built
   because `master_wine_library.beverage_kind` is computed in the database and
   **dropped by `WinesService.mapWine` before it reaches the browser**, so the
   facet would have nothing to filter on; and because a filter that returns
   nothing looks like "no beer" rather than "no endpoint". If the gateway ever
   carries `beverage_kind`, this is a live fork against the four-child IA the
   founder chose.

   **UPDATE 2026-09-03: both of that alternative's blockers are gone.** This
   pass carries `beverage_kind` onto the wire and serves `/beverages` and
   `/cocktails`, so a kind facet has real counts today (measured: 596 wines,
   801 spirits, 272 whiskies, 87 beers, 33 cocktails, 20 non-alcoholic, plus 39
   sake and 4 cider that no register in the seven can hold). Both directions are
   now drawn for the founder in `.planning/sketches/092-cellar-directions/`; what
   B still trades away is one row grammar per kind, which is what the four-child
   IA was chosen to keep. It is a live fork, and it is the founder's.

**Verified against the running app, not only against tests.** The page was
opened on the local dev server with `localStorage['mudavym.design.cellar']='1'`
against a real gateway (500 catalogue titles, 48 cellar rows) and both grounds
were read off the live DOM — paper `#FAF7F1`/`#211C16`/`#1A5E6B`, Warm Charcoal
`#15130F`/`#EFE7D9`/`#5FB0BC`, `color-scheme` flipping with them. Two defects
that no unit test would have caught were found that way and fixed:

1. **A resolving session was being called a denied one.** `AuthContext` reports
   `activeRestaurantId === null` for a beat on every cold load — the id is in
   `localStorage` but the context has not read it back — so "No restaurant is
   active on this account" flashed on every page open. That is a permission
   claim stated while the truth was "still asking". Split into an explicit
   `authLoading` state ahead of the denied one; asserted by a test.
2. **"Titles in the book: 500" was a claim about the library, not the read.**
   `/wines?limit=500` returns exactly its cap against production-shaped data, so
   the parent card now reads **"Titles read (capped)"** with a line saying the
   figure is a floor. Same class of error as reporting absence as health, one
   level up: reporting *a truncation* as *a total*.

**Size, measured and over budget — re-measured 2026-09-03, third pass.** The p4
brief asks for ~900 lines across a page's files. This paragraph has been wrong
twice: it quoted the pass-one file set (including `UnwiredRegister.tsx`, deleted
in pass two) until the pass-two re-audit caught it as CLAIM-DRIFT, and the
pass-two figure was itself never written down. Both are corrected here, and the
figure now carries the date it was taken.

| measured | page code | files | tests | CSS + MOTIONS | total |
|---|---|---|---|---|---|
| pass one (2026-09-02) | 1,706 | 8 | 293 | 363 | 2,362 across 11 |
| pass two (audit, 2026-09-03) | 3,108 | 12 | 949 | 388 | 4,445 across 16 |
| pass three (this build) | **4,546** | **14** | 1,341 | 473 | **6,360 across 19** |

Pass three added `HouseRecordLeaf.tsx` (240) and `CocktailRegister.tsx` (564),
and grew `useCellarNextData.ts` (503 → 739), `CatalogueRegister.tsx` (261 → 523)
and `cellar-format.ts` (271 → 382). That is **~5.1× the ~900-line budget**, and
the number is stated rather than softened.

*(The pass-three row was first written mid-build and was 9 lines light by the
time the audit fixes landed — caught by the Sonnet re-audit at 3 lines, then
drifting further as the three route tests and the timezone-precondition test
were added. Re-measured at final state, 2026-09-03. The lesson is the one this
page keeps teaching: a figure quoted as exact has to be taken last, or it is a
figure quoted as exact and wrong.)*

The reason it is defensible, stated so the founder can reject it: this directory
is not one page. It is **eight surfaces** — the cellar parent, six registers with
different columns, and the wine register — plus two components that live outside
the page entirely (`CellarRegistersStep` in onboarding, `CellarRegistersControl`
in Settings, 382 lines between them, sharing this directory so the three places
that describe a register cannot describe it three different ways).

The reason it is still a defect: the growth has never been paid for by a cut.
Every pass has added. **If it must come down**, in the order that costs least:
`WineRegister.tsx` splits (control rail / table / shelf); `useCellarNextData.ts`
splits its view-model types out of its hooks; and the two shared components move
to `components/mudavym/registers/`, which is where they belong on the merits
anyway and would take 382 lines off this page's count without deleting a line.

**Substituted or left out, and why.** Bulk selection and the CSV export are
left out (see §1a — the export shipped six invented columns as fact). "Save as
recurring" is left out entirely rather than re-pointed at
`recurring-orders.controller.ts`, because wiring a real recurring order is a
procurement decision, not a catalogue one (§13). The menu scanner is kept but
renamed to what it does; its modal still renders in the legacy white/indigo
chrome inside the İznik page, filed in §9 rather than patched over. `imageUrl`
is read by the view model but nothing displays it, because
`WinesService.mapWine` never selects an image column — the field is on the
client type and has no producer (§9).

### Second pass, 2026-09-03 — the cellar adapts to the house

**What the founder asked.** *"The cellar looks okay, but each restaurant will be
different — maybe in the beginning when people add their menus we decide if they
have any whiskeys or beers; maybe it's a non-alcoholic restaurant with only soft
drinks — so we adapt to that."* Then, on the mechanism: **infer, then confirm at
onboarding**, with a manual switch afterwards from Settings for a category the
books cannot yet see, and a prompt when that happens asking the house to add the
menu or the items so the change becomes visible.

**The fault, named precisely.** The four registers were a module constant
(`cellar-format.ts`'s `REGISTER_ORDER`), drawn identically for every tenant. To a
non-alcoholic house that made two false statements at once: it asserted a whiskey
programme existed, and then — the register being empty — asserted that programme
was empty. This is the `absence-reported-as-health` shape with the sign flipped,
**presence reported where there is none**, and no amount of honest copy on the
child page repairs a parent that should not have drawn the card.

**What was built.**

1. **`restaurant_cellar_registers`** (`supabase/migrations/20260903092000_restaurant_cellar_registers.sql`)
   — one row per (restaurant, register), the ONE authoritative home for this fact.
   No copy on `restaurants`, none in a client store, none in a constant.
   `source ∈ (inferred, confirmed, manual)` with `confirmed_at` NULL exactly while
   the row is still a proposal, enforced by a CHECK constraint; `evidence` jsonb
   snapshots what the inference said at the instant a human answered, so "was the
   machine right, and did the human overrule it?" stays answerable. The actor FK
   points at `public.users(user_id)`, never `auth.users` — the two are disjoint in
   this database and a FK to the wrong one 23503s on every write.
2. **`apps/api-gateway/src/cellar/`** — `GET :rid/registers` and `PUT :rid/registers`,
   JWT-guarded and tenant-scoped through `assertTenantMatch` on the path parameter
   (curl-verified: another tenant's id returns 403, no bearer returns 401).
   `cellar-registers.ts` holds the pure inference; `cellar-registers.service.ts`
   reads four tenant sources plus the two shared catalogues.
3. **The inference**, over this tenant's real rows: `restaurant_inventory` joined to
   `master_wine_library.beverage_kind` (the database's own classifier), `menu_items`
   section headers and names, and `public.cocktails`. Whole-word matching only —
   "Alentejo" contains "ale", and a substring match would have put a beer register
   on every Portuguese wine list in the product.
4. **`beverage_kind` onto the wire** — `WinesService.mapWine`
   (`apps/api-gateway/src/wines/wines.service.ts`), with `classification_status`
   beside it and a spec in the same module. This was §13.1 of this note's own
   roadmap and the sequencing the menu research put first (four of its five
   premortem causes depend on this one field).
5. **`apps/api-gateway/src/beverages/`** — read-only `GET /beverages/:rid` (with a
   `register` filter that resolves to the measured `beverage_type` vocabulary in
   one place) and `GET /cocktails/:rid`. Both curl-verified against the live
   gateway.
6. **The page**: only the carried registers are drawn, with `decidedLine()` saying
   how that was decided and where to change it; `CellarRegistersStep` and
   `CellarRegistersControl` exported for onboarding and Settings;
   `CatalogueRegister` replaces `UnwiredRegister` now that the reads exist.

**The four states, kept apart.** Flattening any two of them is the whole fault:

| state | what the page does |
|---|---|
| confirmed / manual | draws the house's registers and no others |
| inferred | draws what the books say, and says nobody has confirmed it |
| unknown (no books at all) | draws **all seven**, muted, and claims none — hiding six from a house nobody has asked is the same lie in reverse |
| unread (the readout failed) | draws the wine register alone, in words, and says the rest are unread, not absent |

**The notice, and why it never interrupts.** The menu research's premortem M1
predicted the most likely death of this mechanism: built as a modal on data entry,
it becomes noise within a month and is clicked through unread — exactly how the
legacy "Reorder" alert on this page died. The founder's own backtest across four
scenarios then found **no scenario where `interrupt` was the right default**, and
found it actively worse at full onboarding where it fires most. So: inline,
persistent (rendered from state the gateway recomputes on every read, so it cannot
go stale), dismissible per browser. The `variant: 'inline' | 'interrupt'` prop
survives as a one-prop escape hatch. Its three amendments are all built:
register-aware copy, one aggregated notice instead of a stack, and the symmetric
off-with-items state.

**Two defects found and fixed while measuring live.**

1. **A row was being counted twice.** The first live read reported
   `inventoryRows: 100` for Wines over a cellar of 50 rows: a bottle classified
   `wine` whose name also said "Red" was credited by the classifier AND by the
   name. A figure printed beside a register has to be a count of bottles; two
   signals about one bottle are not two bottles. Fixed by crediting a row once per
   register, with a test.
2. **"Has this house confirmed?" was answering `false` when it could not know.**
   With `restaurant_cellar_registers` absent from a database,
   `awaitingConfirmation` returned `false`, which would have suppressed the
   onboarding step for every house on that database. It is now `boolean | null`,
   and null is rendered as unknown.

**Two alternative directions, drawn rather than described.**
`.planning/sketches/092-cellar-directions/` — `cellar-floor.html` (the spatial
parent: zones on a plan, each stating what it holds, how full it is and when it
was last walked) and `one-register-with-kind.html` (one flat register for the whole
cellar with a kind facet). Each carries an "adapting to the house" panel showing
what a non-alcoholic café and a whisky bar would see. **A was blocked on
trust, not code** — `storage_locations` held 87 rows across 7 tenants on
2026-09-02, 84 of them carrying one of four invented zone names. (Re-measured
2026-09-04: 4 rows across 2 tenants, 4 of 4 carrying one of those names. It was
unblocked in the fourth pass by gating the floor on confirmation rather than by
the data improving — see §1b.) **B is no longer blocked**: this pass put
`beverage_kind` on the wire and served the two catalogues, so its facet has real
counts; what it still trades away is one row grammar per kind, which is what the
four-child IA was chosen to keep.

**What was substituted or left out, and why.** No `/menu` page (the research says
hold it until OD-113 is decided, and the parent said not to build one). No
server-side notice dismissal — that would be a second piece of state about a
register whose one authoritative row is `restaurant_cellar_registers`; per-browser
`localStorage` is used instead and the notice says so (§13). No routes for
`/spirits`, `/non-alcoholic`, `/soft-drinks`: `App.tsx` is outside this page's
paths, so those three open as `?register=` on the parent (§9).

### Third pass, 2026-09-03 — the house's own record

**What the founder asked.** "First small fixes, and then everything left
including the four large builds — make them elegant and pretty looking." The
full beverages catalogue was one of the four: *"Beer, whisky, cocktails,
spirits, non-alcoholic and soft drinks each a real register: list/search/filter/
sort with the house's own record per row (first bought, paid, poured, who quoted
— `—` where unknown), add-to-inventory gated on OD-113 (say so)."*

**What was actually wrong, which is not what it looked like.** These registers
were not thin because nobody had built them. They were thin because
`public.beverages` has no `restaurant_id`
(`supabase/migrations/20260817070000_beverages_table.sql:217`) and nothing in the
schema references `beverages.id` except `cocktail_ingredients.beverage_id`
(`…20260817090000:63`), a table created empty. So the page had been served two
passes running, and each pass had written a better sentence explaining that none
of the rows were the house's. Pass two's own `registerShapes.ts` said it
outright: *"these are the shared reference catalogue, not this house's stock."*
That is a design failure wearing a well-worded disclaimer.

**The structural change: the spine is inverted.** `DESIGN-FOUNDATION.md` §6, the
`/cellar` row, already named the answer and marked it **now** — "the house's own
record on every bottle — first bought, what we have paid, what we poured … who
quoted it". Five tables carry both a `restaurant_id` and the product's name in
text, and between them they are that record:

| the house fact | table | name column |
|---|---|---|
| what we list, and charge | `menu_items` | `name` + `producer` |
| what we were invoiced, and when | `procurement_document_lines` → `procurement_documents` (`doc_type='invoice'`) | `description` |
| what we ordered | `procurement_order_items` → `procurement_orders` | `wine_name` + `producer` |
| who quoted it, off what | `vendor_price_observations` (this tenant's rows only) | `product_name_raw` |
| what we actually sold | `pos_unresolved_lines` (`resolved = false`) | `item_name` |

The last row is the find of this pass. `pos_unresolved_lines` holds the till
lines the POS bridge could not map to an inventory row — and because
`restaurant_inventory` is keyed on `master_wine_id`, **every non-wine sale a
house makes lands there and nowhere else.** It is filed as a defect log; for
beer, spirits and soft drinks it is the sales ledger.

`public.house_beverage_ledger(uuid, int)` (migration `20260903120000`) assembles
them into one row per product. The catalogue is then laid over it by
`beverage_house_key()` — see ADR **0108** for the whole argument, including why
`beverage_identity_key` could not be reused unchanged and why no similarity
score was permitted.

**Honesty rules applied.**

- A book that names a product nowhere is **absent from the record**, not
  rendered as a block of zeroes. `quoted: null` is the em dash; `quoted:
  { count: 0 }` would be a confident nought.
- A **paid total of 0** is read as unrecorded, never as "free" — an invoice line
  with a blank total and a blank unit price is unknown.
- The **catalogue match tier is on the row**: `exact` or `contains`, with
  `contains` labelled loose in the table *and* explained on the stand ("a
  different bottle with the same words would match too"). No third tier exists.
- **A missing migration is words.** Until `20260903120000` is applied the ledger
  RPC does not exist; the gateway returns `readable: false` with a reason naming
  that exact file, and the register renders the sentence. Returning `[]` there
  would have said "this house has no record of anything" — absence reported as
  health, the most expensive shape in this repo.
- **House lines no register can hold are reported**, not filtered away.
- The **`shortDate` timezone bug was caught in test, not on screen**:
  `doc_date` is a Postgres `date`, `new Date('2026-03-02')` parses as UTC
  midnight, and any timezone west of UTC printed "1 Mar 2026" for an invoice
  dated the 2nd. A date of record that silently moves by a day is a fabricated
  date in a smaller coat. Calendar dates are now formatted in UTC; instants
  (`created_at`, a `timestamptz`) stay local, because "when did we last sell it"
  is a question about the reader's evening. Pinned in `cellar-format.test.ts`.

  *Re-verified after the Sonnet audit flagged the test as possibly vacuous on a
  UTC runner.* It is not: `apps/web/src/__tests__/setup.ts:12` pins
  `process.env.TZ = 'America/New_York'` before anything touches `Date`, with a
  comment naming this exact hazard. Measured both directions 2026-09-03 — with
  the `timeZone: 'UTC'` override deleted, `TZ=UTC pnpm vitest run
  cellar-format.test.ts` **fails** with `expected '1 Mar 2026' to be '2 Mar
  2026'`. The audit checked `.github/workflows/ci.yml` for a `TZ` and found
  none, which is true, and missed the setup file. The test now asserts that
  precondition itself (`getTimezoneOffset() > 0`) so it can never go quiet if
  somebody removes the pin, plus a companion case proving the override is
  targeted rather than blanket — an *instant* still renders in the reader's own
  zone.

**The two alternative directions considered, and not built** — the founder
decides after seeing the page:

1. **Merge the house's rows and the catalogue's into one alphabetical table.**
   Simpler, and it reads as one register rather than "ours, then theirs". It was
   rejected on the operator's question: someone opening `/whiskey` wants the
   twelve bottles this house pours, and alphabetical order buries them among 272
   strangers. The current build sorts the house's rows first and defaults the
   sort to record-richness. If the founder prefers one flat table, it is a
   one-line change to the sort in `CatalogueRegister.tsx`.
2. **Match on more than exact-or-contained** — trigram similarity, or a
   threshold on token overlap, which would attach far more invoice lines to
   catalogue rows. Rejected because a wrong attribution puts one bottle's spend
   on another bottle's row silently, and this page's whole claim is that its
   figures are the house's own. `counts.matchedLoosely` is already reported
   separately, so if the founder wants the looser tier measured before deciding,
   the instrumentation is there.

**Substituted or left out, and why.** No add-to-inventory: OD-113 is undecided,
so the control renders disabled with the reason rather than hidden or faked. No
write path to `public.beverages`: a tenant inserting into a shared reference
catalogue whose identity is set by a trigger would be a second writer for
somebody else's table, so the register says so instead of showing a button. No
seal on this page's new acts — retiring a cocktail is a two-step confirm, the
same die pressed dry, because the ceremony is rationed to the one hold that
spends money. And the happy-path cocktail *create* was deliberately **not**
exercised against the live database (see §9.11).

### Fourth pass, 2026-09-03 — what a column represents, what a gesture opens, and what the house is called

**What the founder asked**, verbatim: *"What if there is only non-alcoholic,
then what do we do? do we say soft drinks? just drinks?"* · *"The realtime
update must be super fast and smooth."* · *"research what should the columns
represent and help us visualize. Let us see insights and details when double
clicked/right clicked on columns to see their data graphs or research (you
decide), order ledgers maybe when clicked on paid etc."* · *"what each bev have
different columns based on their features, beers might have diff (pilsner, IPA,
maya, gaz oranı…)"* · *"We show more general columns when they want to see the
whole menu inventories at once right?"* · *"Keep the top info boxes"* · *"Both
the direction A and B look great in their own fields, research on it try to
merge those two."* And, on the review call: *"that dropdown, all in one with
essential details"* — the `/inventory` row expansion
(`apps/web/src/pages/inventory/command/RowExpansion.tsx`,
MAKEOVER-VERDICTS.md:66-72 *"it shows everything you need to see"*).

#### The measurement this pass rests on

Counted against the live database this gateway reads (`exzueerziesmczwlhomd`),
2026-09-03. Every column decision below follows from it.

| table | rows | what is filled | what is EMPTY |
|---|---|---|---|
| `public.beverages` | 609 live | name, producer, country (609), region (524), beverage_type (609), price_reference (294) | `abv_pct` 0 · `volume_ml` 0 · `package_format` 0 · `age_years` 0 · `cask_finish` 0 · `expression` 0 · `proof` 0 · `body` 0 · `acidity` 0 · `serving_temp_celsius` 0 · `glass_type` 0 · `barcode`/`sku`/`upc` 0 · `type_attributes` `{}` on all 609 |
| `master_wine_library` | 3,562 live | vintage 3,118 · appellation 2,259 · grape 3,514 · primary_type 3,562 · price_reference 3,345 · acidity/tannins/texture/finish ~3,346 (74.5% marked `inferred`) | `retail_price_avg` **0** · `quality_level` 0 · `rating_ws`/`rp`/`jr` 0 · `critic_scores` 0 · `bottle_size_ml` **750 on 4,226 of 4,226 — a constant, not a measurement** |
| `restaurant_inventory` | 206 | stock_live 206 · threshold_min 206 · pour_size_ml 206 | `sales_velocity_30d`/`7d` 0 · `last_sold_at` 0 · `markup_ratio` 0 · `menu_price_current` 0 · `last_purchase_price` 0 · **`total_revenue` and `times_ordered_count` are NOT NULL on all 206 and ZERO on all 206** |
| `cocktails` | 55 | menu_section 55 · price 44 | method 0 · glass 0 · garnish 0 · description 0 · `restaurant_id` **0** |
| `cocktail_ingredients` | 0 | — | the whole table |
| `procurement_document_lines` | **0 in the whole database** | — | — |
| `vendor_price_observations` | **0 in the whole database** | — | — |
| `pos_unresolved_lines` | 39 for the demo tenant (130 across three) | item_name, qty, price, created_at, all 100% | — |
| `inventory_transactions` | 215 across four tenants | quantity_after 100%, type ∈ initial/sale/return/reconciliation/transfer/purchase | `unit_cost` 3 of 215 |

Two of those lines are the whole argument. **`total_revenue` and
`times_ordered_count` are a default with no writer**: a column over either
renders "0 sold · 0" as though it had been counted, which is the
absence-reported-as-health fault in table form, and both are refused by name in
`cellar-columns.test.ts`. And **the two books the founder named — "paid" and the
price history — are empty in this database**, while the one book he did not name
(the till) is the only one with a real series in it.

#### The rule a column has to pass

Three tests, in order. `apps/web/src/pages/cellar/next/cellar-columns.ts` is the
single source of truth for all of them, and a column that fails one is **offered
in the header menu with its measured reason**, never silently dropped and never
drawn as a file of em dashes.

1. **Is there a writer?** A column whose source has no writer can only render an
   em dash. It is not a column, it is a promise.
2. **Does it vary?** `bottle_size_ml` is 750 on every row. A one-value column
   sorts nothing and filters nothing — it is the Body filter's mistake in
   another suit, and Body was removed for exactly this in the first pass.
3. **Is it ours?** A fact about this house (what we paid) and a fact about the
   bottle (its region) are different claims, and the register orders them so:
   the house's spine first, the catalogue's facts after.

#### What the field's own tools put on a row

| tool | its row, in its own words | URL |
|---|---|---|
| CellarTracker | four REQUIRED import columns — Vintage, wine name, Quantity, BottleSize; everything else optional, and the optional list is the OWNER'S record: Storage Location, Bin, Store, Purchase Date, Cost, Bottle Note, **Consumption Revenue**, critics' scores | https://support.cellartracker.com/article/26-migrating-from-another-system |
| Backbar | eight columns for a bar inventory sheet: item name, item cost, sale price, product type, subtype, vendor, size, varietal/style | https://academy.getbackbar.com/how-to-create-a-liquor-inventory-spreadsheet |
| BinWise | every product by depletion rate, cost and movement; supplier and par on the row; actual pour cost for any date range | https://home.binwise.com/binwise-pro · https://home.binwise.com/blog/setting-par-level-inventory |
| Partender | the row is a bottle level as a fraction of full → value on hand in wholesale AND retail dollars, plus price-change alerts and a usage/variance report | https://appdemo.partender.com/pricing.html |
| BevSpot | the per-item figure is *usage* — by-volume consumed — because it generates the par, exposes over-pouring and builds the order | https://bevspot.com/ordering/ |
| Untappd for Business | the only beer tool in the study, and it makes **three** fields required — Beer Name, Brewery, **Style**; ABV and IBU optional. API beer object: `name, abv, style, brewery, rating`; price lives on a *container* with its own size | https://docs.business.untappd.com/ · https://help.business.untappd.com/support/solutions/articles/16000102385-how-do-i-add-a-new-beer-to-my-untappd-for-business-menu- |
| BJCP | a style's Vital Statistics is exactly five numbers — `IBU · SRM · OG · FG · ABV`. **Carbonation is prose in Mouthfeel; yeast is prose in Characteristic Ingredients** | https://www.bjcp.org/style/2021/21/21A/american-ipa/ |
| Whisky Advocate | 5,000+ reviews searchable by **price, score, style, brand** — not by age or cask | https://whiskyadvocate.com/ratings-reviews |
| Distiller / the whisky trade | age statement, cask type, ABV/proof, region, peat in ppm — the label's own fields | https://distiller.com/ · https://whiskytastingcompany.com/blogs/news/understanding-whisky-labels-for-beginners |
| cocktail spec sheets | name, ingredients + measures, method (build), glass, ice, garnish; cost-per-drink is the ops overlay on top | https://www.thecocktailservice.co.uk/how-to-create-a-cocktail-spec/ · https://www.getbackbar.com/cocktail-recipe-template-free-download |
| GS1 GDSN (the standard behind a distributor's soft-drink row) | GTIN, brand name, product description, net content, GPC classification, packaging hierarchy, nutrients at the lowest GTIN | https://www.gs1.org/docs/gdsn/GS1_Attribute_Business_Definitions.pdf |
| Provi / SevenFifty | standardised product and producer names, descriptions, categorisations, label images; filter by appellation and region | https://daily.sevenfifty.com/power-your-business-with-better-product-data/ · https://www.provi.com/provi-sevenfifty |

The answer is consistent across all eleven: **the trade's registers are
commercial, not chemical.** That is why the spine is the house's own record and
the chemistry is offered rather than drawn.

#### The columns, per register

`•` drawn by default · `○` offered in the header menu with its measured reason.
Every column states its source and its fill in `cellar-columns.ts`, and the
header menu prints both.

**The house spine — every register except cocktails**

| | column | source | state |
|---|---|---|---|
| • | Bottle | the row's own longest label | real |
| • | Our record | five marks, one per book that names it (`house_beverage_ledger`) | real |
| • | On the list | `menu_items.bottle_price` / `by_glass_price` | real |
| • | First bought | `procurement_document_lines`, invoices only | real; 0 rows in this DB |
| • | Paid | `procurement_document_lines.line_total`, summed | real; 0 rows in this DB |
| • | Sold | `pos_unresolved_lines.qty` | real, and populated |
| • | Taken | `pos_unresolved_lines.price · qty` — what the till took, not what the list says | real, and populated |
| • | Last quote | `vendor_price_observations.normalized_unit_price` | real; 0 rows in this DB |
| ○ | Last ordered | `procurement_order_items` via `procurement_orders.requested_at` | real; off because Paid answers it with a stronger book |

**Wines** — spine plus: • Style (`primary_type`, 3,562) · • Vintage (3,118) ·
• Origin (3,529/3,562) · ○ Grape (3,514, off for width only) · • List
(`price_reference`, 3,345) · ○ Market (`retail_price_avg`, **0**) ·
○ Format (**750 ml on every row**) · • On hand (`stock_live`) · ○ Par
(`threshold_min`, 206/206) · ○ Last counted (4/206).

**Beer** — spine plus: ○ **Style** (`type_attributes → style`, 0 of 57 — *the
founder's first beer column, and the single highest-value writer this register
is waiting on*) · ○ IBU (0) · • Type · • Origin · ○ ABV (0) · ○ Format (0).
**Carbonation ("gaz oranı") and yeast ("maya") are not offered as columns at
all** — BJCP keeps both in prose, and prose does not sort. They belong on the
expanded row.

**Whiskey** — spine plus: ○ Age (`age_years`, 0 of 272) · ○ Cask
(`cask_finish`, 0) · ○ Proof (0) · • Type · • Origin (261/272) · ○ ABV (0).

**Spirits** — spine plus: • Type (609/609) · • Origin · ○ ABV · ○ Format.

**Cocktails** — a recipe's grammar, not a bottle's: • Bottle · • Our record ·
• Sold · • Taken · • Section (55/55) · • Price (44/55) · • Recipe (line count) ·
○ Build (0) · ○ Glass (0) · ○ Garnish (0). No First bought and no Last quote: a
cocktail has no invoice line of its own, and those would be dead columns.

**Non-alcoholic / Soft drinks** — spine plus: • Type · • Origin · ○ Format.
Sugar and caffeine are **not proposed**: nothing in the schema carries either,
and `type_attributes` would hold them without a migration the moment there is a
writer. A case size is already in the schema on the buying side —
`procurement_document_lines.pack_size` — so it is derivable, not missing.

#### The general set — the whole cellar at once

Eight columns, and the test for a general column is harsher than for a register
column: **it has to mean the same thing in every register.**

`Bottle · Register · Our record · On the list · Paid · Sold · Taken · Last quote`

`On hand` is deliberately excluded and the section says so in one line: it is
real for wines and structurally absent for the other six (OD-113), so as a
general column it would be an em dash on most of the page — the same fault the
register-level ABV column had. `WholeCellar.tsx` on the parent draws this set,
opened by a button because it is one read per register.

**NO MIGRATION IS PROPOSED BY THIS RESEARCH.** Every column the field asks for
already exists as a column somewhere (`beverages.type_attributes` for
style/IBU; `beverages.age_years`/`cask_finish`/`proof` for whisky;
`procurement_document_lines.pack_size` for a case size;
`cocktail_ingredients.quantity`/`unit` for a cost per pour) or is derivable from
the house's own books. What is missing is **writers**, and a writer is not this
page's to build. Filed in §13.

#### The gesture set, stated once

- **The header owns the column.** Right-click a header, or press its caret
  (`aria-haspopup="menu"`, the keyboard- and touch-reachable twin), for: Sort
  up · Sort down · Open the series for the chosen row · Hide this column · and
  **What this column is** — its meaning, the table it reads, and its measured
  fill. Clicking the label sorts; clicking again reverses.
- **The row owns its record.** Click a row and it opens **in place**, as cards.
- **The cell owns the series.** Double-click or right-click a cell whose column
  has a series, and the graph and the ledger behind that one figure open below.
  `Enter` on a focused row does the same as a click.

Whose precedent: Airtable's field-header dropdown is schema and nothing else
(Edit field · Edit description · Duplicate · Delete —
https://support.airtable.com/articles/2361876459-field-type-overview);
TradingView's screener says outright *"You can click any row to open the chart"*
and *"With a right-click on a column header, you can customize the column, select
the sorting type, change a column's position … or remove a column"*
(https://www.tradingview.com/support/solutions/43000718866-tradingview-stock-screener-trade-smarter-not-harder/);
and Bloomberg has answered "graph or table?" with **both** since the terminal
shipped — `GP <GO>` draws a security's history, `HP <GO>` tables the same series
(https://libguides.cbs.dk/gp_function_bloomberg,
https://businesslibrary.uflib.ufl.edu/c.php?g=114612&p=746558). That pair is why
`SeriesPanel` is a graph AND a ledger from one read rather than a choice the
page makes for the operator.

#### The expanded row — the `/inventory` dropdown, on a cellar register

`RowExpander.tsx`. The founder's named shape, and the anatomy is copied from
the reference capture rather than guessed: **the row stays in place**, a **fact
strip** runs directly under it (what the thing IS — `/inventory` shows grape ·
region · format · vintage · last counted), and only then do the cards sit side
by side. A fact with no source in this schema is a **withheld line**: the label
is drawn, the value is the em dash, and the table it would have been read from
is on the value's own title — the same move `/inventory` makes when it writes
"Last counted: never" in words rather than leaving a blank. Confirmed by the
founder as **the house pattern for ledger tables, cellar first**.

`/inventory`'s six cards, answered honestly:

| card | `/inventory` | the cellar | why |
|---|---|---|---|
| Live vs shadow | real | **WITHHELD, drawn hatched** | `restaurant_inventory` is keyed on `master_wine_id`; a keg has no stock row, so there is no live count to hold a shadow against. OD-113 |
| Par and reorder | real | **WITHHELD, drawn hatched** | `threshold_min` is a column on the inventory row that does not exist; suggested order, reorder point and runway are all arithmetic over it, so all four are withheld together |
| Market price | real | **REAL, renamed** *What it costs and what it makes* | last paid (invoice) · on our list (menu) · catalogue reference (`beverages.price_reference`) · markup = list ÷ last paid |
| Velocity 14d | real, **zero-filled** | **REAL, clipped** | `/inventory` pushes a dense 14 days (`inventory.service.ts:688-696`), so a house with one day of POS data sees thirteen zero-sales days it never had. Ours covers only the span the till has evidence for, and says how many days that is |
| When it sells | real, **16:00–23:00 only** | **REAL, any hour** | `/inventory`'s heatmap is a 7×8 matrix of 16:00..23:00 (`inventory.service.ts:660-684`), which drops every lunch service and every café — and a café is exactly the house this pass is about |
| Order history | real | **REAL, as an order ledger** | purchase orders and invoice lines, dated, with the vendor. **No line claims "paid"**: `procurement_documents` carries a status but no payment date, so settlement is not a fact these books hold |
| — | — | **NEW: "As a beer" / "As a whiskey"** | the per-type research as a card: style, IBU, ABV, format / age, cask, proof — each named, each an em dash, each with the measurement and the migration line beside it |
| — | — | **NEW: Quoted** | the one book the founder named by name, and it has 0 rows anywhere |

A withheld card is **drawn, not dropped**. Dropping it would make a keg look
like a bottle whose stock merely happens to be unknown; drawing it hatched with
its reason makes it a decision somebody has to take.

#### Real-time

`useCellarLive` (in `useCellarNextData.ts`). The socket already carried the new
figure — `emitStockUpdate` sends `stock_before`/`stock_after`
(`apps/api-gateway/src/websocket/websocket.gateway.ts:358-367`) — and the
browser threw it away: `useInventory` answers the event by INVALIDATING the
query (`apps/web/src/hooks/queries/useInventoryQueries.ts:59-65`), so the row
only moved after an extra HTTP round trip. The socket was saving the polling
interval and nothing else. The carried figure is now written into the cached row
on arrival, the row flashes `ink`, and the read reconciles behind a row that is
already right.

Two producers dispatch the same `inventory_change` window event with **different
shapes** — `lib/websocket.tsx:492` sends `{inventory_id, stock_after}`,
`contexts/RealtimeContext.tsx:376` sends `{type, wineId, quantity}` — and
`readStockEvent` accepts both, because a reader that assumed one would silently
ignore half the traffic. Filed for a single shape in §9.

**Measured** (both halves, and the missing third, in
`apps/web/src/pages/cellar/next/MOTIONS.md`): transport, against the real
gateway on `:4000` over a real websocket — connect 17 ms, subscribe ack 1 ms,
`ping`→`heartbeat` RTT p50 **0.81 ms** / p95 **1.79 ms** over 12 samples;
apply, event-in-tab → painted frame — p50 **5 ms** / p95 **6 ms** over 18
samples. Both are localhost/jsdom and say so. The end-to-end leg is **not**
measured and cannot be from here: nothing emits `stock:updated` without the
RabbitMQ bridge, which is not running.

#### What this house's book is CALLED

The founder's ruling: **adaptive** — the parent is named by what the house
pours; one surface; the route stays `/cellar`.

| the registers on | the name | why |
|---|---|---|
| any of wines · spirits · whiskey | **The Cellar** | this house keeps bottles |
| else, any of beer · cocktails | **The Bar** | it pours but does not keep. A bar without alcohol is still a bar: "temperance bar, also known as an alcohol-free bar, sober bar, or dry bar, is a type of bar that does not serve alcoholic beverages" — https://en.wikipedia.org/wiki/Temperance_bar |
| else (non-alcoholic and/or soft drinks) | **Drinks** | one of the two words the founder himself offered |
| unread / nothing established | **The Cellar** | the route's own name, with the sentence saying nothing has been established. It never guesses a specific name and then changes it |

**"Soft drinks" is refused as a parent name** on a structural ground rather than
a taste one: it is already the name of one of the seven registers, so a parent
called Soft drinks would collide with its own child in the spine, in the
breadcrumb and in every sentence anybody writes about the page. The rule is
printed on the page under the headline (`cellar-naming-rule`), because a name
that changes with the house has to say why it changed or it reads as a bug.

#### Which view the parent opens on (founder, 2026-09-04)

`parentView` in `cellar-format.ts`, computed from the SAME readout as the name
so the two can never disagree. **Three registers or fewer → `/cellar` opens on
the whole-cellar table; more → it opens on the registers, with the whole view a
button away.** The rule is printed beside the naming rule
(`cellar-view-rule`), and the route never changes.

Two clauses that are load-bearing rather than tidy:

- **An unread readout never opens the whole view.** It fires one read per
  carried register, so opening it against a set nobody has established would
  assert that set in the network layer while the page refuses to assert it in
  words. Unread falls to the parent, which already says the set could not be
  read.
- **A set with no non-wine register never opens it either.** `/wines` is served
  by a different endpoint with the inventory overlay laid over it, so the whole
  view excludes it. A wines-only house is *under* the threshold and would open
  on an empty table — the count right, the page wrong. It falls to the parent
  and says so.

#### The floor, built — confirmed zones only (founder, 2026-09-04)

`FloorStrip.tsx` over `GET /cellar/:rid/zones` and
`PUT /cellar/:rid/zones/:zoneId` (new, `cellar/zones.service.ts`), with
migration **`20260904130000_a_zone_is_confirmed_or_it_is_not_drawn.sql`**.

*Why a gate at all.* A drawn room asserts a room, and `storage_locations` cannot
tell a zone somebody walked from a zone a seeder invented. **Re-measured
2026-09-04: 4 rows across 2 tenants, and all four carry one of the four names
the seeded-defaults sweep named.** The 84-of-87 figure this note carried was
measured 2026-09-02; 83 of those rows have since been deleted, so the count
changed and the proportion got worse — 4 of 4.

*The shape is the cellar's own.* Infer, then confirm, exactly as the register
set does: the house's zones are listed with the names they currently carry, a
manager confirms or renames each once (one write, `zone_confirmed_at`,
`zone_confirmed_by` from the JWT, `zone_provenance` one of
`confirmed`/`renamed`/`created`), and the strip fills in behind them.

*Three states, three sentences.* Unread (or the migration unapplied) → words
naming the migration, no zone drawn. None confirmed → "N zones are not yet
confirmed, so the floor is not drawn at all yet", with the control. Some
confirmed → those are drawn, the rest stay in the sentence.

*What is deliberately not on the wire.* `current_occupancy`. It disagrees with
the inventory rows assigned to the same zone on the only tenant that has both —
180/32/45 against 17/17/16 — so what is in a zone is COUNTED from those rows,
and a zone whose contents could not be counted renders an em dash rather than an
empty room. Confirming a zone's name is not confirming a seeder's arithmetic.

*The migration is additive and confirms nothing.* Three columns, one CHECK
constraint tying the provenance word to the timestamp, one partial index. Every
existing row arrives `zone_confirmed_at IS NULL`, which is true of every one of
them. The actor FK points at `public.users(user_id)`, not `auth.users` — the two
are disjoint here and the JWT carries the former (copying
`20260903092000:89`). **Measured live 2026-09-04**: `GET /cellar/:rid/zones`
returns 200 with `readable: false, confirmable: false` and the sentence naming
the migration, because it has not been applied to this database yet.

#### The merge of directions A and B — sketch 095

`.planning/sketches/095-cellar-merged/` (index · merged-parent ·
merged-register · merged-row-open, the last in both grounds). They are not
alternatives: A answers *where*, B answers *everything at once*, the shipped
book answers *this kind in full*, and the merge keeps all three.

- **A contributed** the room, and the only answer on the page to *where*, with
  the two verbs that come with it (walk a zone, put away what is at the door).
  **Its cost** is that it stands on `storage_locations`, which holds 87 rows
  across 7 tenants with 84 carrying one of four invented zone names. The merge
  pays that cost down by reducing the floor to a **strip on the parent, drawn
  only from zones that carry a real count and a real walk date** — a zone with
  neither is not drawn at all.
- **B contributed** "see everything" taken literally — a whisky, a keg and a
  Burgundy in one list with the register as a facet. **Its cost** is one row
  grammar for three kinds of thing, which is what the four-child IA existed to
  avoid. The merge pays it only for the eight columns that survive being
  general, and refuses the ninth (`On hand`).
- **The shipped book contributed** the spine, unchanged, and both of the others
  now hang off it rather than replacing it.
- **The merge adds one thing neither had**: the gesture set above.

#### Substituted or left out, and why

- **No migration.** The research demanded none: every column it asks for exists
  or is derivable (see the column tables). A migration for a column nobody
  writes would be schema theatre.
- **No `unit_cost` series.** `inventory_transactions.unit_cost` is filled on 3
  of 215 rows, so a cost-over-time chart off the ledger would be a line through
  three points and a lot of nothing.
- **No pour-cost / cost-per-drink card on cocktails.** It is
  `cocktail_ingredients` × each ingredient's price, and that table has 0 rows.
  Derivable the moment a bartender writes a recipe; not computed from nothing.
- **`getItemActivity` was not reused** even though it exists: it ignores its own
  `restaurantId` parameter (`inventory.service.ts:639-652` filters on
  `inventory_id` alone) and it zero-fills. Both are filed in §9; the inventory
  module is outside this page's paths.
- **The transport latency is localhost and the apply latency is jsdom**, and
  both are labelled as such rather than quoted as production numbers.

### Overlays, 2026-09-05 (sketch 102 · ADR 0112)

<!-- sketch-102-overlays -->
Generated by `.planning/sketches/102-modal-census/build.py --docs` from `census.py` — edit the census, not this table.
The rule: an object gets a sheet, a question a panel, a choice a popover; the seal never sits in a popover.

**`/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks`** — The old library added a bottle through six modals and a scanner. The register keeps one — 'carry this bottle', shared with /inventory — plus two panels for the reader's questions. The register still mounts one legacy modal today.

| Page | Overlay | Shape | Status | Where the act lives or went | Source |
|---|---|---|---|---|---|
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Carry these bottles (from a menu scan) | sheet | Migrate | The same sheet as /inventory's, opened at its 'menu scan' start. | `pages/cellar/next/WineRegister.tsx imports components/wines/MenuScannerModal.tsx:21 (legacy, fixed-inset)` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Is this the bottle? | panel | Owed | A question the reader must answer before anything is written. | `components/wines/WineValidationModal.tsx:162 · components/wines/AddWineModal.tsx:148 ('Wine detected')` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Photograph the label | panel | Target | A step answered once; the page stays dimmed beneath. | `components/scanner/CameraCapture.tsx:607 — also mounted by /get-started and the orders scanner` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Wine detail | — | Retires | The register row expands in place (sketch 095 — the house pattern for ledger tables). | `pages/WineLibrary.tsx:1297` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Reorder wine | — | Retires | An order is written on /orders (What was agreed · Make this order repeat). | `pages/WineLibrary.tsx:1486` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | How to add (chooser) | — | Retires | The carry sheet's 'Start from'. | `components/wines/AddWineSelectionModal.tsx:33` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Add wine (label photo) | — | Retires | Carry this bottle + Is this the bottle? | `components/wines/AddWineModal.tsx:148` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Add to inventory from the library | — | Retires | Carry this bottle. | `components/wines/AddToInventoryFromLibraryModal.tsx:498` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Dev: manual wine entry | — | Delete | Dev-only. Delete, or move under /dev-sandbox. | `components/wines/DevManualWineEntry.tsx:330` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Dev: label test photos | — | Delete | Dev-only. Delete. | `components/wines/DevWinePhotoUpload.tsx:106` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Add wine (unified chooser) | — | Delete | Dead code. Delete. | `components/wines/AddWineUnifiedModal.tsx:53 — nobody imports it` |
| `/cellar · /wines · /beer · /whiskey · /cocktails · /spirits · /non-alcoholic · /soft-drinks` | Wine research queue | — | Delete | Dead code. Delete. | `components/wines/WineResearchQueue.tsx:225 — nobody imports it` |

Drawn in sketch 102 (`.planning/sketches/102-modal-census/index.html`); the policy is [[0112-one-modal-policy-three-shapes-one-primitive]].

### Fifth pass, 2026-09-19 — direction B plus three grafts (sketch 121), and the confirmer's four fixes

The founder, having seen this build (the "old build": register cards, this
flat `/wines` table, the reading-stand `BottleLeaf`) beside sketch 110's
direction B side by side, kept B as the base and asked for three of THIS
build's own pieces grafted into it (ADR 0160 sec110 Owed #10, corrected):
the one-place overview, the bottle list as a full-page view opened by a
button, and the bottle leaf's "What the library knows" / "The wine's own
detail". Sketch 121 (`cellar-121/sketch-121-cellar-b-plus.html`) drew how; his
2026-09-18 answers on it are Owed #11. This pass is the confirmer's four
review items plus the piece of #11 sketch 121 draws that this build did not
yet have — **not** the direction-B/gazetteer rebuild sketch 121 also
draws (index-plus-record, side by side); that is Owed #11's still-open
"buttons" question restated below, filed rather than attempted this pass.

**What changed:**

- **The Load-500 wall, fixed (BLOCKER).** "Load 500 more" widened a single
  request's `limit` by one page each press — 500, then 1000 — and `GET /wines`
  validates `limit` against `WINE_SEARCH_MAX_LIMIT` (500, `wines.dto.ts`
  `@Max`), so the second press asked for something the gateway refuses; the
  book silently stopped growing past 500 titles, which is the exact wall
  direction A's Owed #1 forbids. Now pages by `offset` at a fixed `limit`
  (`useInfiniteQuery`, `useCellarNextData.ts`), appended; the read is also now
  ordered by `id` as a tie-breaker (`wines.service.ts`) so paging cannot see a
  row twice or miss one on a `name` tie. Test: `cellar-book.test.tsx`, against
  a mocked `apiClient` (the real client contract), not the hook.
- **The hold ceremony's state bug, fixed (MAJOR).** Under the default `hold`
  ceremony the control showed "Order sent" the instant the hold GESTURE
  finished — before the gateway had been asked anything — because
  `BottleLeaf.tsx` passed `order.mutate(...)` (return value `undefined`) into
  `OrderCeremony`'s `hold` branch, which forwarded it straight to
  `HoldToApprove` with nothing to await. `HoldToApprove` is built to seal only
  once a returned promise resolves and to refuse (never seal) on a rejection
  (`HoldToApprove.tsx:242-253`) — `BottleLeaf.tsx` now passes
  `order.mutateAsync(...)`, and `OrderCeremony` also now shows the failure
  reason beside `hold` (it showed none before) and remounts the control on an
  error as a second, independent guarantee that a retry starts clean. Tests:
  `OrderCeremony.test.tsx`.
- **`PhotographLabel`'s camera step, redrawn (MAJOR).** It mounted
  `components/scanner/CameraCapture.tsx` — shipped, shared code (three other
  callers) that draws its OWN chrome ("Scan Wine Menu", an indigo "Open
  Camera" button, an "AI Detection Pipeline" card) — under this panel's
  sketch-110A intro sentence, so two UIs disagreed on one panel. Replaced with
  two buttons over native file inputs ("Take the photo" —
  `capture="environment"` — and "Choose a photo instead"), reading to the same
  raw-base64 shape and the same `handleCapture` the old wiring used. The
  panel's content is also now padded 16px off the panel edge
  (`.mdv-ovl__body` sets no padding of its own by design — see
  `orders/next/AgreementSheet.tsx`'s own note on the same primitive — and this
  panel had no content wrapper at all). Tests: `PhotographLabel.test.tsx`.
- **The order-hold ceremony is now owner/manager only.** ADR 0160 sec110 item
  6 was answered 2026-09-18: only an owner or a manager may change it; staff
  see it but cannot. `PUT /cellar/:restaurantId/settings` had no role check at
  all — the confirmer's own open question ("any signed-in member can switch
  this house to 'auto' — one click spends money"). Gated on the ONE field the
  founder actually restricted (`holdCeremony`), not the whole endpoint — a
  `gazetteerMeasures`-only write from staff still succeeds, because nothing
  restricted that. Client: `CellarSection.tsx` disables the control for
  anyone else and names the rule, matching `UsualCurrencySection.tsx`'s own
  `canManage` idiom. Tests: `cellar-settings.service.spec.ts` (gateway),
  `SettingsNext.test.tsx` (client — this file had no `AuthContext` mock at all
  before this pass; adding one to cover the new `useAuth()` call surfaced that
  `cellar.settings`'s fixture was never reset between tests, unlike
  `cellar.current`, so a later test could silently inherit an earlier one's
  `readable: false` — fixed alongside).
  **[CORRECTION, 2026-09-19 — an independent re-verification found this
  bullet undisclosed, not merely incomplete: it named item 6 "answered" and
  reported ONLY the permission-gate half of that answer, while the ceremony
  design it shipped alongside contradicted the OTHER half of the SAME
  correction. The three-value vocabulary this pass built and gated —
  `hold`/`confirm`/`auto` (`dto/hold-ceremony.ts`, migration
  20260922230000) — was transcribed from the founder's PRE-correction
  dictation; item 6's own text says so ("the original line gave three modes
  ... his words give two"). None of the three shipped ceremonies matched
  either of his real two modes, and the shipped `auto` sent a real
  procurement order from a plain, un-held `<button>` — `OrderCeremony.tsx`'s
  old `ceremony === 'auto'` branch — which is the EXACT design his answer
  rules out ("an order with no human hold at all, which would bypass ADR
  0112's seal on a money act"). This was not caught before merge; it reached
  an independent verifier, who returned NOT READY on it. See "Sixth pass"
  below for the fix. Left in place rather than rewritten, per CLAUDE.md
  §5b/§7 — the record says what this pass actually shipped, not what it
  should have.]**
- **"The wine's own detail" is drawn (Owed #4/#11, no longer a placeholder).**
  Sketch 121 answered the question this note's Fourth pass left open (§1b
  "Substituted or left out" era) with a real drawing, and the founder answered
  its own questions 2026-09-18: "show, labelled honestly." `mapWine`
  (`wines.service.ts`) now carries `wine_structure` (body/acidity/tannins/
  sweetness — verified live against production 2026-09-19 that all four agree
  with the separate top-level `acidity`/`tannins` columns on every sampled
  row, so this reads the one jsonb source rather than mixing two), `primary_
  aromas`, and the four handling fields (`serving_temp_celsius`, `glass_type`,
  `decanting_recommended`, `aging_potential_years`) — the same
  undefined-vs-null discipline `provenance` already established, typed on
  `WireWine` rather than the shared `Wine`/`WineResponseDto` pair on purpose
  (outside `check_web_reads_gateway_dto_keys.py`'s MIRRORS list, same as
  `provenance`). `BottleLeaf.tsx` draws body/acidity/tannin as a word plus a
  5-tick bar (`cellar-format.ts`'s `structureTicks`, checked against sketch
  121's own three worked examples) and sweetness as a word alone; the serving
  sentence is whole-or-not-at-all across all four handling fields, per the
  founder's own words about this exact set. "What the library knows" now also
  composes a plain, mechanical sentence from body/acidity/sweetness together
  when the library holds no free-text note (never from two of three), labelled
  as composed rather than passed off as a tasting, and shows typical aromas
  when the library holds any. `ml_derived_features` is NOT drawn: null on
  every one of the 95 wines the houses stock today
  (`cellar-121/integration-sota-first.sql`), which is the founder's own rule
  for exactly this case ("if the value is not shown there ... don't even
  include them"); a features pipeline and the foundations document mapping
  the library to every endpoint and insight type are separate, already-scoped
  work (`docs/wine-ml-foundations`). Tests: `BottleLeaf.test.tsx` (new file —
  none existed before this pass), `wines.service.spec.ts`, `cellar-format.
  test.ts`.

**Not done this pass — filed, not attempted:**

- **Sketch 121's own IA change — a bottle opens BESIDE the register's list,
  never over or above it.** The founder's answer to sketch 121's "buttons"
  question was "Yes, as drawn": each register is a button in the page head
  (already true here — `CellarNext.tsx`'s spine), pressing one opens that
  register's full-page list (already true here — `/wines` IS a full page),
  and a bottle chosen there opens **beside a narrowed list** (a two-column
  `index | record` grid, sketch 110 direction B's own gazetteer layout).
  Today `WineRegister.tsx` instead opens `BottleLeaf` in a `.cl-stand` ABOVE
  the full, unnarrowed table (`cellar-next.css:24`, a vertical accordion) —
  the founder's most recent, most specific answer on this exact interaction
  is not yet built. This is the largest remaining gap between this build and
  his approved sketch, and it is a real layout/interaction rework (a narrowed
  side list, keyboard Space-peek/Enter/Esc against it, the record's own
  container-query breakpoints) rather than a bounded bug fix — attempting it
  in the same pass as four other fixes, on a page that carries a real,
  hold-to-approve money action, was judged the wrong tradeoff. Next step:
  a dedicated pass building sketch 121's `.gz` grid as `WineRegister`'s
  open-bottle layout, reusing `BottleLeaf` as the record pane.
  **[BUILT 2026-09-19 — Seventh pass, below. `.cl-split` (a narrowed index
  beside `BottleLeaf`) replaces `.cl-stand` in `WineRegister.tsx` only;
  `CatalogueRegister`/`CocktailRegister` keep `.cl-stand` unchanged. Space,
  Enter and Esc are covered (not the finer Space-peek/Enter-promote
  distinction — see the next bullet, still open); container-query
  breakpoints at 620px/900px. `mudavym_design_cellar`'s ALWAYS_ON_PAGES /
  `defaultValue: true` — the "go live for every house" half of the founder's
  2026-09-19 answer — was already in this diff and is now the correct
  end-state, this precondition having been met.]**
- **The Space-peek** (Space opens a peek, Enter promotes it) — a confirmer
  REVIEW ITEM, not built; its sold-line wording depends on a till-window
  query this house's `wine_consumption_log` does not yet support at more than
  one day per sim house (`cellar-121/integration-sota-first.sql` Q4).
  **[STILL NOT BUILT, 2026-09-19 — Seventh pass. Space and Enter both fully
  open the bottle (LiveRow's own pre-existing handler, unchanged); a lighter
  "peek" distinct from a full open was not attempted, same backend gap as
  before.]**
- **`menu_price_bottle`** — genuinely open (confirmer's own question): should
  `restaurant_inventory` gain a per-house bottle price column, or is the
  library's reference price acceptable as "List price (bottle)"? This pass
  reuses the library's reference price, unchanged from before.
  **[BUILT 2026-09-19 — Seventh pass, below. Migration 20260921112300 adds
  `restaurant_inventory.menu_price_bottle`, same shape as `menu_price_glass`;
  set via `AddWineToInventoryModal.tsx` (mirroring the glass-price field,
  gated on sale type including "bottle"), read in `BottleLeaf.tsx` as
  "Bottle price (this house)". The library figure is kept, relabelled
  "Market average" — the founder's own words, "our library price will be
  just the average price" — never a fallback for the house figure. This is
  the MANUAL field only: what "dynamic" should mean is the founder's own
  open question, not decided here — see the Seventh pass's own report.]**
  **[SUPERSEDED 2026-09-21 — ADR 0193, Eighth pass below. The founder answered
  "dynamic" and picked "Advise to target margin". There is ONE bottle-price
  column, `menu_price_current` (the one every margin already read);
  `menu_price_bottle` and its migration were removed before merge.]**
- **The register buttons' visual form** (a table of rows vs. a card grid) —
  `Registers.tsx` already puts the registers and "in the building tonight" on
  the SAME parent page with no click (graft #1's substance), as cards rather
  than sketch 121's plain aligned rows; left as a cosmetic difference rather
  than risked in this pass.

### Sixth pass, 2026-09-19 — the re-verification's two blocking fixes

An independent verifier reviewed the Fifth pass and returned NOT READY on
two CONFIRMED, blocking findings plus one CONFIRMED, undisclosed finding
(the bracketed correction on the Fifth pass's own ceremony bullet, above);
every other item it checked — Load-500, the hold-ceremony sent-state fix,
`PhotographLabel`, the role gate itself, "the wine's own detail" verified
live against production, and all mechanical checks — re-verified HOLD and
needed no further change. This pass fixes the two blocking findings plus one
minor one the same verifier flagged; it does not touch anything the
verifier did not flag.

**What changed:**

- **The order-hold ceremony is rebuilt to the founder's actual two modes
  (BLOCKING × 2).** `HOLD_CEREMONIES` was `["hold", "confirm", "auto"]`
  (`dto/hold-ceremony.ts`, and duplicated by hand in
  `useCellarNextData.ts` — a web page cannot import gateway code) — the
  PRE-correction vocabulary ADR 0160 sec110 item 6 itself names wrong. It is
  now `["hold", "auto"]`, matching the founder's answered correction exactly:
  the hold is the one deliberate act in BOTH modes, and they differ only in
  what happens once it completes —
  - `hold` (DEFAULT, unchanged column default): the press-and-hold gesture,
    then one more question, "Send it?" — only "Yes, order" fires the write.
  - `auto`: the SAME press-and-hold gesture, wired straight to the write —
    no follow-up question.
  `OrderCeremony.tsx` is rebuilt around this: `auto` is exactly the OLD
  `hold` branch's own mechanics (a promise-aware `HoldToApprove`, unchanged
  from the 2026-09-18 sent-state fix), and the NEW `hold` branch parks the
  hold's own promise on a ref until "Yes, order" is clicked, which only then
  calls the caller's real `onApprove` — so `HoldToApprove` still seals
  exactly when the gateway has confirmed, never on the hold completing and
  never on the "Yes" click itself (the same invariant the 2026-09-18 fix
  established, now covering the extra question too). The old `confirm`
  ceremony (a click, "are you sure?", no hold at all) is deleted outright: it
  had no counterpart in the founder's corrected two modes. Migration
  `20260922230000` had not merged past this lane, so its CHECK constraint and
  comments are corrected in place rather than superseded by a second
  migration (`check_migration_versions_unique.py` confirms no collision).
  Copy that asserted the wrong thing is fixed alongside: `BottleLeaf.tsx`'s
  order note said "This house sends an order on one click, no hold" for
  `auto`, and `CellarSection.tsx`'s picker labelled it "Click sends it" —
  both false once `auto` also holds; both now say the hold stays and only
  the question after it is skipped. Tests: `OrderCeremony.test.tsx` rewritten
  around driving the actual gesture (the keyboard arm-then-approve path,
  chosen because it needs no fake timers) rather than only asserting on
  props, so a regression back to a plain click has no path to green;
  `cellar-settings.service.spec.ts`'s three `"confirm"` fixture values moved
  to `"auto"` (removing the retired value from the suite, not just the
  schema).
- **The client-side ceremony gate now matches the server's (MINOR).** The
  server (`cellar-settings.service.ts`) has always accepted owner, manager,
  OR admin; `CellarSection.tsx`'s `canChangeCeremony` checked only owner and
  manager, so an admin saw every option disabled but could still change the
  ceremony through a direct API call — cosmetic (the server was always the
  real gate and was never too permissive), but the client should say what
  the server enforces. Fixed with the same `.toLowerCase()` type-widening
  idiom `ReceivingHome.tsx`/`ReceivingNext.tsx` already use for this exact
  gap: `AuthContext`'s own `Role` type is `"owner" | "manager" | "staff"` and
  does not declare `admin` at all, even though it is a real value the gateway
  (and this codebase's `RolesGuard`) has always accepted. Test:
  `SettingsNext.test.tsx` gained an admin case beside the existing
  owner/manager ones, and the readonly note's wording (now naming admin too)
  is re-pinned.

**On the Fifth pass's own record:** the bracketed correction above this
section is the disclosure this pass owed — the Fifth pass's ceremony bullet
was not merely incomplete, it presented item 6 as settled while shipping a
ceremony that contradicted half of that same answer. Nothing else this pass
touched needed a correction; the verifier's re-check of the other five
Fifth-pass items (Load-500, sent-state, `PhotographLabel`, the wine detail
band, the role gate's own existence) found each one HOLDS as documented.

**Still not built — carried over from the Fifth pass, unchanged by this
pass:** sketch 121's own IA change (a bottle opens beside a narrowed
register list, not above the full table — see the Fifth pass's own bullet
above), the Space-peek, `menu_price_bottle`, and the register buttons'
visual form. **New context on the first of these:** the founder's own
19-lane sequencing answer, 2026-09-19 ~09:20Z (`founder-sketch-decisions-
106-115.md`, read-only in this lane), states "cellar = build the sketch-121
beside-the-list layout FIRST, then go live for every house" — i.e. this is
no longer only "the largest remaining gap," it is a stated precondition for
this page going live at all, decided AFTER the Fifth pass was written. This
pass did not attempt it: it is a real layout/interaction rework on a page
that carries a real, hold-to-approve money action, the founder's sequencing
answer does not change its size, and attempting it inside a repair pass
scoped to a verifier's three specific findings was judged the wrong
tradeoff. Flagged to whoever runs this lane's go-live decision — see this
pass's own report.
**[BUILT 2026-09-19 — Seventh pass, below, closing the go-live precondition:
the layout AND `menu_price_bottle`. The Space-peek and the register buttons'
visual form remain not built — see the bracket on each one's own bullet
above.]**

**Checks:** `apps/web`: `tsc --noEmit` clean; `vitest run` on
`src/pages/cellar/next/` + `src/pages/settings/next/SettingsNext.test.tsx` +
`src/pages/menu/next/` — 13 files, 299/299 (299, not 295: 4 new — 2 in
`OrderCeremony.test.tsx`'s rebuilt suite, 1 admin case in
`SettingsNext.test.tsx`, and the "sent short-circuits both ceremonies" case).
`apps/api-gateway`: both tsconfigs clean; `jest` on `src/cellar/` +
`wines.service.spec.ts` + `wines-search.spec.ts` — 6 files, 83/83 (same
count — `"confirm"` fixture values were relabelled, not added to or removed
from). `check_decision_claims.sh` 358/358,
`check_no_conflict_markers.py`/`check_citation_pairing.py`/
`check_adr_numbers_unique.py`/`check_migration_versions_unique.py` all PASS.

### Seventh pass, 2026-09-19 — sketch 121's beside-the-list layout, and a house's own bottle price

An independent verifier reviewed the state after the Sixth pass and returned
NOT READY (`r4-lanes.json` entry `cellar`) on three must_fix items: (1) sketch
121's own IA change — still open above and in the Fifth pass, and now also a
stated go-live precondition (19-lane blocking round, 2026-09-19 ~09:20Z:
"cellar = build the sketch-121 beside-the-list layout FIRST, then go live for
every house") — plus a live defect the verdict named: `mudavym_design_cellar`
had already been flipped to `ALWAYS_ON_PAGES`/`defaultValue: true` in this
same diff, which would have put the OLD, ruled-out layout live for every
house the moment this branch merged; (2) `CellarSection.tsx:127`'s Note said
"Only an owner or a manager" to a set of people that has included admin since
the Sixth pass; (3) a records-sync instruction — re-run the full check set,
document this pass, hand the ADR 0160 §110 bracket to whoever owns
`wt-finish-train2`. A fourth item, outside the verifier's own scope, was the
founder's separate 2026-09-19 answer on the bottle price (batch 4 of the same
blocking round, verbatim): *"Our library price will be just the average
price that will be updating daily ... However, we're going to add a per
house bottle price. That's a huge thing ... gotta be dynamic."*

**What changed:**

- **Sketch 121's beside-the-list layout, built (BLOCKER).**
  `WineRegister.tsx` no longer opens `BottleLeaf` in `.cl-stand` above the
  full table. Choosing a bottle (click, or Enter/Space on a table row — the
  row's own pre-existing keyboard handler, unchanged) swaps the full
  table/shelf for `.cl-split`: a narrowed index of the SAME filtered `shown`
  list (name, style/vintage, on-hand-or-price — one line each) beside
  `BottleLeaf`. Closing — the leaf's own Close button, or Esc from anywhere
  in the split (bound on the outer `.cl-split` div, not the leaf alone: a
  reader who just switched bottles from the narrowed index has focus on that
  index row, a SIBLING of the leaf, not an ancestor, and an Esc handler
  scoped only to the leaf misses that case — caught by
  `WineRegister.test.tsx`'s own first run, fixed before this landed, see
  below) — returns to the full table/shelf. Focus follows the record across
  the closed↔open edge only, not on every bottle-to-bottle switch while it
  stays open (`cl-leaf-turn`, unchanged, already shows the content changed;
  see MOTIONS.md's Fifth pass for the full contract and the deliberate
  non-motion on the split itself). Container queries (`@container`, not a
  viewport media query — the first use of `@container` in `apps/web`) narrow
  the split to one column under 620px and widen the index column again at
  900px, on `.cl-split-grid` — a CHILD of the `.cl-split` div that actually
  establishes the query container, not `.cl-split` itself. **This split was
  forced by a real, measured bug, not written defensively:** the first
  version put `container-type`/`container-name` AND the grid's own
  `display: grid; grid-template-columns` on the SAME `.cl-split` element,
  which `tsc`/`vitest` cannot catch (both are silent about a CSS rule that
  parses fine and simply never matches) — a size container is never a valid
  query subject of a query rooted at itself, because the container search
  starts at the querying element's PARENT. Caught only by opening a
  standalone harness with the exact CSS in a real browser (this session's own
  scratchpad, not committed) and reading `getComputedStyle(...)
  .gridTemplateColumns` across a swept range of widths: the breakpoints
  silently never fired at ANY width with the self-referential version, and
  fire exactly at 620px/900px once the grid moved to a child. This is the
  concrete case for CLAUDE.md §9's "use the Browser pane, do not ask the
  founder to check manually" — a type check and a passing test suite both
  say nothing about whether a `@container` rule can ever match.
  `CatalogueRegister.tsx`/`CocktailRegister.tsx` are untouched and
  still use `.cl-stand` (MOTIONS.md's third pass) — this fix is
  `WineRegister.tsx` only, per the must_fix's own scope. Docs:
  `MOTIONS.md`'s Fifth pass (the retired token, the new non-motion, the
  keyboard/focus contract, why container queries over a media query on a
  page with one route today). Tests: `WineRegister.test.tsx` (new file, 11
  cases — opening by click/Enter/Space, switching bottles by click and
  keyboard, closing by the Close button and by Esc from both the leaf and
  the index, the open bottle marked in the index and only that one, focus
  moving into the leaf on a fresh open and NOT re-stealing focus on a
  switch, focus returning to whichever control opened it — the table row or
  the narrowed-index row — once dismissed); `CellarNext.test.tsx`'s existing
  89 cases re-verified green unchanged (the split only replaces what renders
  AFTER a bottle is chosen — the closed-state table/shelf and every filter
  test run through it were untouched).
  **On the live-exposure defect the verdict named:** `ALWAYS_ON_PAGES`
  containing `'cellar'` and `mudavym_design_cellar`'s `defaultValue: true`
  are UNCHANGED by this pass — they are not reverted, because the
  precondition they were gated on ("build the layout first") is what this
  pass just built and tested. Left in place rather than toggled off and back
  on, per CLAUDE.md §5b: the record says what is actually true of the tree
  now, not a round-trip through a state that was never separately committed.
- **`restaurant_inventory.menu_price_bottle`, added (founder-requested).**
  **[REMOVED 2026-09-21, before merge — ADR 0193: a second column for the
  meaning `menu_price_current` already carried. The migration file is deleted
  and every reader repointed; the account below is the record of what the
  seventh pass did, not of what ships.]**
  Migration `20260921112300_a_house_sets_its_own_bottle_price.sql`: additive,
  nullable `numeric(10,2)`, no default, no backfill, no author/timestamp
  columns — the exact shape `menu_price_glass` already has, mirrored rather
  than upgraded (a half-parity column recording who/when for one sibling and
  not the other would be a new, undiscussed decision). Verified on PGlite
  against a minimal fixture (`p4-scratch/pglite-probe/
  cellar-menu-price-bottle-probe.mjs`, same pattern as the precedent
  `p4bf-carrying-cost.mjs`): applies, and applies a second time unchanged
  (idempotent); admits $62.00, $61.99, $0.00 and a negative value (measuring
  the gap, not asserting it should be refused — `menu_price_glass` has no
  floor either, and this column mirrors it exactly rather than deciding a
  new rule for only one of the two); the in-file `DO $$` assertions (no
  default, zero rows backfilled, a probe write admitted then restored) all
  ran and passed; the two sibling columns measure identically in
  `information_schema.columns`. **Not run against the full 185-migration
  chain** (Docker is down on this host; PGlite's own no-Docker recipe was
  used instead, per project memory, but only for this one file against a
  scratch `restaurant_inventory` stand-in — the fixture does not prove this
  migration composes with every migration between it and the baseline, only
  that its own logic is sound).
  **[CORRECTED 2026-09-21 — round 5 must_fix. The "probe write admitted
  then restored" this bullet describes — UPDATE a real row to $62.00, read
  it back, UPDATE it back to whatever it held before — is REMOVED from the
  migration. Its own comment called this "leaving no trace"; it did not.
  `update_restaurant_inventory_updated_at`
  (`20260805000000_baseline_from_production.sql:12286`, a BEFORE UPDATE
  trigger calling `update_updated_at_column()`) moves `updated_at` on
  every UPDATE regardless of which column changed, so both probe writes
  moved `updated_at` on one real production row every time this migration
  ran. Proved both directions with a fresh PGlite fixture (Docker still
  down; this session's own isolated scratchpad, `@electric-sql/pglite`
  installed outside any worktree so no shared `node_modules` was touched):
  a minimal `restaurant_inventory` stand-in carrying only `id`,
  `menu_price_glass`, `updated_at` plus the real trigger and function
  bodies verbatim from the baseline citation above. Applying the ORIGINAL
  migration (recovered via `git show HEAD` before this session's edits)
  against a seeded row moved `updated_at` from the seeded value — CONFIRMED.
  Applying the CORRECTED migration (this file, as it now stands) against
  the same fixture did not move `updated_at`, on a first apply or a second
  (idempotent) — column shape confirmed `numeric(10,2)`, no default, both
  times. The three information_schema asserts (column exists, is
  `numeric(10,2)`, carries no default) plus the backfill-count check are
  UNCHANGED and still the migration's actual proof of type/default/backfill;
  the write-probe never added coverage those four didn't already have —
  admitting `62.00`/`61.99`/`0.00`/a negative value into a `NUMERIC(10,2)`
  column proves NUMERIC accepts a NUMERIC, not anything about this
  migration. `check_migration_probe_safety.py`, the targeted vitest set (16
  files, 326/326 — two more than the 324 above, from must_fix #1's two new
  cases), and `apps/web`'s `tsc --noEmit` were all re-run clean after this
  change.]**
  Gateway: `InventoryService.mapInventoryItem`
  reads it (`menuPriceBottle`), and `createInventoryItem`
  (single + bulk) and `updateInventoryItem` write it — all four sites mirror
  `menuPriceGlass`'s own four call sites exactly (`inventory.dto.ts`'s four
  DTOs, `inventory.service.ts`). Web: `services/api/types.ts` (4 interfaces)
  and `inventory.ts` (raw row + normalizer) gain the same field
  `menuPriceGlass` already carries; `useCellarNextData.ts`'s `CellarRow` gets
  `menuPriceBottle`. Set by a manager via `AddWineToInventoryModal.tsx`'s new
  "Bottle Menu Price" field, gated on `saleType` including `"bottle"`
  (mirroring "Glass Menu Price"'s own gate on `saleType` including `"glass"`
  exactly) — wired through `InventoryCommandPage.tsx`'s existing
  `volumeFields` plumbing, the current `/inventory` page (legacy
  `AddToInventoryFromLibraryModal.tsx`, mounted only from the retired
  `WineLibrary.tsx` behind `ALWAYS_ON_PAGES`, was deliberately left
  untouched — see "Not done" below). `BottleLeaf.tsx` shows it as "Bottle
  price (this house)" beside the existing "Glass price", with the same
  em-dash-plus-note treatment when unset; it is never the fallback for the
  library figure and the library figure is never its fallback — the two
  numbers are independent facts, in independent columns, and the fixture
  library used a coincidentally-equal example value once, which the test
  file's own first run caught (fixed before this landed by choosing a
  deliberately different number). Tests:
  `inventory.service.spec.ts` (+5 — the read mapping including a
  `hasOwnProperty` check that a plain `toBeUndefined()` would not have caught
  — a key never set and a key explicitly mapped to `undefined` are
  indistinguishable by value alone — plus the create, bulk-omission and
  update write paths); `AddWineToInventoryModal.bottlePrice.test.tsx` (new
  file, 5 cases — field shown/hidden per sale type exactly like its glass
  sibling, the typed value reaching the caller, the field genuinely absent
  from the payload rather than merely empty when hidden);
  `BottleLeaf.test.tsx` (+4). Every one of these was run failing before the
  matching source line existed and passing after (shown in this pass's own
  report, not restated here).
  **[CORRECTED 2026-09-21 — round 5 must_fix. "the field genuinely absent
  from the payload rather than merely empty when hidden" was true only when
  `saleType` excluded "bottle" entirely. On the DEFAULT sale type
  ("bottle"), the field was shown and left untouched, and still sent
  `menuPriceBottle: 0` — state initialised at `0`
  (`AddWineToInventoryModal.tsx:106`), coerced by `parseFloat(e.target.
  value) || 0` (line 923) — the blocking defect the round-4 verdict
  measured (probe:
  `{"bottleSizeMl":750,"saleType":"bottle","menuPriceBottle":0}`), which
  would have written $0.00 as this house's bottle price on `BottleLeaf`.
  `menuPriceBottle` is now `number | null` in the modal's own state,
  mirroring `costPerBottle`'s existing null handling in the same component:
  the key is omitted unless a number was actually typed, and an explicitly
  typed 0 still sends `menuPriceBottle: 0`. Two cases added to the same test
  file (now 7 total, up from 5): the default-sale-type-and-blank case omits
  the key; an explicitly-typed-0 case still sends 0. Both run
  failing-before/passing-after — `npx vitest run
  src/components/inventory/AddWineToInventoryModal.bottlePrice.test.tsx`:
  1 failed / 6 passed against the pre-fix source, 7/7 passed after.]**
- **The library figure relabelled "Market average" (founder-requested,
  wording only).** `BottleLeaf.tsx`'s two `price_reference` facts — the
  general "List price" and the in-cellar recap "List price (bottle)" — now
  read "Market average" / "Market average (bottle)". No column changed.
  Left DISTINCT from the neighbouring "Market price" fact
  (`retail_price_avg`, still permanently `—`, still explained by its own
  existing note) rather than merged or renamed to match — two different
  columns, two different provenances, and collapsing them into one label
  would have been the actual "invented figure" problem this whole pass is
  about, aimed at the wrong field. "Dynamic" (updating daily, tracking a
  formula) is NOT claimed anywhere in the new copy — that is the founder's
  stated intent for a mechanism this pass does not build (see "Not done"),
  and the UI does not assert a cadence nobody has verified.
  **[CORRECTED 2026-09-21 — round 5 must_fix. This bullet originally said
  the founder's words "describe what this figure has always structurally
  been (a reference price the library computes across houses and
  vendors)" — nothing in the tree computes that; it was an unverified
  restatement, not a measured fact. `price_reference` is an imported
  reference hint, passed straight through with no cross-house/vendor
  computation: the JSONL import writes it unchanged
  (`import_master_wine_library.py:149,168`,
  `price_reference = EXCLUDED.price_reference`) and so does a submission
  payload (`wines.service.ts:420`, `payload?.price_reference ??
  payload?.price ?? null`). The sibling column on `beverages` names the
  same fact plainly: "Market hint only, never a restaurant's actual price"
  (`20260817070000_beverages_table.sql:230-232`). The founder's
  daily-refreshed, cross-house/vendor average is real intent — restated
  correctly two sentences up ("that is the founder's stated intent for a
  mechanism this pass does not build") — but not built yet; this bracket
  corrects only the false claim that it was already how the figure worked.
  The "Market average" label is unchanged; `BottleLeaf.tsx`'s note and its
  own comment block carry the same correction, dated the same day. The
  migration header's parallel claim ("the one column that has always been
  a market-wide figure") is corrected the same way in
  `20260921112300_a_house_sets_its_own_bottle_price.sql`.]**
- **`CellarSection.tsx:127`'s Note, corrected (must_fix #2).** "Only an
  owner or a manager of this house can change this" is now "Only an owner, a
  manager, or an admin" — the round-2 report had claimed this fix and it was
  not made; it is now, with a direct assertion on the Note's own text added
  to the existing `'lets an admin change it too'` case in
  `SettingsNext.test.tsx` (which previously asserted only that the controls
  were enabled, not what the explanatory copy said to the person looking at
  them). Failing before / passing after shown in this pass's own report.

**Checks (final tree):** `apps/web`: `tsc --noEmit` clean;
`vitest run` on `src/pages/cellar/next/` (12 files, 248/248),
`src/pages/settings/next/SettingsNext.test.tsx` (57/57),
`src/components/inventory/AddWineToInventoryModal.{cost,bottlePrice}.
test.tsx` (10/10). `apps/api-gateway`: both tsconfigs (`tsconfig.json`,
`tsconfig.spec.json`) clean; `jest` on `src/inventory/` + `src/cellar/` +
`wines.service.spec.ts` — 14 suites, 155/155 (re-measured three times after
an initial run misread; this repo's own §5b rule — numbers are re-measured,
never copied forward). `check_decision_claims.sh`
358/358; `check_no_conflict_markers.py` / `check_citation_pairing.py` /
`check_adr_numbers_unique.py` all PASS. **`check_migration_versions_unique.py`
ran and reported OK, but did not see this pass's own new migration file** —
it lists migrations via `git ls-files`, which is blind to an untracked file,
and this lane stages nothing (the orchestrator commits through a verified
index). Its "OK" is real for every migration already tracked on this branch;
it is not evidence about `20260921112300` specifically. That file's own
version was instead checked by hand: swept `origin/main` (max
`20260919120000`) and every sibling `wt-*` worktree's
`supabase/migrations/` (max observed `20260919150000`, `wt-pg-receiving`) —
`20260921112300` sits past both. Re-run the guard once this pass's files are
committed and visible to `git ls-files`.
**[UPDATED 2026-09-21 — round 5. The round-4 work landed as a single
snapshot commit (`e7afb2ce7`, "NOT READY, do not merge") on `r5/cellar`
before this round started, so every file above — the new migration
included — is tracked and `git ls-files`-visible now; the caveat above no
longer applies to this tree. Re-measured after closing the three round-5
must_fix items: `apps/web` `tsc --noEmit` clean; `vitest run` on the same
four targets plus `src/pages/menu/next/` — 16 files, 326/326 (up from 324;
`AddWineToInventoryModal.bottlePrice.test.tsx` alone is now 7/7, up from 5,
two cases added by must_fix #1). `check_migration_versions_unique.py`:
"OK — introduced by this branch: ...20260921112300..., checked against
origin/main + 36 other open PR(s)" — it now sees and names the file
directly, no hand-sweep needed. `check_migration_probe_safety.py`: PASS,
re-run after must_fix #3 dropped the write-probe. `check_decision_claims.sh`
358/358 (unchanged — no claim in `CLAIMS.jsonl` names this migration or
either corrected fact). `check_flag_readby_anchors.py` PASS (23 anchors,
unchanged). `check_web_reads_gateway_dto_keys.py` and
`check_no_seeded_defaults.py` both PASS against the corrected modal.
`check_migration_ledger.py` and `check_beverage_identity_parity.py` still
cannot run in this environment — the first needs a database URL none of
`SUPABASE_DB_URL`/`SUPABASE_POOLER_URL`/`SUPABASE_POOLER_CONNECTION_STRING`/
`SUPABASE_DIRECT_CONNECTION_STRING` supplies, the second needs a `.env` file
that does not exist in this worktree — both exit non-zero rather than
false-passing, and neither is about anything must_fix #1-#3 touched.]**

**Not done this pass — filed, not attempted:**

- **The Space-peek and the register buttons' visual form** — unchanged from
  the Fifth pass; see the bracket on each one's own bullet above. Neither
  was in this pass's must_fix list or the founder's bottle-price answer.
- **[ANSWERED 2026-09-21 — ADR 0193; built in the Eighth pass below.]**
  **What "dynamic" means for the house's own bottle price is the founder's
  own open question, not decided here** (CLAUDE.md §0.1 — an undecided fork
  is not this lane's to default). His words name an intent ("gotta be
  dynamic") but not a mechanism. Returned as a founder question, with
  options and a recommendation, in this pass's own report — not filed as an
  OPEN-DECISIONS row (this lane holds no OD allocation this round) and not
  guessed at in the migration or the UI. Only the MANUAL field is built.
- **`AddToInventoryFromLibraryModal.tsx`** (the OTHER add-wine modal, mounted
  only from the legacy `WineLibrary.tsx`) was not given a matching bottle-
  price field. `mudavym_design_cellar`'s `ALWAYS_ON_PAGES` entry means that
  legacy page is not reachable in ordinary use (only via the per-browser
  localStorage override), so extending it was judged out of proportion to
  this pass — flagged here rather than silently left inconsistent.
- **The ADR 0160 §110 bracket, handed off, not written.** This worktree
  carries no `.planning/decisions/0160-*.md` at all (that ADR lives on
  `feat/mudavym-finish` / `wt-finish-train2`, not yet merged to `main`, so
  this lane cannot read or edit it — CLAUDE.md §7/houseRules: work stays
  inside this lane's own worktree). The bracket text to add to its §110,
  verbatim, is given in this pass's own report for whichever session owns
  `wt-finish-train2` to paste in.

### Eighth pass, 2026-09-21 — the price follows the menu and the manager; advice aims at the house's margin (ADR 0193)

The founder, verbatim: *"Dynamic means two things 1. it could be changed every
time a menu is updated and secondly it should be changed whenever the manager
wants and also ... recommendations ... make sure that endpoint exists that we
will ask or recommend or advise the manager or owner to increase decrease the
prices so that the profit margin is where it's needed. We don't want market
average because that will be already shown in another column"* — and he picked
"Advise to target margin". Everything built is listed in
[ADR 0193](../decisions/0193-a-house-price-follows-its-menu-and-its-manager-and-advice-aims-at-its-own-margin.md)
§Decision; this page's share of it:

- `BottleLeaf.tsx` "Bottle price (this house)" now reads `menu_price_current`
  through the same `menuPriceBottle` wire field; its "set one in Inventory"
  note is now true (`/inventory` → "Your price", owners and managers).
- `/inventory` gains "Your price" (bottle · glass, edited in place) beside
  "Market", with the advice under it ("Raise btl to $57.14", one tap).
- Settings gains "Target margin" (bottle %, glass %, close-enough points; no
  default).
- `/menu` price corrections and added lines now write the house price
  (`change_source = 'import'`); the menu-line PATCH is house-scoped.

Forks F1-F7 (who may change a price, the band's units, menu dating, a priceless
menu line, create-path attribution, the defaulted pour and bottle sizes under
glass advice) are in the ADR for the founder to confirm.

## 2. Entry
Sidebar item (`apps/web/src/components/layout/Sidebar.tsx:79`). PAGE_MAP records
in-degree 1 (`.planning/foundation/PAGE_MAP.md:148`). Not an orphan route.

## 3. Files
- Route: `apps/web/src/App.tsx:260` → `pages/wine-library/index.tsx` (3-line re-export of `pages/WineLibrary.tsx`, 1,901 lines)
- State/filter hook: `apps/web/src/pages/wine-library/useWineLibraryPage.ts` (353 lines)
- API→UI mapping: `apps/web/src/lib/wine-library.ts` (`mapApiWinesToUiWines`)
- Modals: `components/wines/AddWineModal.tsx`, `AddWineSelectionModal.tsx`, `MenuScannerModal.tsx`, `components/scanner/MenuScannerFlow.tsx`, `DevWinePhotoUpload.tsx`, `DevManualWineEntry.tsx`, `AddToInventoryFromLibraryModal.tsx` (imports at `WineLibrary.tsx:4-10`)

**Mudavym cellar (flag on)** — five routes, one component:
- Routes: `apps/web/src/App.tsx:297` (`/wines` → `<CellarNext category="wines"/>`), `:302` (`/cellar`, the bare parent), `:303-305` (`/beer` `/whiskey` `/cocktails`), each wrapped in `<PageGate page="cellar" …>` with the legacy page (or a redirect to `/wines`) behind the flag
- `apps/web/src/pages/cellar/next/CellarNext.tsx` — root, ground, register strip, the parent's opening voice
- `apps/web/src/pages/cellar/next/Registers.tsx` — the register cards this house carries, the "how this was decided" line, the "Not on the list" band, the "In the building tonight" strip, and `Tally`
- `apps/web/src/pages/cellar/next/WineRegister.tsx` — the register: search, six filters, sortable columns, Register/Shelf views, the reading stand
- `apps/web/src/pages/cellar/next/BottleLeaf.tsx` — the reading stand: facts, notes + provenance, bring-into-the-cellar, hold-to-order
- `apps/web/src/pages/cellar/next/CatalogueRegister.tsx` — the beer / whiskey / spirits / cocktails / non-alcoholic / soft-drinks registers, each honest about its scope (replaced `UnwiredRegister.tsx`, deleted 2026-09-03 once the reads existed)
- `apps/web/src/pages/cellar/next/CellarRegistersStep.tsx` — **exported** for the onboarding surface to mount: the inference shown as a proposal, every line editable, all seven confirmed at once
- `apps/web/src/pages/cellar/next/CellarRegistersControl.tsx` — **exported** for the Settings cellar register to mount: seven switches with their evidence, and the manual-on path
- `apps/web/src/pages/cellar/next/NeedsItemsNotice.tsx` — `RegisterNotice`: the inline, register-aware, aggregating ask, and its symmetric off-with-items twin
- `apps/web/src/pages/cellar/next/RegisterEvidenceLine.tsx` — one register's evidence in one line, shared by all three surfaces so they cannot describe it three ways
- `apps/web/src/pages/cellar/next/registerShapes.ts` — what each register is, what is missing, and the schema columns it would carry (measured from the migrations, cited in the file header)
- `apps/web/src/pages/cellar/next/useCellarNextData.ts` — all fetching + view models
- `apps/web/src/pages/cellar/next/cellar-format.ts`, `cellar-next.css`, `MOTIONS.md`
- Tests: `CellarNext.test.tsx` + `CellarRegisters.test.tsx` — **44 tests**, all green

**Gateway files added by the second pass** (outside this page's original paths;
the p4 second-pass rule permits editing the gateway for gaps this note filed):
- `apps/api-gateway/src/cellar/cellar-registers.ts` — the vocabulary and the pure inference
- `apps/api-gateway/src/cellar/cellar-registers.service.ts` — the four tenant reads, the two catalogue reads, and the write
- `apps/api-gateway/src/cellar/cellar.controller.ts`, `cellar.module.ts`, `dto/cellar-registers.dto.ts`
- `apps/api-gateway/src/beverages/beverages.service.ts`, `beverages.controller.ts`, `beverages.module.ts`, `dto/beverages.dto.ts`
- `apps/api-gateway/src/wines/wines.service.ts` — `beverage_kind` + `classification_status` on the wire
- `apps/api-gateway/src/app.module.ts` — two module registrations
- `supabase/migrations/20260903092000_restaurant_cellar_registers.sql`
- Specs: `cellar/cellar-registers.spec.ts`, `cellar/cellar-registers.service.spec.ts`,
  `beverages/beverages.service.spec.ts`, `wines/wines.service.spec.ts` — **44 tests**, all green

## 4. Endpoints
- `GET /wines` (search, `limit: 500`) — `services/api/wines.ts:30` via `useWines` (`useWineLibraryPage.ts:96-99`); ENDPOINTS.md:667
- `GET /inventory` — stock overlay via `useInventory` (`useWineLibraryPage.ts:100`)
- `GET /providers` — `services/api/providers.ts:201` via `useProviders` (`useWineLibraryPage.ts:101`)
- `GET /providers/recommendations?restaurantId&wineId` — `services/api/providers.ts:314-316` via `useRecommendedProviders` (`WineLibrary.tsx:161`), fires on wine selection
- `POST /inventory` — add-to-inventory flow, `services/api/inventory.ts:80` via `AddToInventoryFromLibraryModal`
- Realtime: wine update subscription over WebSocket (`useWineSubscription`, `WineLibrary.tsx:48`)

**Added by the Mudavym cellar** (same `apiClient`, bearer attached):
- `POST /procurement/orders` — the real order path, replacing the legacy "Reorder" that wrote nothing. Contract verified: `apps/api-gateway/src/procurement/procurement.controller.ts:112` → `procurement.service.ts`, body `CreateOrderDto` at `apps/api-gateway/src/procurement/dto/procurement.dto.ts:34-121`. **Keyed on `inventoryId`, not `wineId`** (`:37`) — this is why a catalogue-only bottle cannot be ordered and the control is disabled with the reason. `restaurantId` and `userId` come from the JWT, and the controller stamps `source: "manual"` itself (`:120-124`)
**Added by the second pass, 2026-09-03** (all new gateway code, all curl-verified
against the local gateway on :4000):
- `GET /cellar/:restaurantId/registers` — which registers this house carries, each with
  `carried`, `decidedBy`, `confidence`, a sentence of `basis`, `evidence`
  (`inventoryRows` / `menuRows` / `catalogueRows`, each nullable), `needsEvidence` and
  `strandedItems`; plus `sources` (five, each `readable`/`reason`/`rows`),
  `awaitingConfirmation` (`boolean | null`), `needsEvidence[]`, `stranded[]`,
  `unmappedKinds` and `unmappedCatalogueTypes`.
  `apps/api-gateway/src/cellar/cellar.controller.ts` → `cellar-registers.service.ts`
- `GET /cellar/:restaurantId/registers/unplaced` — the menu lines behind the readout's
  `menuLines.notPlaced`: `{ restaurantId, read, lines: [{ id, category, name }] }`. Read
  by `useUnplacedMenuLines` only when "Show me the N" is pressed (§14, OD-140)
- `PUT /cellar/:restaurantId/registers` — the house's answer.
  Body `{ registers: [{ id, carried }], source: 'inferred'|'confirmed'|'manual' }`.
  The actor comes from the JWT and `evidence` is snapshotted server-side from the live
  inference; the client never reports what it believed the machine said
- `GET /beverages/:restaurantId?register=&type=&search=&limit=` — the shared beverage
  reference catalogue. Response carries `scope: 'global-reference'`, `scopeNote`,
  `matchedTypes`, `servedByThisTable` and `truncated`
  (`apps/api-gateway/src/beverages/beverages.controller.ts`)
- `GET /cocktails/:restaurantId?search=&limit=` — this restaurant's cocktails only,
  with `referenceRows` (unattributed demo-corpus rows) counted apart and
  `recipesAvailable: false`
- `GET /wines` now carries `beverageKind` and `classificationStatus` on every row
  (`apps/api-gateway/src/wines/wines.service.ts`, spec `wines.service.spec.ts`)

**Added by the fourth pass, 2026-09-03** (curl-verified against :4000):
- `GET /beverages/:restaurantId/row-record?label=` — every line of this house's
  five books that names one row, in time order: per book a `price` series, a
  `quantity` series and the `ledger` those series were made of, plus
  `readable`/`reason`/`rows` and the `source` table named. Carries `matchRule` in
  words, and `nothingNamesIt` only when every book was readable AND empty.
  `apps/api-gateway/src/beverages/beverages.controller.ts` →
  `beverages.service.ts:readRowRecord` → `row-record.ts` (pure, 13 specs).
  **Measured live 2026-09-03**: `label=Chardonnay Reserve (glass)` → 200 in
  0.33 s, `named: ["pos"]`, 11 till lines with an 11-point price series and an
  11-point quantity series; menu, invoice and order each `readable: true,
  rows: 0` with their own sentence; `label=Nothing Like This At All` → 200,
  `named: []`, five sentences and no rows. This read serves BOTH the expanded
  row and the series a cell opens, so opening a row costs one request and
  opening a cell on that row costs none.

**Added by the fourth pass, 2026-09-04** (the two founder decisions):
- `GET /cellar/:restaurantId/zones` — this house's storage zones split by
  whether a human has confirmed the name: `confirmed[]` (the floor draws these),
  `unconfirmed[]` (counted, listed only inside the control), `counts`,
  `readable`/`reason`, `confirmable` and `scopeNote`. What is in a zone is
  counted from `restaurant_inventory.storage_location_id`, never from
  `current_occupancy`. `apps/api-gateway/src/cellar/zones.service.ts`
- `PUT /cellar/:restaurantId/zones/:zoneId` — confirm the name as it stands
  (empty body) or rename it (`{ name }`). The actor comes from the JWT, never
  the body. Writes `zone_confirmed_at`, `zone_confirmed_by`, `zone_provenance`;
  a write that matched no row raises rather than reporting success.
  **Measured live 2026-09-04**: the GET returns 200 with `readable: false` and a
  reason naming migration `20260904130000`, which is not applied to this
  database yet — the honest state, and it flips on merge

## 5. Signals
none. No `uxSignals`, no tracking calls (grep of `WineLibrary.tsx` + `wine-library/` — zero hits).

## 6. Tier cut
Core. Scenarios: S06 (new dish/menu item — wine catalogue is the working half), S17 (same
product two identities — this page renders the merged library), S10 (stock-status chips
feed the stockout story). See TIER-MAP rows S06/S10/S17.

## 7. Rebrand surface
none — no user-visible `WineOps` strings on this page.

## 8. State & config
All client state (view mode, 9 filters, sort cycle) in `useWineLibraryPage.ts:74-93`.
`measurementUnit` from `useRestaurantSettingsStore` drives volume rendering.

**Feature flag: `mudavym_design_cellar`** — registered
(`apps/api-gateway/src/settings/feature-flag-registry.ts:179-183`), **default
OFF**, migration `supabase/migrations/20260902230000_mudavym_design_flags_p4.sql`.
It gates all five routes at once through `<PageGate page="cellar" …>`: off, `/wines`
renders `WineLibrary` byte for byte and the other four redirect to it; on, all
five render `CellarNext`.

**Per-browser override: `localStorage['mudavym.design.cellar']`** — `'1'` forces
the redesign on, `'0'` forces it off, ahead of the server flag
(`apps/web/src/lib/mudavym/useMudavymDesign.ts`).

The redesign's own client state (search text, six filters, sort key + direction,
Register/Shelf view, which bottle is open on the stand) lives in `WineRegister.tsx`
and is **not** persisted — it is a reading position, not a preference.

**Which registers the house carries is NOT client state.** It lives in exactly one
place, `public.restaurant_cellar_registers`, read and written through
`/cellar/:rid/registers`. Nothing on `restaurants`, nothing in a store, nothing in a
constant — the page's `REGISTER_ORDER` is a vocabulary and an order, never an answer.

**Per-browser, and only these:** `localStorage['mudavym.cellar.notice.<kind>.<registers>']`
— whether a register notice has been dismissed on this browser. Deliberately not a
column: a server-side dismissal would be a second piece of state about the register,
and the notice says on its face that dismissal is per-browser.

## 9. Gaps — enrichment surfaces here, but thin
- **Market Price column is plumbing without data**: wired to
  `master_wine_library.retail_price_avg`, which is **null on all 442 rows** — renders
  "—" until price enrichment exists (`v3.0-TECH-DEBT.md:543-549`, the sentence at
  :547 — this note previously cited :432-440, an unrelated roadmap section; render at
  `WineLibrary.tsx:1075-1089`).
- **Enrichment fields arrive on the wire and are dropped**: the API `Wine` type carries
  `description`, `tastingNotes`, `pairingNotes`, `appellation`, `imageUrl`
  (`services/api/types.ts:324-328`), but `mapApiWinesToUiWines` maps none of the notes
  fields — the page never shows tasting/pairing text (`lib/wine-library.ts` has no
  `tastingNotes`/`description` mapping; verified by grep).
- **Body filter is dead**: `body` is hardcoded to `'medium'` for every wine
  (`lib/wine-library.ts:32`), so the Body filter (`useWineLibraryPage.ts:204-206`)
  can only match everything or nothing.
- `liveStock: null, threshold: 6` are hardcoded in the mapper for catalogue-only wines
  (`lib/wine-library.ts:38-39`) — the reason Stock/Status columns were dropped
  (`v3.0-TECH-DEBT.md:544-545`).
- **44.1b**: wine-library duplicate-add silently loses stock and reports success
  (`v3.0-TECH-DEBT.md:47-49`).
- 44.15's claim of "no bulk select or column sorting on wines" is stale: column sort
  exists (`useWineLibraryPage.ts:306-319`) and bulk selection exists
  (`WineLibrary.tsx:409-427`) (`v3.0-TECH-DEBT.md:391-393` — catalog reconciliation
  pending).

### Ninth pass, 2026-09-21 — the founder's seven answers, menu versions, and the go-live (ADR 0193, round 2)

The founder answered ADR 0193's seven forks and added menu versions the same day; the
record, his one verbatim phrase (*"percent is always shown everywhere"*), and the four
follow-up questions are in [ADR 0193](../decisions/0193-a-house-price-follows-its-menu-and-its-manager-and-advice-aims-at-its-own-margin.md)
§"Amendment, round 2". This page's share:

- **`/menu` keeps every menu** (`MenuVersions.tsx`): the current one and the last one
  used named in a sentence, every kept menu with its date or cadence, who read it, its
  line count, and its source (open the PDF/photo, or why it was not kept); a form to read
  a new menu with an optional cadence and date; after a read, "Make this the current
  menu" / "Keep it, not current" (owners and managers; staff are told who chooses). A
  current menu's line whose price was blank for a price the house has shows the flag's
  sentence under its status.
- **The onboarding review screen** offers the same choice after a scan.
- **Settings, Target margin**: "close enough" is typed as a percent of the advised price;
  a new "Pour size" row confirms the house's pour once (glass advice waits for it).
- **`/inventory` "Your price"**: a glass waiting for the pour says "glass waits for your
  pour size"; a malformed advice answer is "advice unavailable" on the row instead of
  crashing the page (a merge interaction with main's `InventoryCommandPage.test.tsx`).
- **Add wine**: a blank glass price is no longer sent as 0.
- **Go-live**: `cellar` and `menu` join `LIVE_PAGES` (18 keys), on the founder's
  2026-09-19 answer quoted in the Seventh pass; `mudavym_design_cellar` moves to
  `LIVE_IN_CODE_FLAGS` and the flip script's live set. `ALWAYS_ON_PAGES` is gone —
  main's `LIVE_PAGES` is the one mechanism.

### Gaps outside this page's paths, found while building the cellar (2026-09-02)

Each one is a file the p4 page agent does not own; none was built.

1. ~~**No endpoint serves `beverages` or `cocktails`.**~~ — **CLOSED 2026-09-03**
   by this page's second pass: `apps/api-gateway/src/beverages/` serves both
   read-only, tenant-named and JWT-guarded, with `beverages.service.spec.ts`.
   `/beer` `/whiskey` `/cocktails` show real rows. The original finding, kept
   because the measurement in it is still the reason the registers are
   catalogue-only: All **52 `@Controller(...)`
   declarations across 50 files** in `apps/api-gateway/src/**` were enumerated
   (`grep -rn "^@Controller(" apps/api-gateway/src --include="*.ts"`, re-counted
   2026-09-02 — an earlier draft of this note said 48, which was wrong; the
   substantive claim was not). None is `beverages`, `cocktails` or `spirits`;
   the only catalogue controller is `@Controller("wines")`
   (`apps/api-gateway/src/wines/wines.controller.ts:30`).
   The tables exist — `public.beverages`
   (`supabase/migrations/20260817070000_beverages_table.sql:217`), `public.cocktails`
   and `public.cocktail_ingredients` (`20260817090000_cocktails.sql:27,60`), plus the
   beverage views at `20260817080000`. **This is what blocks `/beer` `/whiskey`
   `/cocktails`**; needs a `beverages.controller.ts` and a `cocktails.controller.ts`.
2. ~~**`WinesService.mapWine` drops `beverage_kind` and `classification_status`.**~~
   — **CLOSED 2026-09-03**: both are carried, with `wines.service.spec.ts` pinning
   the `undefined` (column not selected) vs `'unknown'` (classifier's verdict)
   distinction. Verified live: `GET /wines?limit=1` returns
   `"beverageKind":"wine"`. The original finding:
   `searchWines` does `select("*")` (`wines.service.ts:354`) so both columns arrive on
   the row, but `mapWine` (`:75-131`) never carries them onto the wire. Consequence:
   the browser cannot count, filter or even *report* how many beers the library holds —
   which is why the three unwired registers show no number at all. One field in one
   mapper unlocks the whole "flat register with a kind facet" alternative in §1b.
3. **`CreateOrderRequest` is wrong on the client.** `services/api/types.ts:279-285`
   declares `wineId`, but the gateway's `CreateOrderDto` requires **`inventoryId`**
   (`apps/api-gateway/src/procurement/dto/procurement.dto.ts:37`), so
   `ordersApi.createOrder` (`services/api/orders.ts:76-85`) would be refused. CellarNext
   posts the correct body through `apiClient` directly and does not use the helper; the
   shared type and helper still need fixing for every other caller.
4. **`pairingNotes` and `imageUrl` have no producer.** Both are on the client `Wine`
   type (`services/api/types.ts:327-328`), but a grep of `apps/api-gateway/src/wines/`
   finds **zero** references to either — `mapWine` maps `producer_story` → `description`
   and `tasting_notes` → `tastingNotes` and nothing else. The cellar's view model reads
   all four so they light up the moment a producer exists; two of them will always be
   null until then. (§13.4 of the old roadmap is therefore only half free.)
5. **`cocktail_ingredients` is empty by design** — "recipes are not in the extracted
   data … they need a separate extraction pass over the cocktail sections"
   (`20260817090000_cocktails.sql:20-25`). A cocktails register without that pass can
   only ever list names.
6. **`restaurant_inventory` is keyed on `wine_id` → `master_wine_library`**, so even
   once beverages are served, a keg or a bottle of rye cannot be stocked, ordered or
   counted without an inventory identity axis that is not wine-shaped. This is the
   real cost of the four-child IA and it is bigger than the two missing controllers.
7. ~~**`check_no_seeded_defaults.py` `SCAN_ROOTS` does not list
   `apps/web/src/pages/cellar/next`**~~ — **CLOSED 2026-09-02** by the parent session:
   the entry is now at `scripts/check_no_seeded_defaults.py:205` and the repo-wide run
   reads this page (`PASS — 108 web file(s) … across 19 root(s)`). It was worth filing:
   until that line existed the guard passed repo-wide *without reading this page*, which
   is "absence reported as health" inside the guard itself.
8. **`components/wines/MenuScannerModal.tsx` is legacy chrome.** White card, indigo →
   purple gradient header, framer-motion — rendered on top of the İznik page. It is
   lazily imported so it costs nothing until opened, but it needs a Mudavym pass.
9. **No nav entry for the cellar.** `components/layout/Sidebar.tsx:92` links `/wines`
   only; `/cellar` and the three children are reachable from inside the page and from a
   cold URL, nothing else. The parent surface needs the sidebar slot, with `/wines`
   demoted to a child.
10. **Three registers have no route.** `App.tsx` routes `/wines` `/beer` `/whiskey`
    `/cocktails`; Spirits, Non-alcoholic and Soft drinks open on the parent as
    `/cellar?register=<id>`, which is deep-linkable but is not a route.
    `apps/web/src/App.tsx` needs three more `<Route>` lines beside the existing
    four, using the same `PageGate page="cellar"` shape.
11. **`CellarRegistersStep` and `CellarRegistersControl` have no mount point.**
    Both are finished, exported and tested in
    `apps/web/src/pages/cellar/next/`, and neither is rendered anywhere: the
    onboarding surface (`apps/web/src/pages/get-started/`) and the Settings page
    (`apps/web/src/pages/settings/`) are other agents' directories. Until they are
    mounted, the only way a house can answer is the API. See §13.
12. **Notice dismissal is per-browser.** `localStorage`, not a column — deliberate
    (a server-side dismissal would be a second home for state about a register),
    but it means an operator who dismisses on the office machine sees the notice
    again on the tablet. A real per-user dismissal needs a column and an ADR.
13. **The seasonal-menu case still cannot MOVE the items.** A register switched off
    with items behind it now says so and keeps them visible under "Not on the
    list", which is the honest half. The other half the backtest names — "hide them
    or move them" — needs a real bulk action on `restaurant_inventory` / `menu_items`
    that does not exist, and would be a procurement/inventory decision, not a
    catalogue one.
14. **The classifier can miss what the human typed.** `beverage_kind` resolves from
    `primary_type`, else the menu's own section header. A house that types a section
    called "Spritzes" and switches on Cocktails may leave `needsEvidence` true
    indefinitely, because nothing maps that word to that register. The notice would
    then be permanently correct-looking and permanently useless — the failure mode
    the backtest names for scenario 4. A synonym table for section headers, or a
    "this section is my Cocktails" mapping, closes it.
15. **The write path is not yet verifiable end to end, and this is disclosed
    rather than papered over.** The local gateway on :4000 points at the shared
    Supabase project, where `restaurant_cellar_registers` does not exist until
    the migration merges (migrations auto-apply on merge to `main`). So
    `PUT /cellar/:rid/registers` was curl-verified to **fail correctly** — HTTP
    500 carrying *"The house's answer was not recorded: … the
    restaurant_cellar_registers table is not on this database yet"* — and not
    yet verified to succeed. The read path degrades exactly as designed in that
    state: `sources.answers.readable: false`, `rows: null` (not 0), and
    `awaitingConfirmation: null` (not false). The success path is covered by
    specs with the client mocked, and by the CHECK constraint in the migration;
    it needs one live re-verification after the migration lands.
16. **The scanner has no add path.** `MenuScannerTab.handleValidationApprove`
    (`:160-172`) and the legacy `onWinesDetected` (`WineLibrary.tsx:1813-1822`) both
    only mutate component state. `bulkCreateInventoryItems` accepts a `wineDraft` and
    resolves it server-side (`services/api/inventory.ts:97-103`), which is the shape a
    real "scan → shelf" path should use.

### Gaps found in the third pass (2026-09-03) — the beverages catalogue

17. ~~**Three registers still have no route.**~~ — **CLOSED 2026-09-03** by the
    parent session: `App.tsx:321-323` now mounts `/spirits`,
    `/non-alcoholic` and `/soft-drinks`, and `REGISTER_ROUTE` in
    `cellar-format.ts` carries the matching three entries, so in-page links and
    routes agree. Both halves are pinned by tests added after the Sonnet audit:
    three `draw({ category })` render assertions and one asserting
    `registerHref` returns the route `App.tsx` actually mounts. The original
    finding, kept because the constraint it names still binds any future
    register:
    `App.tsx` is outside this page's paths. `CellarNext`'s `category` prop now
    accepts all seven register ids, so the three lines below are the whole of
    what is needed; until they land, `/spirits`, `/non-alcoholic` and
    `/soft-drinks` open as `/cellar?register=<id>`, which is deep-linkable and
    works today. The exact lines, to sit beside the existing `/cocktails` route
    at `apps/web/src/App.tsx:305`:

    ```tsx
    <Route path="/spirits" element={<PageGate page="cellar" legacy={<Navigate to="/wines" replace />} next={<CellarNext category="spirits" />} />} />
    <Route path="/non-alcoholic" element={<PageGate page="cellar" legacy={<Navigate to="/wines" replace />} next={<CellarNext category="non_alcoholic" />} />} />
    <Route path="/soft-drinks" element={<PageGate page="cellar" legacy={<Navigate to="/wines" replace />} next={<CellarNext category="soft_drinks" />} />} />
    ```

    They also need `REGISTER_ROUTE` in `cellar-format.ts` extended with
    `spirits: '/spirits'`, `non_alcoholic: '/non-alcoholic'`,
    `soft_drinks: '/soft-drinks'` — that file IS this page's, and the entries
    are deliberately **not** added yet, because a `<Link to="/spirits">` with no
    route behind it is a dead link. The two changes land together or not at all.

18. **The house's record is dark until migration `20260903120000` is applied.**
    `public.house_beverage_ledger` does not exist on the database :4000 talks
    to; migrations auto-apply on merge to `main`. Measured live 2026-09-03: all
    six registers return **200**, the catalogue half renders (beer 57, whiskey
    272, spirits 400 capped, non-alcoholic 10, soft_drinks 0 by design,
    cocktails 0), and `house.readable` is `false` with the reason naming that
    file. The degradation is the designed one and is verified; the *populated*
    path is covered by 36 gateway specs and 59 web tests with the client mocked,
    and needs one live re-verification after the migration lands. Same posture,
    and same reason, as gap 15.

19. **`beverage_house_key` is a second key, and can be misused.** It is derived
    from `beverage_tokenize`, granted to `service_role` and `authenticated`
    only, documented reporting-only, and asserted in the migration. There is no
    guard preventing somebody storing it on a row, which is the one abuse ADR
    0108 forbids. A `scripts/` guard would be the right shape;
    `scripts/` is outside this page's paths.

20. **`pos_unresolved_lines` is the only sales record a non-wine has, and
    nothing else in the product knows that.** `/reports`, `/recommendations` and
    the analytics engine all read sales through inventory-keyed tables, so every
    beer and cocktail a house sells is invisible to them. Not this page's to fix;
    filed because the measurement was made here.

21. **The cocktails register cannot deplete a base spirit.**
    `cocktail_ingredients.beverage_id` is now writable, but pouring a Negroni
    cannot reduce anything, because the gin has no stock row. Same OD-113 gate.

22. **`vendor_price_observations` rows with a NULL `restaurant_id` are excluded
    from the ledger on purpose** — a scraped public list price belongs to
    everyone (`20260805154027_vendor_price_observations.sql:53-56`), so it is
    not this house's quote. That means a bottle only ever seen on a public
    catalogue shows "who quoted" as the em dash. Correct, and worth knowing
    before somebody reads the dash as missing data.

23. **The happy-path cocktail create was NOT exercised against the live
    database, deliberately.** :4000 points at the real Supabase, and inserting a
    test cocktail would leave a row in a real tenant. Every route was verified
    instead through its refusal paths, which exercise the same guard, DTO,
    tenancy filter and error shape: `POST` with no name **400**, `POST` naming
    another tenant **403**, `PATCH`/`DELETE`/`GET`/`PUT ingredients` against a
    ghost uuid **404** carrying *"a write that matched no row must not report
    success"*, `PATCH` with a non-uuid **400**, and no token **401**. The insert
    payload itself is asserted in `beverages.service.spec.ts` (that
    `restaurant_id` comes from the path and a body `restaurantId` is ignored).
    One live create-then-retire is still owed once there is a scratch tenant to
    do it in.

### Gaps found in the fourth pass (2026-09-03) — columns, gestures and the live path

**9.20 · The columns the field asks for exist and nobody writes them.** This is
one gap with eight faces, and none of them needs a migration:

| field | column, already in the schema | measured |
|---|---|---|
| beer style, IBU | `beverages.type_attributes` (JSONB, `20260817070000_beverages_table.sql:266`) | `{}` on all 609 rows |
| ABV | `beverages.abv_pct:228` | 0 of 609 |
| format, package | `beverages.volume_ml:229`, `.package_format:230` | 0 of 609 |
| whisky age, cask, expression, proof | `beverages.age_years:262`, `.cask_finish:263`, `.expression:264`, `.proof:265` | 0 of 609 — the migration's own comment says "Left NULL at migration time — parsing is separate, future work" |
| cocktail build, glass, garnish | `cocktails.method`, `.glass`, `.garnish` (`20260817090000_cocktails.sql:31-33`) | 0 of 55 |
| cost per pour | `cocktail_ingredients.quantity`/`.unit` | 0 rows in the table |
| case size | `procurement_document_lines.pack_size` | 0 rows in the whole table |
| market price | `master_wine_library.retail_price_avg` | 0 of 3,562 (carried from §9 pass one) |

**What is needed is a writer, not a column.** Owner: the enrichment worker for
the first five, the bartender for the cocktail three (they have a write path as
of pass three), the invoice parser for the case size.

**9.21 · `restaurant_inventory.total_revenue` and `.times_ordered_count` are a
default with no writer.** NOT NULL on all 206 rows and **zero on all 206**
(measured 2026-09-03). Any surface that renders either as a figure will print a
counted-looking zero. This page refuses both by name and pins the refusal in
`cellar-columns.test.ts`; other surfaces should be swept. Outside this page's
paths.

**9.22 · `getItemActivity` ignores its own `restaurantId`.**
`apps/api-gateway/src/inventory/inventory.service.ts:639-652` filters
`inventory_transactions` on `inventory_id` alone; the `restaurantId` parameter
is accepted and never used. `JwtAuthGuard` asserts the caller may read the
restaurant in the PATH, but nothing asserts the item belongs to it, so a caller
holding tenant A's token can read tenant B's depletion series by passing B's
inventory id. Inventory module is outside this page's paths — filed, not fixed.

**9.23 · The same endpoint zero-fills its 14-day series.**
`inventory.service.ts:688-696` builds "a dense 14-day series (zero-filled) so
the chart has a stable x-axis", so a day before the house's first POS line
renders identically to a day nobody bought anything — and its heatmap is a 7x8
matrix of 16:00–23:00 only (`:660-684`), which drops every lunch service and
every café. The cellar's own `rowSeries.ts` does neither and says so; the
inventory one still does.

**9.24 · Two producers dispatch `inventory_change` with different payload
shapes.** `apps/web/src/lib/websocket.tsx:492` sends
`{inventory_id, restaurant_id, stock_after}`;
`apps/web/src/contexts/RealtimeContext.tsx:376` sends
`{type, wineId, quantity}`. A reader that assumed either one would silently
ignore half the traffic. `readStockEvent` accepts both and is tested against
both; the shape should be unified in the RealtimeContext, which is outside this
page's paths.

**9.25 · `public.vendor_price_observations` has NO foreign keys at all.**
Verified 2026-09-03 — `pg_constraint` returns zero rows of `contype = 'f'` for
that relation — so PostgREST cannot resolve `providers(name)` and any read that
embeds it 400s with "Could not find a relationship". `house_beverage_ledger`
gets the vendor name with an explicit SQL LEFT JOIN, which PostgREST has no
equivalent for; the row-record read therefore takes the vendor from
`vendor_name_raw` and says so. A `provider_id` FK would fix it for every reader
at once, and is a migration this page did not take.

**9.26 · The end-to-end realtime leg cannot be measured from here.** Nothing
emits `stock:updated` without the RabbitMQ bridge
(`apps/api-gateway/src/common/orchestrator/rabbitmq-bridge.service.ts:333`),
which is not running against this worktree. Transport and apply are measured
(§1b); the number between them is not, and no figure is quoted for it.

**9.27 · `procurement_documents` carries a status but no payment date.** So the
order ledger can say a line was *invoiced* and cannot say it was *paid*. The
founder's phrase was "order ledgers maybe when clicked on paid", and this is the
one word of it the books cannot support today. No line in the expander claims
settlement.

### Gaps found on 2026-09-04 — the floor, and two things outside this page

**9.28 · `storage_locations.current_occupancy` is the seeder's arithmetic.** On
the only tenant that has both, it says 180/32/45 against 17/17/16 inventory rows
actually assigned to those zones (measured 2026-09-04). Nothing on this page
reads it — the floor counts the assigned rows instead — but it is still on the
table and any other surface that reads it will print a fabricated occupancy. It
should be nulled or recomputed. Outside this page's paths.

**9.29 · `/settings`' storage-location editor does not stamp provenance.** A
zone a manager creates today lands with `zone_provenance = 'unconfirmed'` (the
column default) and has to be confirmed a second time, on a page that is not the
one they added it from. The writer should stamp `'created'` with the timestamp
and actor, which the new CHECK constraint already allows. Filed rather than
fixed: the settings module is outside this page's paths.

**9.30 · MEASUREMENT CORRECTION, and the lesson in it.** This note carried
"87 rows across 7 tenants, 84 of them carrying one of four invented zone names"
from 2026-09-02, and repeated it in three places including a sketch. Re-measured
2026-09-04: **4 rows across 2 tenants, 4 of 4 carrying one of those names.** 83
rows were deleted in between. The shape of the finding survived and the count
did not, which is the argument for re-measuring a number every time it is
restated rather than copying it forward — the corrected figure is now in §1a
(:197), §1b (:551, :956) and `095-cellar-merged/merged-parent.html:204`, each
dated. (Those three references were themselves wrong when first written — they
said "§1b, §12" and named the sketch's `index.html`; §12 never carried the
number and the sketch that does is `merged-parent.html`. Corrected 2026-09-04,
by opening each one.)

**9.31 · The gateway boot guard is RED on this branch, and not because of this
page.** `check_gateway_boots.sh` fails with
`ReferenceError: Cannot access 'AuthModule' before initialization` at
`organizations.module.js:28`. Attributed by reverting this page's gateway
changes on disk and re-running: **it still fails**. The ring is another
builder's in-flight change — `communications.module.ts` now imports
`IntegrationsModule`, `AuthModule` already imports `CommunicationsModule`, and
`IntegrationsModule` imports `AuthModule`. Their `forwardRef` fixes Nest's DI
graph but not the ES-module load order, which is what this crash is. Not fixable
from this page's paths.

**9.32 · A bottle opens ABOVE the register's table, not BESIDE a narrowed
list.** The founder's most recent, most specific answer on sketch 121
("Yes, as drawn") wants a two-column `index | record` layout when a bottle is
open; `WineRegister.tsx` opens `BottleLeaf` in a `.cl-stand` that expands
above the full, still-unnarrowed table instead (`cellar-next.css:24`). Filed
2026-09-19 rather than built this pass — see the Fifth-pass section above
("Not done this pass") for why and the next step.

## 10. Maturity

**hollow.** Browsing works and is real. The page's two headline *actions* — "order this
wine" and "save this as a recurring order" — report success and write nothing, and the
export ships fabricated wine attributes as fact.

| Evidence | `path:line` |
|---|---|
| **"Order created" — no order is created.** `handlePlaceOrder` writes a plain object into a Zustand store and navigates. There is no POST anywhere in the handler. The alert reads *"Order created for {wine} … The AI will contact the selected provider(s) via Plivo. You'll receive notifications as they respond. Redirecting to Orders page…"* — none of which has happened; [[orders]] merely opens with a prefilled modal the user must still submit. | `WineLibrary.tsx:313-382`, alert text `:360-368`; staging `setPendingReorder(orderData)` `:349` |
| Plivo is a real SMS integration in the repo — but it belongs to `communications`, is not called by this flow, and mocks itself when unconfigured. The sentence is asserting a system behaviour that does not occur. | `apps/api-gateway/src/communications/sms.service.ts:23-37` |
| **"Save as recurring order" is component state.** `savedPreferences` is a bare `useState` map, and the per-wine "recurring" badge reads from it. It is lost on navigation and on reload — and the app *has* a real `recurring-orders` module the control does not touch. | `WineLibrary.tsx:140,320-332,1012`; unused backend `procurement/recurring-orders.controller.ts:36` |
| **Fabricated attributes are exported as data.** `mapApiWineToUiWine` hardcodes `body:'medium'`, `sweetness:'dry'`, `acidity:'medium'`, `alcohol:0`, `aromas:[]`, `flavors:[]` for **every** wine — and the export builder ships exactly those as columns *Body / Sweetness / Acidity / Alcohol % / Aromas / Flavors*. A 500-row CSV in which every wine is medium-bodied, dry and 0% ABV leaves the product looking like a dataset. | mapper `lib/wine-library.ts:32-37`; export columns `WineLibrary.tsx:459-464` |
| **A whole provider block is fabricated per wine** — `{ name:'Unknown Provider', contact:'Contact Provider', phone:'N/A', email:'N/A', address:'N/A' }`. Not currently rendered (the UI reads real providers from `useProviders`), but it is what `action.wine.provider.name` resolves to in [[dashboard]]'s one-tap path (`OneTapActionCenter.tsx:588,603`). | `lib/wine-library.ts:45-51` |
| **Market Price is plumbing without data** — bound to `master_wine_library.retail_price_avg`, whose only writer is a Celery task that is scheduled but has no deployed worker (see [[inventory]] §10). | `WineLibrary.tsx:1075-1089`; `lib/wine-library.ts:24-26`; `jobs/celery_app.py:118`; `v3.0-TECH-DEBT.md:543-549` |
| **Enrichment arrives on the wire and is discarded.** `description`, `tastingNotes`, `pairingNotes`, `imageUrl` are on the API type and unmapped. | `services/api/types.ts:324-328`; `lib/wine-library.ts` (no mapping) |
| Reads are genuine: `/wines` search over `master_wine_library` with the inventory overlay and a live WebSocket subscription. | `wines.controller.ts:38`; `wines.service.ts:489`; `WineLibrary.tsx:48` |

**The verdict above still stands, because the flag is OFF and the legacy page is
what ships.** Behind `mudavym_design_cellar` the maturity is **partial**, not
hollow: every fabricated attribute is gone, "Reorder" is a real
`POST /procurement/orders` behind hold-to-approve, "save as recurring" is absent
rather than lying, and the three unwired registers state their own absence. What
keeps it from *complete* is named and not hidden — `/beer` `/whiskey`
`/cocktails` have no data path at all (§9.1), market price has no producer
(§9 above), and the menu scanner still cannot add (§9.10). When the flag flips,
this frontmatter moves to `partial`.

## 11. Data flow

### Calls out

| Method · Path | Auth | Gateway controller | Returns |
|---|---|---|---|
| GET `/wines?limit=500` | JWT (class) | `wines.controller.ts:30-38` → `wines.service.ts:489` | master library rows incl. `retail_price_avg` (null on all rows today) |
| GET `/wines/:wineId`, `/wines/:id/similar`, `/wines/meta/*` | JWT | `:52-80` | detail, similars, facets |
| GET `/inventory/:rid` | JWT | `inventory.controller.ts:35` | stock overlay |
| GET `/providers` | JWT | `providers.controller.ts:215` | roster for the reorder picker |
| GET `/providers/recommendations?restaurantId&wineId` | JWT | `providers.controller.ts:101` → `providersService.getRecommendations` | ranked providers for the selected wine |
| POST `/inventory/:rid/items` | JWT | `inventory.controller.ts:53` | add-to-inventory — **this one does persist** |
| WS wine updates | socket | `websocket` module | live catalogue edits |

All calls go through `apiClient` (bearer token attached, `services/api/client.ts:62`).

### Fed by

| Producer | Mechanism | `path:line` |
|---|---|---|
| `master_wine_library` rows | menu/label scanning (`MenuScannerFlow` → orchestrator `/api/v1/scan/*`), wine submissions, and the seeded corpus | `services/wineDetection.ts:342-457`; `wines/wine-submissions.service.ts` |
| Provisional stubs → resolved wines | `research.dispatch_batch` Celery beat, hourly at :30 — **no-op unless `RESEARCH_DISPATCH_ENABLED=true`** | `jobs/celery_app.py:150-158` |
| `critic_scores` + `retail_price_avg` | `score.rescore_stale_wines` Celery beat, 03:00 UTC — **no worker in any deploy config** | `jobs/score_tasks.py:16,277`; `jobs/celery_app.py:118` |
| Stock overlay | [[inventory]]'s ledger | `inventory.service.ts` |
| Body / sweetness / acidity / alcohol / aromas / flavors | **no producer — hardcoded in the client mapper** | `lib/wine-library.ts:32-37` |

**Finding:** six of the page's wine attributes have no producer at all — they are
constants — and two more (market price, research enrichment) have producers that are
scheduled but not running.

### Writes

| Write | Lands in | Downstream |
|---|---|---|
| Add to inventory | `restaurant_inventory` via `POST /inventory/:rid/items` | [[inventory]], low-stock sweep, dashboard |
| Add wine (scan / manual) | `master_wine_library` + submissions queue | the catalogue itself |
| "Remove from library" | `user_preferences.removedWines` — a **per-user view filter**, not a catalogue change; the alert's "still available in the Master Library" is accurate | `WineLibrary.tsx:302-311` |
| Reorder | **nothing** — in-memory Zustand only (§10) | [[orders]] reads it on mount (`Orders.tsx:449`) if the SPA was not reloaded |
| Save as recurring | **nothing** — `useState` (§10) | none |

## 12. Design intent

**Should be:** the master catalogue as this restaurant sees it — what exists, what we
carry, what it costs us versus the market, and a one-tap route from "we're out of this"
to a real purchase order.

| State | Handled? | Evidence |
|---|---|---|
| loading | yes | `useWines` flags |
| empty | mixed — Market renders "—" (honest); Body/Alcohol render fabricated constants (dishonest) | `WineLibrary.tsx:1075-1089` vs `lib/wine-library.ts:32-37` |
| error | no | no error branch; three flows use `alert()`/`confirm()` rather than the app's toast system (`:301,317,360`) |
| permission-denied | no | one owner-shaped view; §1 says staff can read but nothing enforces or adapts |

**Where the UI misleads**

1. **A success alert for a write that never happened** (§10) — the canonical §44.2 shape,
   made worse by naming a delivery mechanism (Plivo) that is not involved.
2. **A persistence promise for a checkbox in `useState`** — "save as recurring" survives
   nothing, next to a backend module that would have stored it.
3. **Fabricated tasting attributes exported as a dataset** (§10).
4. **A dead Body filter** — every wine is `'medium'`, so the control can only match all or
   none (`useWineLibraryPage.ts:204-206`).

**The same four states, behind `mudavym_design_cellar`** (each asserted by a test
in `CellarNext.test.tsx`):

| State | Handled? | How |
|---|---|---|
| loading | yes | "Opening the book…" / "Counting the cellar…"; a skeleton is never shown for a value that is permanently unknown |
| empty | yes | "The book is open and empty — the library holds no titles"; a filtered-to-nothing register says so separately and offers to widen; an *unwired* register never renders empty, it renders its absence |
| error | yes | the book fails → `role="alert"` in words with a retry and **no register at all**; the cellar fails → "on hand" is unknown for every row, said in a `role="status"` line; the vendor book fails → the order control says nothing can be chosen |
| permission-denied | yes | no active branch → "No restaurant is active on this account… The book is unread — not empty" — and **only after `authLoading` clears**, so a resolving session is never called a denied one (found live, see §1b) |

**Added 2026-09-03 — the register readout has its own four states, and they are
distinct from the four above.** `confirmed`/`manual` (the house said so),
`inferred` (read from its books, unconfirmed), `unknown` (no books to read: all
seven drawn, muted, none claimed) and `unread` (the readout failed: the wine
register alone, in words). `awaitingConfirmation` is `boolean | null`, and null
means the answers table could not be read — never `false`, which would suppress
the onboarding step for every house on a database missing the migration.

## 13. Roadmap

1. **Make Reorder create an order, or stop saying it did.** Either `POST
   /procurement/orders` here, or change the alert to "Draft prepared — review it on
   Orders". The second is a five-minute honest fix; the first is the right product.
   *Blocker: none.*
2. **Wire "save as recurring" to `recurring-orders`, or remove the checkbox** — the
   controller already exists (`recurring-orders.controller.ts:36`).
3. **Drop the six fabricated columns from the export** (and the Body filter with them)
   until a producer exists. Exporting constants as measurements is the most damaging
   thing on this page because it leaves the building as a file.
4. **Map the enrichment fields that already arrive** — `description`, `tastingNotes`,
   `pairingNotes`, `imageUrl` (`services/api/types.ts:324-328`). Free content, zero new
   endpoints.
5. Replace `alert()`/`confirm()` with the toast + dialog system used everywhere else.
6. Market Price: deploy the scoring worker or remove the column — same decision as
   [[inventory]] §13.2, and it should be made once for both. *Blocker: founder decision
   on running Celery beat/worker.*

### Roadmap for the cellar (added 2026-09-02, ordered)

1. ~~**Carry `beverage_kind` onto the wire**~~ — **DONE 2026-09-03** (§1b second
   pass). Verified live: `GET /wines?limit=1` returns `"beverageKind":"wine"`.
2. ~~**Serve `public.beverages`**~~ — **DONE 2026-09-03**:
   `apps/api-gateway/src/beverages/`, with `GET /cocktails/:rid` beside it.
3. **Decide the inventory identity axis for non-wine stock** (§9.6). Until this is
   settled a beer can be *listed* but never counted, ordered or received, so registers 2
   and 3 would be read-only catalogues. *Blocker: founder decision — this is an ADR.*
4. **Run the cocktail-section extraction pass** that fills `cocktail_ingredients`
   (the read itself is DONE). Listing cocktail names without recipes is worth less
   than the other two registers. *Blocker: the extraction pass.*
5. **Give the cellar its sidebar slot** (§9.9) — `/cellar` as the nav entry, `/wines`
   demoted to a child. *Blocker: none; outside the page agent's paths.*
6. **Fix `CreateOrderRequest`** (§9.3) so every caller uses `inventoryId`, then delete
   the direct `apiClient.post` in `BottleLeaf`. *Blocker: none.*
7. **Add `apps/web/src/pages/cellar/next` to the seeded-defaults guard's `SCAN_ROOTS`**
   (§9.7) so CI actually reads this page. *Blocker: none.*
8. **A real scan → shelf path** (§9.10) via `bulkCreateInventoryItems`'s `wineDraft`,
   after which "Read a menu" can go back to being "Add wines from a menu".
9. **Bring back bulk selection and export** once there are real columns to export
   (§1a) — name, producer, vintage, style, origin, format, list price, on hand. The six
   fabricated attribute columns never come back.
10. **The cellar floor** (§1b alternative 1) as the parent surface, once
    `storage_locations` holds trustworthy rows. *Blocker: cleaning up the 84 invented `storage_locations` rows (§1b alt. 1).*

### Roadmap for the adaptation (added 2026-09-03, ordered)

1. ~~**Mount `CellarRegistersStep` in onboarding.**~~ — **DONE 2026-09-03.**
   Mounted in `/get-started` behind `useMudavymDesign('cellar')`
   (`apps/web/src/pages/GetStarted.tsx:175`), lazy-loaded (`:37-39`), rendered
   immediately after the menu-import review completes (`:259-273`) and as the
   last Activate step when a menu already exists (`:433-441`). The wrapper
   `apps/web/src/components/onboarding/CellarRegistersOnboarding.tsx` supplies
   `useCellarRegisters()` and enforces this note's own contract: it asks only
   when `awaitingConfirmation === true`, renders nothing and continues the flow
   when the readout is already answered or could not be read (`:47-52`), and is
   skippable ("Confirm later — you can change this under Settings → Cellar").
   With the flag off `/get-started` renders unchanged. Covered by
   `apps/web/src/pages/__tests__/GetStarted.cellarRegisters.test.tsx` (8 tests).
   The original entry read: the component is finished, exported and tested in
   `apps/web/src/pages/cellar/next/CellarRegistersStep.tsx`; it takes
   `{ readout, loading, error, onConfirm, saving, saveError }` and nothing else.
   Data comes from `useCellarRegisters()` in `useCellarNextData.ts`. Show it when
   `awaitingConfirmation === true`; show nothing when it is `null` (unknown), and
   never re-ask a house whose answers merely could not be read. *Blocker: none;
   outside this page's paths.* — all three of those conditions are now enforced
   at the mount and asserted by the test.
2. **Mount `CellarRegistersControl` in the Settings cellar register.**
   `apps/web/src/pages/settings/` — same shape, plus `onChange(registers, 'manual')`
   wired to `saveRegisters.mutateAsync`. This is the "change it in Settings" the
   cellar's own one-liner promises, and until it exists that sentence points at a
   control that is not on screen. *Blocker: none; outside this page's paths.*
3. **Three routes for the three routeless registers** (§9.10). *Blocker: none.*
4. **Decide the inventory identity axis for non-wine stock** (OD-113, §9.6). This is
   now the single largest constraint on the cellar: five of the seven registers are
   browsable catalogues with no "On hand" column because `restaurant_inventory` is
   keyed on `master_wine_id`. Until it is settled, a house can declare it carries
   beer and can never count a keg. *Blocker: founder decision — this is an ADR.*
5. **A synonym map from menu section headers to registers** (§9.14), so a house that
   writes "Spritzes" is not told forever that its cocktails register is empty.
6. **Per-user notice dismissal** (§9.12), if the per-browser one proves too weak.
   Needs a column and an ADR; do not add a second store for it.
7. **Move or hide the stranded items** (§9.13) — the half of the seasonal case that
   needs a real bulk action rather than a sentence.
8. **`/menu` as a real surface** — held per the menu research's recommendation until
   OD-113 is decided, and when built it must READ `restaurant_cellar_registers`,
   never write a competing answer.

### Roadmap for the beverages catalogue (added 2026-09-03, ordered)

1. **The three routes** (§9.17) — three lines in `App.tsx` plus three entries in
   `REGISTER_ROUTE`, together. Costs nothing and finishes the IA.
2. **Re-verify the ledger live** (§9.18) — one curl per register after migration
   `20260903120000` merges, confirming `house.readable: true` and a real record
   on a real row. Until that is done, the populated path is spec-covered only.
3. **A guard against storing `beverage_house_key`** (§9.19) — the one abuse
   ADR 0108 forbids, currently prevented by prose alone. `scripts/`, blocking,
   exits 2 when it cannot check.
4. **Measure the loose tier before widening or narrowing it** —
   `counts.matchedLoosely` is already on the wire. If it is attributing spend
   wrongly even once, drop to `exact` only; if it is near-zero and correct, the
   next tier (producer-token containment) becomes arguable. Do not guess.
5. **Deplete a base spirit from a poured cocktail** (§9.21) — needs OD-113.
6. **Teach the rest of the product about `pos_unresolved_lines`** (§9.20) — every
   non-wine sale is invisible to `/reports` and the analytics engine today. This
   is the largest thing this pass found and the smallest part of it is on this
   page.
7. **Publish a register to the guest** — DESIGN-FOUNDATION §6 marks it *later*;
   the rows now carry enough (name, producer, price on the list) that it is a
   presentation problem rather than a data one.
8. **Deadstock and velocity on the row** — DESIGN-FOUNDATION §6 table stakes.
   `pos_unresolved_lines` gives velocity for a non-wine today; deadstock needs a
   stock figure, so it waits on OD-113 with everything else.

### Roadmap for the fourth pass (added 2026-09-03, ordered)

1. **A writer for `beverages.type_attributes`** — beer style and IBU first. It
   is the single highest-value missing writer on this page: a beer register with
   no style is a list of brand names, and Untappd makes Style one of only three
   required fields on a menu beer. No migration; the column is JSONB and empty.
2. **A writer for the whisky projections** (`age_years`, `cask_finish`,
   `expression`, `proof`) — the parse pass the migration itself defers.
3. **A `provider_id` foreign key on `vendor_price_observations`** (§9.25), so
   every reader can embed the vendor instead of each one working around it.
4. **Unify the `inventory_change` payload** (§9.24) to the websocket bridge's
   shape, and delete the second reader branch here once it lands.
5. **Fix `getItemActivity`'s tenant scope and its zero-fill** (§9.22, §9.23) —
   or retire it in favour of `rowSeries.ts`, which already answers the same two
   questions without either fault.
6. **A payment date on `procurement_documents`** (§9.27), so the order ledger
   can distinguish invoiced from paid.
7. **The end-to-end realtime measurement** (§9.26), once the RabbitMQ bridge can
   be run against a worktree.
8. ~~**The floor strip on the parent**~~ — **BUILT 2026-09-04** over confirmed
   zones only, with a confirm-your-zones step and migration
   `20260904130000`. What remains is not a build but a fact about the data: no
   zone is confirmed anywhere yet, so the strip draws nothing until a manager
   walks the list. See §1b. Two follow-ons, neither on this page:
   **(a)** the seeded `current_occupancy` figures should be nulled or
   recomputed — they are the same seeder's arithmetic and no surface should read
   them; **(b)** `/settings`' storage-location editor writes new zones and does
   not set `zone_provenance = 'created'`, so a zone a manager adds today arrives
   unconfirmed and has to be confirmed a second time.
9. **Split the directory** (§1b's size disclosure): three register grammars
   into `registers/wines/`, `registers/cocktails/`, `registers/catalogue/`, and
   move `CellarRegistersStep` / `CellarRegistersControl` to the pages that mount
   them (`/get-started`, `/settings`). Both cross into other pages' paths, which
   is why the fourth pass disclosed the size rather than fixing it.
10. **One row shape for both register grammars**, so `WineRegister` can drop its
   own `COLUMNS` and `sortValue` (`WineRegister.tsx:71`, `:83`) and read
   `cellar-columns.ts` like every other register. It needs `BottleVM` and
   `RegisterRowVM` reconciled — which is the same identity question as OD-113,
   from the other end.
11. **Sugar and caffeine on a non-alcoholic row** — nothing in the schema carries
   either; `type_attributes` would hold them without a migration the moment a
   source exists (GS1 GDSN nutrient attributes are the standard shape).

### The identity axis is decided — OD-113 closes (added 2026-09-04)

The founder decided it on 2026-09-03, on this page's own question: **one house
item id across all beverages.** It is written up as
[[0115-the-house-item-is-the-ledgers-key]] — *Proposed*, the founder locks —
with migration `supabase/migrations/20260903171000_the_house_item_is_the_ledgers_key.sql`
**written and NOT applied** and `scripts/check_house_item_invariants.py` beside
it. That closes the blocker under every OD-113 line above: roadmap item 4 ("Decide
the inventory identity axis"), item 5 ("Deplete a base spirit from a poured
cocktail"), item 8 (`/menu` as a real surface), the beverages roadmap's item 8
("Deadstock and velocity on the row"), and item 10's `BottleVM` /
`RegisterRowVM` reconciliation, which the note already identified as *"the same
identity question as OD-113, from the other end"*.

**The shape, in one line:** the house item is `restaurant_inventory.id` — the row
this page's wine register already reads. It stops being a wine:
`master_wine_id` becomes a nullable **attribute**, and the row gains `kind`,
`uom`, `display_name`, `beverage_id` and `identity_provenance`. No new table, and
therefore no dual-write window; a `house_items` view carries the name. The ADR's
own §H1 records the `house_items` *table* that was the leading shape and why it
lost — 18 foreign-key dependents and 199 gateway call sites' worth of window in
which a half-written row looks correct.

**What changes on this page when the ADR locks, and only then:**

- §1a's two `DARK / GATED` lines both fall. *Live vs shadow* and *Par and
  reorder* (the hatched cards at the table in §1b) become arithmetic over
  `stock_live` and `threshold_min`, which a keg's row now has.
- `STOCKING_WITHHELD` (`apps/api-gateway/src/beverages/house-record.ts:183`) and
  the literal `available: false` at `:176` are deleted **in the same change as
  the write path**, never before it. The literal type was chosen so that a
  future build could not flip the flag without removing the sentence next to it;
  this is that removal, and doing it early would leave a working button over a
  ledger that cannot take the row.
- One line must go first, and it is not on this page:
  `apps/api-gateway/src/inventory/inventory.service.ts:69` reads
  `row.master_wine_library?.bottle_size_ml ?? 750` and then divides by the pour
  size, so a keg with no library row behind it would be published as five
  glasses. That is why the migration is gated rather than merely staged.

Nothing on this page is built for it yet, and nothing here should be until the
founder locks the ADR. The registers keep saying what they say today, which
remains true.

**Three sub-decisions, founder 2026-09-04**, all recorded in ADR 0115 and none
built here:

1. **Retirement, not deletion.** The library FK becomes `ON DELETE RESTRICT` and
   soft-delete is the only way to retire a wine, so a catalogue edit can no longer
   erase a house's stock. Measured first: `master_wine_library.deleted_at` is
   already exercised (664 of 4 226 rows), no live database function hard-deletes
   from that table, and 0 of the 199 stocked wines are retired. A link to a retired
   wine is **flagged, never cascaded**, and phase 2 gains a producer — *"a wine
   your house stocks was retired from the library"*, naming the rows — because
   after this change a retirement is otherwise completely silent to the house
   still pouring it.
2. **A house item exists only through an explicit "carry this"** that states kind
   and unit in the same step. This settles what this page's own registers may do
   with the five books: a menu, invoice, quote or till line that matches no house
   item **stays unmatched and says so** — it is never auto-promoted into a stock
   row. Roadmap item 4's *"add-to-inventory gated on OD-113"* therefore becomes
   one deliberate action per row, not a background reconcile.
3. **The first enrichment writer funded is beer style and IBU**, which is exactly
   the fourth-pass roadmap's item 1 above (*"the single highest-value missing
   writer on this page"*). Re-measured 2026-09-04: `beverages.type_attributes` is
   `{}` on **all 608** catalogue rows, so the 57 beer rows carry 0 styles and 0
   IBUs. Two writers, and the row says which spoke: the house at carry-time
   through a style picker, and the catalogue where a `beverage_id` match exists.
   The house may still not write to `public.beverages` — ADR 0108's refusal is
   unchanged; the house's own value lands on the house item instead. The
   vocabulary is settled too: the **BJCP style list with an `other` escape** — an
   off-list style is typed as free text under `other` and flagged for the
   catalogue, style sorts and filters, and `other` sorts last. That escape is what
   keeps a closed list honest here: without it an operator has to file a real beer
   under a wrong style, and a wrong style is indistinguishable from a right one on
   this page's register, whereas `other` announces itself.
4. **What would fill the `quote` line — [ADR 0117](../decisions/0117-a-price-sighting-names-its-source-its-date-and-its-unit.md)
   (Proposed, 2026-09-04).** §9's *"`vendor_price_observations` — 0 in the whole
   database"* was re-measured on production **2026-09-04** and still reads 0, so the
   *who quoted it, off what* column of every register on this page is a permanent em
   dash today. The ADR decides what would end that, and the answer is **not** a feed:

   - **First fill is the house's own paper.** `price_history` has a writer
     (`procurement.service.ts:900`, from receipt verification at `:2902` and order
     confirmation at `:4393`) and it writes a **different table**, so a verified
     invoice line — trust tier 1, the best provenance this house will ever have —
     never lands where this page reads. Mirroring it in is step one and needs no
     vendor, no terms and no network. Both tables are at **0 rows** today.
   - **`master_wine_library.price_reference` cannot be promoted to fill it.**
     Measured 2026-09-04: **3,674 of 4,226** rows carry one, and **3,474 come from
     `source='menu_corpus'`** — restaurant *menu* prices, what a diner pays for a
     glass. The column has **no date and no issuer**, so under the ADR's admission
     test it is not a sighting at all. `retail_price_avg` exists and is NULL on all
     4,226. This closes the tempting shortcut of showing 3,674 quotes tomorrow.
   - **A public list price is a separate line, never this column.** The two sources
     that parsed cleanly on 2026-09-04 (Iowa Liquor Products, 13,762 rows; Oregon
     OLCC, 3,856) are **spirits-only control-state shelf prices** — Iowa's is its own
     cost × **exactly 1.50** at the median — and neither serves any tenant state.
     Written with `restaurant_id NULL` they would appear in every house's ladder,
     which is the comparison ADR 0111's index rule forbids.

   Registry with today's fetch result per source:
   [`.planning/07-reference/price-sources.md`](../07-reference/price-sources.md).
   Proof (dry run, writes nothing): `scripts/fetch_price_sightings.py`.

   **Update 2026-09-04 — the separate-line side is now built.** The third bullet's
   "separate line, never this column" is now a real register:
   `price_index_postings` (`supabase/migrations/20260904200000_a_posted_price_names_its_state.sql`)
   plus the gateway `price-index/` module — **California live** (class-B beer posting),
   **Iowa/Oregon** control-state shelf lines (class D), **Michigan withheld** (403, no
   parser). Keyed by state, never restaurant, so it can never enter a house's ladder;
   read at `GET /price-index/:state?product=` and drawn as its own labelled line. This
   does **not** fill the `quote` column on this page's registers — that is still class A,
   still 0 rows — it is the neighbour line ADR 0111 always intended. Beer is the only
   category live today; wine still waits on a class-B or class-C wine source (NY SLA
   unverified; Wine-Searcher quote pending, Q5).

### 13.x A bottle has one identity, and this page's registers can name it (ADR 0124, 2026-09-05)

Answering ADR 0117 Q28 — *which pages should the shop sweep read* — put a
**trade-item register** beside the library rather than columns on it:
`beverage_identities` (`supabase/migrations/20260905140000_a_bottle_has_one_identity.sql`),
keyed on `producer · name · vintage · size · pack`, with every code that names a
bottle (GTIN, LWIN, TTB COLA, a source's item code, our own row ids) as a row in
`beverage_identity_keys` and every proposed link waiting for a person in
`beverage_identity_candidates`.

**Why the library did not get the column, measured read-only 2026-09-05.**
`master_wine_library.bottle_size_ml` is **750 on all 4,226 rows** — one distinct
value, the column DEFAULT — and only **2 of 3,562** live rows name a format
anywhere in `name`. So this page's library does not know the size of a single
bottle it holds, and a wine sold in 750 ml and in magnum is **two trade items**
(GS1 GTIN Management Standard 1.1 §2.3 and §2.8, read 2026-09-05) that one row
cannot express. A library row therefore reaches an identity through a KEY
(`mudavym:master_wine_library`), so one row may name several formats and several
rows may name one bottle. Also measured: `upc`, `ean`, `barcode`,
`manufacturer_sku` and `distributor_skus` are **empty on all 4,226 rows**, and
the producer|name|vintage key already in use collapses 3,562 live rows to
**3,525** keys (34 keys hold 71 rows, worst 3).

**Nothing is backfilled and nothing auto-merges.** The migration's own assertion
block fails if any row is written; the candidate queue starts every proposal
`pending` at every confidence; and an exact key that names more than one identity
is a **refusal**, not a choice — measured on Iowa's live file, 1,736 of its 9,118
distinct UPCs do exactly that.

**Founder questions this opened:** whether to take the LWIN database (it is
**CC BY 4.0**, free, 200,000+ wines — the only real first fill available for
wine), and who confirms a candidate. Both are in ADR 0124 §Founder-only questions.

### 13.y Curation: a provisional identity becomes a library entry (ADR 0124 Q3, 2026-09-05)

The founder's words that opened this (batch 48): *"maybe the /menu is editable,
but masterwinelibrary parts /wines not at all."* This page's library stays
exactly that — nothing a house does writes to it.

What a house CAN do is assert a **provisional** bottle identity beside the
library (`beverage_identities`, ADR 0124), which enters a curation queue.
Mudavym promotes it, and only then does a shared `master_wine_library` row come
into existence — created by the curation path with `source = 'identity_curation'`,
`primary_type` and `country` written as the literal `unknown` rather than
guessed (the library already carries `unknown` as a primary_type on 59 rows,
measured 2026-09-05).

**Who curates:** not a role on this page. `identity-curation.controller.ts` is
gated by the `X-Admin-Key` service credential (ADR 0099) with no class-level
guard, because `RolesGuard` knows only owner/manager/staff — all three roles
*within* a house — and inventing a fourth to hold a curation queue would be a
permission system built as a side effect.

**Promoting onto another venue's provisional row is refused**, enforcing ADR
0130's rule from this side too: it would move the identity from one provisional
state into another and call the result official.

### 13.z Two ways in: the LWIN file, and a hand nomination (ADR 0124 Q4, 2026-09-05)

The founder: **"LWIN search + hand nominations."** *"Two ways in; nothing
invented."*

**The LWIN file is RECORDED, not fetched** (batch 43): a person downloads it and
points `LWIN_FILE_PATH` at it, refreshed on the stated cadence. Probed
2026-09-05 with an identifying UA, the LWIN page (147,184 bytes) carries **no
`.csv`/`.xlsx`/`.zip` link** and three guessed paths returned **404** — Liv-ex
serves it through a form. So until the file is placed, `GET
/vendor-intel/identity/lwin/search` answers `available: false` and names the
path, the CC BY 4.0 licence and where to get it. It never returns an empty hit
list, because "no wine matched" and "there is no file" are different answers.

**Nothing invented.** The committed fixture is synthetic, named so, in a
`99xxxxx` block: no row claiming to be Liv-ex's is in this repo. Confirming a
row takes the wine from the file and the **format from the house** — an LWIN-7
carries no vintage, size or pack, and none is guessed. Such an identity stands
as `source`, not provisional, and skips the curation queue.

**A hand nomination** (`POST /vendor-intel/identity/nominate`) is the second
way, and it IS provisional per Q3 — the response says so, so a house is told at
the moment it nominates.

**What a sweep would read:** `GET /vendor-intel/identity/sweep-subjects` counts
identities standing `library` or `source`; provisional ones are excluded,
because a house's own unconfirmed name is not a subject to go fetching prices
for. Zero is a real zero with its reason; a failed count is null, not 0. This is
the answer to ADR 0117 Q28.

## 14. The lines the reader could not place — BUILT 2026-09-25 (OD-140)

The founder, 2026-09-25, on OD-140: **"Separate list endpoint"**; and in round 4
(item 18): the "Show me the N" control **lives on `/cellar` registers**, and
`/house/menu`'s three locked counts stay untouched.

- **Where.** `Registers.tsx` mounts `UnplacedMenuLines` in *The registers* section,
  directly under the register cards and above the needs-rows / stranded notices. It is
  drawn only once the registers readout is in: when that readout is unread, the
  section's own alert already says so and nothing about menu lines is claimed.
- **The count** is the readout's `menuLines` (`GET /cellar/:rid/registers`, the same
  pass that decided the registers). **The list** is `GET /cellar/:rid/registers/unplaced`,
  read by `useUnplacedMenuLines` (`useCellarNextData.ts`) in a child that mounts only
  when the disclosure opens, with no retry — so a closed control costs no request and
  a failed read is said at once.
- **Honest states, kept apart (ADR 0020 / 0051):** no `menuLines` field — nothing
  claimed; `menuLines: null` — "the menu could not be read (reason) … unknown — not
  zero", no control; 0 lines read — "no lines yet", not "all placed"; none unplaced —
  "placed every one of the M", no control; some unplaced — the count and the control
  (`aria-expanded`, `aria-controls`). Opened: *reading*; a failed read said as a failure
  ("The count above still stands"), never an empty list; the lines, name and section
  ("A line with no name" / "no section" rather than blanks); and a list whose length is
  not the count, said as "the menu changed since the count above".
- **Why count and list cannot drift.** The gateway reads both through one `menu_items`
  query (`readMenuRows`) and one filter (`unplacedMenuLines`); `tallyMenuLines().notPlaced`
  is defined as `unplacedMenuLines(lines).length`, and `cellar-registers.service.spec.ts`
  pins `lines.length === menuLines.notPlaced` for one menu.
- **Tests.** `UnplacedMenuLines.test.tsx` (9, through the real `apiClient` contract) and
  two in `CellarNext.test.tsx` (mounted in the registers section on `/cellar`; absent
  when the readout is unread). Seven mutations each fail a test: list read before asked,
  error rendered as data, mismatch note dropped, control shown at zero, empty menu said
  as all placed, unread menu dropped, control unmounted from `/cellar`.
- **Moved off the Arrival book.** The first cut (PR #469, Wave 1) hung the control on
  the Arrival reveal (`pages/arrival/Arrival.tsx`), which is flag-OFF and on the ADR
  0149 deletion manifest at cutover (#414). That component is removed; the Arrival note
  now says `/cellar` lists the lines.
- **Not on `/house/menu`.** Its three counts (ADR 0213 row 14) are read / set /
  pencilled from the import review (`lineNeedsPencil`) — a different rule — and stay
  as locked.
