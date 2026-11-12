# /inventory audit: every good, food included (walk item #7, 2026-11-07)

Read-only audit against `origin/main` @ `e26a5152d`. Every `file:line` cites that tree, read via `git show origin/main:<path>`.
Scope: the live page is `inventory_next`. The flag is ON 15/15 since 2026-10-31 and defaults ON for new houses (#704). The legacy command page only matters for what it adds to the bundle.
Asks in scope: hold ALL goods, foods included. Clicking an item shows the menu items and recipes that use it. Full KPI cards (on hand, value, usage, days of cover, cost trend, waste, variance). A KPI drills into a nutrition card. The same drill for drink recipes. A computer-vision count with manual entry always available.
Companion: `sota.md` (same folder).

---

## 1. What it is for, in the restaurant's words

"What do we have, where is it, what is it worth, and what do I have to do about it before service?"

A manager opens /inventory at 7pm and needs to know:
- what is out or nearly out;
- what to reorder, and from whom;
- what it cost;
- whether the count on the shelf matches what the system thinks.

A bartender or cook needs to count a shelf fast, on a phone, with a photo when that helps, and fix it by hand when the photo is wrong.

An owner needs the money view: what is tied up in stock, what is wasted, where counts disagree with sales.

The page today answers the first two well for **drinks only**. It does not answer "what uses this?", "how much do we waste?", "how far off are our counts?", or anything about food.

## 2. Path map (screens → components → endpoints → services → tables)

### 2.1 Routing and gating
| Piece | Where |
|---|---|
| Route `/inventory` → `PageGate page="inventory" legacy={<InventoryCommandPage/>} next={<InventoryRoute/>}` | `apps/web/src/App.tsx:386` |
| Both pages imported **eagerly**, under "Critical pages (loaded immediately)" | `apps/web/src/App.tsx:67,76-77` |
| Every other Next page is `lazyWithRefresh` | `apps/web/src/App.tsx:23-44,82-130` |
| Flag read `useMudavymDesignVerdict('inventory_next')`; renders nothing while reading | `apps/web/src/pages/inventory/next/InventoryRoute.tsx:19-28` |
| A failed flag read silently becomes `false`, so the page falls back to the command page (OD-231) | `useMudavymDesign.ts:271`; `.planning/decisions/OPEN-DECISIONS.md:320` |

### 2.2 Screen and components (`apps/web/src/pages/inventory/next/`)
| Component | Lines | Role |
|---|---|---|
| `InventoryNext.tsx` | 1075 | One sentence plus a row of chips. **"No KPI tiles" by design** (`:11-13`). Four states: reading, failed, empty, ready. Side panels: scanner, locations, pos, receipt, auction (`:185`). ContextualInsights (`:817`). Paper count-sheet export (`:518-545`). |
| `InventoryTable.tsx` | 292 | Severity-sorted table |
| `RowDropdown.tsx` | 829 | Row drill: `WhereTheCountComesFrom` `:473`, `HowFastItPours` `:531`, `WhatItHasCost` `:633`, `Paperwork` `:735`, "View ledger" → `/documents-reports` `:822` |
| `InventorySheets.tsx` | 733 | `CountSheet` `:103-233` (blind count, photo button `:188-203`); `WriteOffSheet` `:237+` |
| `OrderLetter.tsx` | 442 | Reorder letter |
| `useInventoryNextData.ts` | 890 | `InvRow` shape `:72-131`, `toRow` `:203`, page fan-out `:591`, `useRowDetail` `:823` |
| `inventory-next.css` | 951 | |
| MenuScannerFlow (import `:42`) | | Dead: `wineDetection.ts:473` posts to an orchestrator route that is not mounted (menu audit M2) |

### 2.3 Endpoints (gateway)
- **`inventory.controller.ts`** (`@Controller("inventory")` `:35`):
  - GET `:restaurantId` `:148`
  - POST `items` `:166`, `items/bulk` `:200`
  - GET `low-stock` `:240`, `item/:id` `:254`, `item/:id/activity` `:271`, `summary` `:290`
  - toast map/unmap `:310-403`
  - PATCH `item/:id` `:423`
  - POST `transfer` `:454`, `pour` `:485`, **`count` `:519`**, **`count-photo-estimate` `:558`**
  - DELETE `:585`
  - auction-lots `:78,:103`; research `:131`
- **`inventory-ledger.controller.ts`** (`:42`):
  - transactions POST/bulk/GET/:id `:58-166`
  - balance `:192`, history `:225`, summary `:266`, reconcile `:302`
- **`storage-locations.controller.ts`** (`:45`): mappings `:52-88`, wines-at-location `:109`, CRUD `:130-257`.
- **`beverages.service.ts`** row record: `GET /beverages/:rid/row-record?label=`, called from `useCellarNextData.ts:970-992`.

### 2.4 Service methods
- **`inventory.service.ts`** (2138 lines):
  - `mapInventoryItem` `:81-176`: bottle ml `?? 750` `:87`, pour `?? 150` `:88`.
  - `fetchLotRollup` `:178-195`, `fetchLocationBreakdown` `:198-214`, `fetchAnalytics` `:233-252`.
  - `getRestaurantInventory` `:254-283`, a `Promise.all` of 4 reads.
  - `recordSpotCount` `:505-632`, which calls the RPC `record_stock_count` at `:559`.
  - `estimateCountFromPhoto` `:634-690`, `getItemActivity` `:796`, `getInventorySummary` `:1493`.
  - `updateInventoryItem` → `set_stock_absolute` `:1695`.
  - toast mapping `:1883-2130`.
- **`database.service.ts:42-53`**: `restaurant_inventory` with `master_wine_library(...)` embed.
- **`photo-count.service.ts`** (194 lines):
  - wine-only prompt `:14-23`
  - `claude-haiku-4-5` `:77`
  - wine name in prompt `:93`
  - 30 s timeout `:99`
  - 503 on failure `:126`
  - media type sniff defaults to jpeg `:132-139`
- **`beverages.service.ts`**:
  - `readRowRecord` `:776-793`: 5 label-matched books (menu, invoice, order, quote, pos).
  - `readMenuLines` `:820`: whole current menu, then `matchLine` in JS `:851`.
  - `readTillLines` `:1045`: pages all till names via `house_till_names` `:1063-1068`.
  - `setCocktailIngredients` `:654-722`: delete then insert, not transactional `:688-715`.

### 2.5 Tables, views, RPCs
- **Tables**:
  - `restaurant_inventory` (baseline `20260805000000_baseline_from_production.sql:3259`, `master_wine_id uuid NOT NULL` `:3262`)
  - `inventory_lots`, `inventory_transactions`
  - `stock_counts` (`20260902190000_a_count_is_a_record.sql:59-120`; `variance_qty` generated; indexes `stock_counts_item_recent`, `stock_counts_restaurant_recent`)
  - `photo_count_suggestions`
  - `menu_items` (baseline `:3783-3806`, has `inventory_item_id`, a 1:1 sale link)
  - `cocktails` and `cocktail_ingredients` (`20260817090000_cocktails.sql:60-75`; referents `beverage_id`/`wine_id`/`free_text`, **no `inventory_id`**; "empty by design" comment `:74-75`)
  - `pos_item_mappings` (baseline `:4216`), `pour_events` (`:4235`), `toast_item_mappings` (`:5684`)
- **Views**:
  - `inventory_analytics` (baseline `:3332-3398`)
  - `inventory_lot_rollup` and `inventory_location_breakdown` (`20260902150000_lot_cost_truth.sql:445,486`)
- **RPCs**: `apply_stock_movement`, `set_stock_absolute`, `record_stock_count`, `record_glass_pour`, `transfer_stock`.
- **Not present anywhere on main**:
  - any food recipe or ingredient table (`git grep -niE 'create table .*(recipe|ingredient)' -- supabase/migrations` → only `cocktail_ingredients`);
  - any nutrition, calorie or allergen column or source. Only ABV exists: `beverages.abv_pct` (`20260817070000_beverages_table.sql:226`), `master_wine_library.abv_percent` (`20260906120000_a_strength_is_stated_by_a_person.sql`).

### 2.6 Jobs and agents
- `ghost_inventory_agent.py` (43 LOC) and `shrinkage_detective_agent.py` (41 LOC) are stubs.
- `inventory_engine.py` and `buffer_manager.py` are wired to the dormant Python POS path.
- Source: `.planning/08-softwares/inventory-command.md` §4. That note is dated 2026-09-01 and predates InventoryNext.

### 2.7 Mobile
`apps/mobile/src` has cellar components only (`BinBreath`, `CapsuleSweep`, `WineRow`, …). There is no count screen.

## 3. How it performs today

Measured statically. No bundle build or `EXPLAIN` was run (see §6).

1. **Entry bundle carries both inventory pages.** `App.tsx:76-77` imports `InventoryCommandPage` and `InventoryRoute` eagerly. The entry chunk therefore holds:
   - the command page (1916 lines) plus `ReceivingWorkspace` (1187), `SpotCountPanel` (307), `RowExpansion` (437), `AuctionLotStart` (663);
   - InventoryNext (1075) plus its sheets, dropdown, table, letter and 951-line CSS.

   Every route pays for this on first load, including /login. With the flag ON for 15/15 houses, the legacy tree is dead weight in production.
2. **Cross-tenant scan per page load.** The `sales` CTE of `inventory_analytics` (baseline `:3333-3341`) aggregates every `sale` row of `inventory_transactions` for **all tenants**, grouped by `inventory_id`. The `restaurant_id` predicate is applied later, in `base`, and cannot push down through a `GROUP BY` CTE. Cost grows with the whole platform's ledger, not the house's.
3. **Page fan-out with one dependent hop.**
   - `useInventoryNextData` (`:591`) fires these in parallel: inventory, currency `:618`, storage locations, providers, pricing-advice `:637` (managers only), invoice queue `:663`, deliveries `:669`, outbox `:675`.
   - `useWinesByIds` waits for the list first. That is a two-step waterfall before names render.
4. **Row open is a waterfall plus a heavy call.**
   - `useRowDetail` (`:823`) fetches `GET /inventory-ledger/transactions?transactionType=purchase`, which returns 50 rows, of which the page keeps 3. The DTO refuses `limit` (`:826-835`).
   - **Then** it runs `documentsApi.forOrder` per order (≤3).
   - In parallel, `HowFastItPours` calls `row-record`. Server side that reads the **whole** current menu and matches in JS (`beverages.service.ts:827-851`), and pages **all** till names (`:1063-1068`). That is 5 books per open, keyed by label.
5. **Over-fetch per count.** After each single count, `recordSpotCount` reloads the item plus the **whole house's** lot rollup and location breakdown (`inventory.service.ts:595-606`). A 60-line shelf count does 60 whole-house rollups.
6. **Photo payload.**
   - `CountSheet` sends a full-resolution base64 data URL (`InventorySheets.tsx:145-157`) with no downscale.
   - The body cap is 15 MB (`apps/api-gateway/src/main.ts:47-49`). A 12 MP phone photo is around 4-6 MB, about 33% more as base64. That is slow on a bar's mobile data and can approach the cap with HEIC→JPEG conversions.
7. **N+1.** No classic per-row N+1 on the list. The per-row work is the open-row waterfall (4) and the per-count rollup (5).

## 4. Gaps

Severity scale: blocker = the ask cannot be met; major = the ask is met badly or is unsafe; minor = polish or debt.

| # | Gap | Evidence (origin/main) | Sev |
|---|---|---|---|
| G1 | **Food cannot be held.** Every inventory row needs a wine. Quantities are whole numbers, so kg, L and each-with-fractions are unrepresentable. | `baseline:3262` `master_wine_id uuid NOT NULL`; `OPEN-DECISIONS.md:72` (OD-113, 15 `@IsInt()` DTO fields); ADR 0070 integer qty + uom | blocker |
| G2 | **The fix for G1 exists but its state is unknowable from records.** `20260903171000_the_house_item_is_the_ledgers_key.sql` (header `:3` "GATED. DO NOT APPLY") drops the NOT NULLs (`:167-176`) and sits in the auto-applied migrations tree since #289. Some records say it is not applied: `.planning/decisions/README.md:140`, ADR 0115 `:383-392`, `06-pages/inventory.md:408`. Others assume it is: ADR 0293:59, `07-reference/research/2026-09-21/qty-judge.md:82`. The blocker it names is still in code: `inventory.service.ts:87` `?? 750`. | as cited | blocker |
| G3 | **No "used in" for any item.** There is no food recipe table at all (§2.5 grep). Cocktail recipes are free text: `CocktailRegister.tsx:103-124` saves only `freeText` and never sets `beverage_id`/`wine_id`. `cocktail_ingredients` has no `inventory_id` (`cocktails.sql:60-72`) and is "empty by design" (`:74-75`). | as cited | blocker |
| G4 | **The one existing "used on the menu" signal is thrown away.** `row-record` already returns the `menu` book: menu lines matching the item, label-matched (`beverages.service.ts:776-793,820-851`). `HowFastItPours` keeps only `pos` (`RowDropdown.tsx:531-533`). `menu_items.inventory_item_id` (baseline `:3783-3806`; `menus.ts:180`) is never shown on /inventory. | as cited | major |
| G5 | **No KPI cards.** This was a deliberate earlier call (`InventoryNext.tsx:11-13`). The row model has on-hand, value (stock×wac), velocity and runway (`useInventoryNextData.ts:72-131`) but **no waste, variance or cost-trend fields**. | as cited | major |
| G6 | **Variance data is recorded but never shown.** `stock_counts.variance_qty` is generated per count, with recent-count indexes (`20260902190000_a_count_is_a_record.sql:59-120`). No InventoryNext surface reads it. | `useInventoryNextData.ts:72-131` has `lastCountedAt` only | major |
| G7 | **Waste is not a figure anywhere on the page.** WriteOffSheet posts `waste` and `comp` rows to the ledger (`InventorySheets.tsx:237+`), but nothing sums them. The write-off also needs `row.wineId` (`:246,276`), so a non-wine item cannot be written off. | as cited | major |
| G8 | **No nutrition data exists.** No table, column or provider; only ABV (`20260817070000_beverages_table.sql:226`; `20260906120000_…sql`). A nutrition card has nothing to draw. Food per-portion nutrition also needs G1 and G3 (recipe + quantity). | §2.5 grep | blocker (for the nutrition ask) |
| G9 | **The CV count is one item, wine-only, whole bottles.** The prompt says "bottles of a specific wine" (`photo-count.service.ts:14-16,93`). There is no multi-SKU shelf recognition and no partial-level reading. The count is a whole number only (`InventorySheets.tsx:43-47,207`), against founder ruling F3 (tenths → ml, 2026-10-12). | as cited | major |
| G10 | **The CV pipeline is fragile.** `detectMediaType` returns jpeg for anything unknown (`photo-count.service.ts:132-139`), while the picker accepts HEIC, HEIF and PDF (`uploadAccept.ts:21-24`; `InventorySheets.tsx:197`). There is no client downscale (`:145-157`). The photo is not kept, so a suggestion cannot be audited later. | as cited | major |
| G11 | **A model confidence word is shown to staff.** `(${estimate.confidence} confidence)` at `InventorySheets.tsx:163`. It is a word rather than a number, so it is not a literal ADR 0104 breach, but it is the model grading itself. ADR 0104 asks that people see what was seen, not certainty. | as cited | minor |
| G12 | **The phone count session (founder 2026-10-12, F1/F2/F4) is not built.** There is no counting period (≤6 h), no shelf-by-shelf walk, no posting on sync per shelf, and no phone-width count screen. Counts are one item at a time from the table. OD-230 (input modes) is open (`OPEN-DECISIONS.md:319`). Mobile has no count screen (§2.7). | as cited | major |
| G13 | **The entry bundle carries both inventory pages** (§3.1). | `App.tsx:67,76-77` | major |
| G14 | **`inventory_analytics` scans all tenants' sales on every read** (§3.2). | baseline `:3333-3341` | major |
| G15 | **Absence reported as health.** `fetchLotRollup` and `fetchLocationBreakdown` drop `error` (`inventory.service.ts:184,204`). A failed read becomes `openMl: 0` (`:163`) and `locations: []` (`:173`). Only analytics carries `ok` (`:233-252`). | as cited | major |
| G16 | **Each count reloads whole-house rollups** (§3.5). | `inventory.service.ts:595-606` | minor |
| G17 | **Row open waterfall and over-fetch** (§3.4): 50 ledger rows to keep 3, then docs, plus a whole-menu and all-till-names read per open. | `useInventoryNextData.ts:823-835`; `beverages.service.ts:827-851,1063-1068` | minor |
| G18 | **Two velocity sources, joined by name.** The headline uses `inventory_analytics` ledger sales. The chart uses till lines matched by the **label string** (`RowDropdown.tsx:532`), so a rename breaks the join and the two can disagree on screen. | as cited | minor |
| G19 | **Cocktail recipe write is not transactional.** Delete then insert (`beverages.service.ts:688-715`); a failure between the two empties the recipe. | as cited | minor |
| G20 | **The paper count sheet is export-only.** There is no way to bring a paper count back in (`InventoryNext.tsx:518-545`). | as cited | minor |
| G21 | **Dead or dark surfaces still mounted.** The scanner panel goes to an unmounted route (`wineDetection.ts:473`, M2). "View ledger" goes to `/documents-reports` (`RowDropdown.tsx:822`). Market price is never produced; the ghost and shrinkage agents are stubs (`08-softwares/inventory-command.md` §4/§7). | as cited | minor |
| G22 | **Wine-shaped words across the count path.** "Bottles counted" (`InventorySheets.tsx:185`); "this wine" fallback (`inventory.service.ts` `estimateCountFromPhoto` `:634-690`). This breaks the all-beverages-then-foods scope rule. | as cited | minor |
| G23 | **Thin tests and stale docs.** `storage-locations` has 0 specs and 10.8% branch coverage. The software note is "updated 2026-09-01" and predates InventoryNext. | `08-softwares/inventory-command.md` §9 | minor |

## 5. Proposal (the session's calls under the /goal; none locked)

1. **One house item for every good (unblocks G1, G2).**
   - Verify on a branch DB which side of G2 is true.
   - Then land ADR 0115's shape: nullable `master_wine_id`, plus `kind` (wine, spirit, beer, food, supply), `uom` (bottle, ml, g, each) and `display_name`.
   - Keep integer quantities in the smallest unit, per ADR 0070: ml or g.
   - Replace `?? 750` with "size unknown".
   - Food rows enter from receipts first (door receipts are the existing intake), not by hand.
2. **Recipes link to house items (unblocks G3; enables "used in").**
   - Add one `recipe_lines(recipe_id, inventory_id, qty_smallest_unit, yield_pct)`, where a recipe is a menu item, a cocktail or a prep (sub-recipe).
   - Migrate `cocktail_ingredients` free text by suggestion: the matcher proposes and a person confirms.
   - Make the write a single RPC (fixes G19).
   - "Used in" becomes one indexed query, `recipe_lines` by `inventory_id` joined to menu items. It also shows the `menu_items.inventory_item_id` 1:1 sale links and, until then, the `menu` book already returned (G4: a free first step).
3. **KPI strip in the row drill, not at page top.** This keeps dossier E's "what is out goes above the fold" (`InventoryNext.tsx:11-13`) while answering the ask. Seven cards, each a sentence-backed figure:
   - **on hand** (lots)
   - **value** (stock×wac)
   - **usage/day**: one source, the ledger. Theoretical usage from recipes × sales is shown beside it once recipes link.
   - **days of cover**
   - **cost trend**: lot unit cost over time, from `inventory_lots` and receipts.
   - **waste**: sum of waste and comp ledger rows over the period.
   - **variance**: last N `stock_counts.variance_qty`, plus actual vs theoretical once recipes exist.

   Each card opens its own evidence. The page-level strip is offered behind the house's own toggle only if the founder later wants it.
4. **Nutrition card (G8): open fork, decided here as a recommendation.**
   - Source per item, in order:
     1. A person states it (label photo read, then confirmed).
     2. Open Food Facts by barcode for packaged goods (ODbL, attribution).
     3. USDA FoodData Central for raw ingredients (CC0).
   - The 14 EU/TR allergens are stated by a person, never inferred.
   - Dish nutrition = Σ recipe lines; this needs (1) and (2).
   - Each figure shows its source. Unknown values show as unknown, never as 0.
5. **Count session with CV, manual always available (G9-G12).**
   - A phone-width "count a shelf" flow. Period ≤6 h (F1). Shelf by shelf, each shelf posts via `record_stock_count` on sync (F2). Open bottles in tenths stored as ml (F3).
   - Input modes per line: tap ±, type, barcode, photo.
   - A **shelf photo** returns a list of item, count and partial level (tenths) for the person to confirm line by line. Unrecognised items stay blank and are never guessed.
   - Downscale on the client to about 1600 px JPEG. Keep the photo with the count for audit. Fix the media sniff.
   - Show "the photo suggests 7"; drop the confidence word.
   - The count returns only that item's projection, not whole-house rollups (G16).
6. **Performance (G13-G17).**
   - Lazy-load both inventory pages.
   - Rewrite `inventory_analytics` so the sales aggregate is filtered by restaurant (join first or a lateral), or materialise it per house.
   - Give the ledger DTO a `limit`.
   - Add a `GET row-record?books=pos,menu` scope.
7. **Honesty fixes (G15, G21, G22).** Return `ok:false` from the rollup and breakdown reads. Remove the dead scanner and ledger link. Use all-goods wording.

## 6. Not verified (stated plainly)
- Whether `20260903171000` is applied in production. I did not touch prod by rule, so G2 stays unresolved here.
- No bundle build was run. Bundle cost in §3.1 is inferred from eager imports and line counts, not measured bytes.
- No `EXPLAIN` was run on `inventory_analytics`. G14 is read from the view text, and I did not check whether a later migration redefines the view; `git grep` found only the baseline definition.
- I did not open the menu audit's M-numbers beyond what §2/§4 cite.
- The SOTA pass relied on vendor pages for WISK, Partender and MarketMan. Their accuracy claims are marketing, not independent.

## 7. Open PRs that touch this area (`gh pr list`, 99 open)
- #589: ADR 0115 lock (the G1/G2 shape) and `06-pages/inventory.md`.
- #619 / #624: stockout counts open ml (`analytics/engine/inventory-science.ts`, ADR 0299). These touch days-of-cover.
- #650: till names with serve size (`beverages.service.ts` plus a migration). This touches `readTillLines` (G17/G18).
- #656: first menu read from the house, `kitchen_line`. This is the first food-shaped menu row (G3/G4).
- #666: `ReceivingWorkspace.tsx` (command tree, G13).
- #706: README row for ADR 0315 (DRAFT, founder-owned).
- #722 / #725 / #730: days-of-stock goals behind the sales gate (G5 days-of-cover).
