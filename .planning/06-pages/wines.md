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
updated: 2026-09-02
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

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_cellar`)

Canonical source with curves: `apps/web/src/pages/cellar/next/MOTIONS.md` —
this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `cl-stand-settle` | The reading stand opens | a bottle is chosen on `/wines` — `settle`, 320ms house curve, CSS `grid-template-rows: 0fr → 1fr` (the row-expand the founder named on board 053) |
| `cl-leaf-turn` | The page turns | a *different* bottle is chosen while the stand is already open — `turn`, 420ms, opacity + 4px; the stand does not re-open |
| `cl-ink` | Ink micro-state | register cards, shelf cards, rows, chips, fields, register switches, buttons — border to seal ring, one paper step; nothing translates |
| `cl-tally` | Figures arrive | every count on `/cellar` — three on the wine register card, two on each catalogue card, four in *In the building tonight* — `tally`, 840ms overdamped spring off `springs.tally.samples`. **An em dash never tallies** |
| `cl-hold-pour` / `cl-seal-stamp` | The seal lands | inside `HoldToApprove`, sending a real purchase order — `pour` 620ms linear, then `stamp` 360ms. The only ceremony, and the only place the seal appears |

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
what a non-alcoholic café and a whisky bar would see. **A is still blocked on
trust, not code** — `storage_locations` holds 87 rows across 7 tenants, 84 of them
carrying one of four invented zone names. **B is no longer blocked**: this pass put
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
