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
- Stock overlay from inventory; list price vs market price (🚧 market price renders "—" until enrichment data exists)
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
- 🚧 **Market price renders `—` for every bottle** and says why — `retail_price_avg` is null on all 442 rows and its writer has no deployed worker
- 🚧 **`/beer` `/whiskey` `/cocktails` are honest empty registers** — the tables exist (`public.beverages`, `public.cocktails`) but **no gateway controller serves them**, so each child states what is missing and lists the columns the register would carry. No rows, no counts, no zeros
- 🚧 **"Read a menu" detects but does not add** — `scanMenuImage` is real; neither the scanner tab nor the legacy caller writes a detected title anywhere, so the control is named for what it does and says plainly that nothing was written
- ⛔ **Not carried over: "Reorder" and "save as recurring"** — both reported success and wrote nothing (§10). Replaced by one real order path and by nothing, respectively
- ⛔ **Not carried over: the Body filter** — `body` was the constant `'medium'` on every row, so the control could only match all or none
- ⛔ **Not carried over: bulk selection and CSV export** — the export shipped six fabricated attribute columns (Body / Sweetness / Acidity / Alcohol % / Aromas / Flavors) as measured data, and that is the most damaging thing on the legacy page because it leaves the building as a file. It returns when there are real columns to export (§13)

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_cellar`)

Canonical source with curves: `apps/web/src/pages/cellar/next/MOTIONS.md` —
this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `cl-stand-settle` | The reading stand opens | a bottle is chosen on `/wines` — `settle`, 320ms house curve, CSS `grid-template-rows: 0fr → 1fr` (the row-expand the founder named on board 053) |
| `cl-leaf-turn` | The page turns | a *different* bottle is chosen while the stand is already open — `turn`, 420ms, opacity + 4px; the stand does not re-open |
| `cl-ink` | Ink micro-state | register cards, shelf cards, rows, chips, fields, buttons — border to seal ring, one paper step; nothing translates |
| `cl-tally` | Figures arrive | the seven counts on `/cellar` — `tally`, 840ms overdamped spring off `springs.tally.samples`. **An em dash never tallies** |
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

Deliberate non-motions: the register does not stagger in (500 titles arriving
one by one is the busyness the verdict rejected); switching Register ↔ Shelf and
moving between registers does not cross-fade; unknowns never animate or shimmer
(the market column is *permanently* unknown and must never look like it is
loading); the three unwired registers have no motion at all.

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

**Size, measured and over budget.** The p4 brief asks for ~900 lines across a
page's files. This one is **1,706 lines of component/hook/formatter code** —
`WineRegister.tsx` 478, `BottleLeaf.tsx` 343, `useCellarNextData.ts` 225,
`Registers.tsx` 172, `CellarNext.tsx` 145, `cellar-format.ts` 141,
`registerShapes.ts` 106, `UnwiredRegister.tsx` 96 — plus 293 lines of test, 330
of CSS and 33 of `MOTIONS.md`: **2,362 across 11 files**. (A count of
non-blank, non-comment lines gives 1,339; the raw figure is the one to quote.)
The directory was split into five components as the rule allows, and one pass
already moved repeated inline typography into `cellar-next.css`, but the total
is still ~1.9× the budget for what is five surfaces behind one component. No
feature was cut to close the gap — the overrun is disclosed rather than paid for
by dropping breadth the founder asked to keep. If it must come down,
`WineRegister.tsx` splits again (control rail / table / shelf).

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
- `apps/web/src/pages/cellar/next/Registers.tsx` — the four register cards, the "In the building tonight" strip, and `Tally`
- `apps/web/src/pages/cellar/next/WineRegister.tsx` — the register: search, six filters, sortable columns, Register/Shelf views, the reading stand
- `apps/web/src/pages/cellar/next/BottleLeaf.tsx` — the reading stand: facts, notes + provenance, bring-into-the-cellar, hold-to-order
- `apps/web/src/pages/cellar/next/UnwiredRegister.tsx` — the honest `/beer` `/whiskey` `/cocktails` state
- `apps/web/src/pages/cellar/next/registerShapes.ts` — what each register is, what is missing, and the schema columns it would carry (measured from the migrations, cited in the file header)
- `apps/web/src/pages/cellar/next/useCellarNextData.ts` — all fetching + view models
- `apps/web/src/pages/cellar/next/cellar-format.ts`, `cellar-next.css`, `MOTIONS.md`, `CellarNext.test.tsx` (**18 tests**, all 18 green; all 18 fail against the scaffold)

## 4. Endpoints
- `GET /wines` (search, `limit: 500`) — `services/api/wines.ts:30` via `useWines` (`useWineLibraryPage.ts:96-99`); ENDPOINTS.md:667
- `GET /inventory` — stock overlay via `useInventory` (`useWineLibraryPage.ts:100`)
- `GET /providers` — `services/api/providers.ts:201` via `useProviders` (`useWineLibraryPage.ts:101`)
- `GET /providers/recommendations?restaurantId&wineId` — `services/api/providers.ts:314-316` via `useRecommendedProviders` (`WineLibrary.tsx:161`), fires on wine selection
- `POST /inventory` — add-to-inventory flow, `services/api/inventory.ts:80` via `AddToInventoryFromLibraryModal`
- Realtime: wine update subscription over WebSocket (`useWineSubscription`, `WineLibrary.tsx:48`)

**Added by the Mudavym cellar** (same `apiClient`, bearer attached):
- `POST /procurement/orders` — the real order path, replacing the legacy "Reorder" that wrote nothing. Contract verified: `apps/api-gateway/src/procurement/procurement.controller.ts:112` → `procurement.service.ts`, body `CreateOrderDto` at `apps/api-gateway/src/procurement/dto/procurement.dto.ts:34-121`. **Keyed on `inventoryId`, not `wineId`** (`:37`) — this is why a catalogue-only bottle cannot be ordered and the control is disabled with the reason. `restaurantId` and `userId` come from the JWT, and the controller stamps `source: "manual"` itself (`:120-124`)
- No new read endpoints. `/beer` `/whiskey` `/cocktails` call **nothing**, because nothing serves them — see §9

## 5. Signals
none. No `uxSignals`, no tracking calls (grep of `WineLibrary.tsx` + `wine-library/` — zero hits).

## 6. Tier cut
Core. Scenarios: S06 (new dish/menu item — wine catalogue is the ✅ half), S17 (same
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

1. **No endpoint serves `beverages` or `cocktails`.** All **52 `@Controller(...)`
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
2. **`WinesService.mapWine` drops `beverage_kind` and `classification_status`.**
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
10. **The scanner has no add path.** `MenuScannerTab.handleValidationApprove`
    (`:160-172`) and the legacy `onWinesDetected` (`WineLibrary.tsx:1813-1822`) both
    only mutate component state. `bulkCreateInventoryItems` accepts a `wineDraft` and
    resolves it server-side (`services/api/inventory.ts:97-103`), which is the shape a
    real "scan → shelf" path should use.

## 10. Maturity

**hollow.** Browsing works and is real. The page's two headline *actions* — "order this
wine" and "save this as a recurring order" — report success and write nothing, and the
export ships fabricated wine attributes as fact.

| Evidence | `path:line` |
|---|---|
| **"✅ Order created" — no order is created.** `handlePlaceOrder` writes a plain object into a Zustand store and navigates. There is no POST anywhere in the handler. The alert reads *"✅ Order created for {wine} … The AI will contact the selected provider(s) via Plivo. You'll receive notifications as they respond. Redirecting to Orders page…"* — none of which has happened; [[orders]] merely opens with a prefilled modal the user must still submit. | `WineLibrary.tsx:313-382`, alert text `:360-368`; staging `setPendingReorder(orderData)` `:349` |
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
| loading | ✅ | `useWines` flags |
| empty | ⚠️ mixed — Market renders "—" (honest); Body/Alcohol render fabricated constants (dishonest) | `WineLibrary.tsx:1075-1089` vs `lib/wine-library.ts:32-37` |
| error | ❌ | no error branch; three flows use `alert()`/`confirm()` rather than the app's toast system (`:301,317,360`) |
| permission-denied | ❌ | one owner-shaped view; §1 says staff can read but nothing enforces or adapts |

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
| loading | ✅ | "Opening the book…" / "Counting the cellar…"; a skeleton is never shown for a value that is permanently unknown |
| empty | ✅ | "The book is open and empty — the library holds no titles"; a filtered-to-nothing register says so separately and offers to widen; an *unwired* register never renders empty, it renders its absence |
| error | ✅ | the book fails → `role="alert"` in words with a retry and **no register at all**; the cellar fails → "on hand" is unknown for every row, said in a `role="status"` line; the vendor book fails → the order control says nothing can be chosen |
| permission-denied | ✅ | no active branch → "No restaurant is active on this account… The book is unread — not empty" — and **only after `authLoading` clears**, so a resolving session is never called a denied one (found live, see §1b) |

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

1. **Carry `beverage_kind` onto the wire** — one field in `WinesService.mapWine`
   (`apps/api-gateway/src/wines/wines.service.ts:75-131`). Cheapest item on this list
   and it turns three "unread" registers into three real counts. *Blocker: none.*
2. **Serve `public.beverages`** — a `beverages.controller.ts` + service with the same
   search/filter shape as `/wines`. `/beer` and `/whiskey` become real registers with
   no client change beyond a second read in `useCellarNextData`. *Blocker: none.*
3. **Decide the inventory identity axis for non-wine stock** (§9.6). Until this is
   settled a beer can be *listed* but never counted, ordered or received, so registers 2
   and 3 would be read-only catalogues. *Blocker: founder decision — this is an ADR.*
4. **Serve `public.cocktails`**, and run the cocktail-section extraction pass that fills
   `cocktail_ingredients`. Listing 55 cocktail names without recipes is worth less than
   the other two registers. *Blocker: the extraction pass.*
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
