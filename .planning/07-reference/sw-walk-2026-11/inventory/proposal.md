# /inventory: proposal (walk item #7, 2026-11-07)

Read-only against `origin/main` @ `e26a5152d`. Every `file:line` cites that tree. Inputs: `audit.md`, `sota.md`, `verdicts.json` (23 gaps: 8 confirmed, 15 narrowed, 0 refuted; the narrowed wording is used below). Under the founder's /goal of 2026-11-07 ("Do not ask me any questions I approve you decide them all"), every fork in §4 is **the session's call**. None is locked; each can be reversed before its lane merges.

Three facts this pass found that the audit did not have. They change the plan:

- **F-A. The house-item schema is very likely already in production.**
  - `20260903171000_the_house_item_is_the_ledgers_key.sql` is headed "GATED. DO NOT APPLY." (`:3`). It drops the wine NOT NULLs (`:167-176`) and adds `kind`, `uom` and `display_name` (`:276-280`), with `food` and `supply` in the kind CHECK (`:347-349`) and `g`/`kg`/`ml`/`l` in the uom CHECK (`:361-363`).
  - The required `Schema parity / Fresh database equals remote` job compares nullability and columns from `pg_catalog` against production (`scripts/check_schema_parity.sh:18-60`). It passed on `e26a5152d` on 2026-11-06 (run 42226223477).
  - Migrations auto-apply on merge (memory: schema-parity-drift).
  - So G2's records that say "NOT applied" (`.planning/decisions/README.md:140`; ADR 0115 status `0115-…md:3`) are very likely stale. This is inferred from CI, not read from production (§6).
  - **Consequence: G1 is now an API and UI gap, not a schema gap.** `CreateInventoryItemDto.wineId` is still required (`apps/api-gateway/src/inventory/dto/inventory.dto.ts:34-36`), and so is the write-off's `wineId` (`inventory-ledger.dto.ts:64,224`).
- **F-B. The phone count session is already built, but only on local, unpushed branches.**
  - Branches: `feat/count-session-envelope` (L1), `feat/count-open-bottles` (L2), `feat/count-walk-web` (L3), `feat/count-review` (L4), `feat/count-month-period` (L5), `feat/count-sheet-import` (L6) and `docs/adr-phone-stock-count` (ADR "0343"). They were built 2026-10-12..14 on the founder's F1-F4 picks (memory: founder-answers-2026-10-12-phone-count).
  - They are stacked on `integ/rehearsal-2026-10-10`, which is 1357 commits not on main. Lane diffs measure 101K, 97K, 96K, 185K, 82K, 60K and 28K characters.
  - L5 edits `month-close.service.ts` and `MonthCloseShelf.tsx`, which **do not exist on main**. L1-L4 and L6 touch only files that exist on main or files the stack itself creates.
  - **Consequence: G12 is a porting job, not a design job.**
- **F-C. A new gap, G24 (session-found, not adversarially verified).** `inventory_lots.unit_cost` is `numeric(10,2)` (`supabase/migrations/20260805000000_baseline_from_production.sql:3180`), and no later migration widens it. A food lot stored in grams keeps cost per gram at 2 decimals, so ₺0.035/g reads ₺0.04/g, a 14% error that flows into WAC, COGS and value.

---

## §1 Verdict

/inventory today is a good drinks page. It sorts by what is out, is honest about failed reads, and is live for 15/15 houses (ADR 0315). It still cannot add a food, write off a non-wine, say what an item is used in, show waste or count variance, or say anything about nutrition (G1, G3-G8). The schema for food is very likely already live (F-A), and a full phone count stack sits unpushed (F-B). So most of the work is opening the API to house items, adding figures from data we already record, and porting the count, not inventing new models. The plan has **30 lanes** (§3). Server correctness and honesty go first. A drawer per item with eight cards, "used in" and a nutrition card follows. The count port carries a shelf photo that proposes lines a person confirms one by one, with typing always available.

## §2 Target experience, per screen

Tokens only from `apps/web/src/styles/mudavym.css`:
- paper `--paper-0/1/2` (`:169-171`) and ink `--ink-1..4` (`:174-177`);
- `--warn` (`:185`), `--loss` (`:187`), `--alarm` (`:163`), `--seal` (`:211`);
- the dark set at `:240-253`.

People pages are simple (memory: sketch-style). The only dense page is the count review, which is a manager's technical page. No figure anywhere shows a model's confidence (ADR 0104 `:3`, "confidence never a number"). This pass also drops the confidence *word* (G11).

### S1. /inventory list (keeps ADR 0315's shape)
- The top stays **one sentence and one row of chips** (`InventoryNext.tsx:11-13`). There are no page-level KPI tiles.
- New chips:
  - kind: **Drinks · Food · Supplies · All**;
  - **"Waste this month: ₺X"** (owner/manager only), which opens the list of write-offs;
  - **"Count gaps: N items"**, which opens the items whose last count differed.
- Rows show quantity in the item's own unit ("12.4 kg", "3 bottles + 4/10"), stored as integer g/ml/each (ADR 0070 `0070-a-quantity-states-its-own-unit.md`).
- Clicking a row opens S2. The inline `RowDropdown` (829 lines) is retired into S2's evidence panels.
- **"Count a shelf"** in the header opens S4. The per-row count sheet stays as a one-item shortcut.

### S2. Item drawer `/inventory/:itemId` (nested route)
On desktop it is a right-side sheet over the list. On a phone it is a full screen. It has its own URL, Back closes it, and it follows the ADR 0112 overlay shape (memory: modal-census).

1. **Head:** the name, the kind, where it sits (locations), and the last count ("counted Tuesday by Ayşe, 2 off").
2. **Eight cards, in a 2×4 grid** (one column on a phone). Each card is a figure plus one sentence that says where it comes from. A card whose read failed says so; it never shows 0 (G15).
   - On hand: lots. Open bottles in tenths or ml.
   - Value: on hand × WAC. Owner/manager only.
   - Usage a day: one source, the ledger's sale and pour rows over 28 days. Recipe × sales theory sits beside it once recipes link.
   - Days of cover: on hand ÷ usage. "Not enough history" when there is not.
   - Cost trend: unit cost by receipt over 90 days, as a sparkline plus "up 8% since August".
   - Waste: waste rows over 30 days. Comps are a second line, "given away", not waste.
   - Count gap: the last 5 `stock_counts.variance_qty` values (`20260902190000_a_count_is_a_record.sql:89`). Money is owner/manager only.
   - **What's in it:** nutrition and allergens. It opens S3.
3. **Clicking a card** opens its evidence below the grid:
   - on hand → `WhereTheCountComesFrom` (lots and locations);
   - usage → the till chart, joined by **item id via `pos_item_mappings`, not label text** (fixes G18);
   - cost → the receipts (the old `WhatItHasCost` and `Paperwork`);
   - waste → the write-off lines;
   - count gap → the counts with who, when and the photo if any;
   - "What's in it" → S3.
4. **Used in:** one list, grouped by how sure the link is.
   - "Sold as" (`menu_items.inventory_item_id`, baseline `:3783-3806`).
   - "In these recipes": `cocktail_ingredients` by `beverage_id`/`wine_id` today (`20260817090000_cocktails.sql:60-72`), and `recipe_lines` by `inventory_id` once the recipes walk lands them.
   - "Named on the menu, not linked": the menu book `row-record` already returns and /inventory discards today (`RowDropdown.tsx:531-533`, G4). It carries one action, "Link this", which the recipes and menu owners take.
   - Each line opens that dish or drink. A drink opens its own drawer with the same cards, rolled up from its lines: cost per serve, usage from sales, and nutrition summed per serve.
5. **Actions:** Count · Write off (works for any kind; G7) · Order more (the existing `OrderLetter`).

### S3. Nutrition card (inside S2, also opened from a dish or drink)
- **Allergens come first:** the 14 EU/TR Ek-1 allergens, each marked contains, may contain, free, or **not stated** (sota.md "Legal floor").
- **Then per 100 g / 100 ml:** energy, fat, saturates, carbohydrate, sugars, protein, salt, plus ABV for drinks.
- **Every figure names its source:**
  - "you stated it";
  - "read from the label photo, you confirmed it";
  - "Open Food Facts, barcode 869…";
  - "USDA FoodData Central #…";
  - "from alcohol only (ABV × volume); sugar not known".
- An unknown figure shows as **"not known"**, never 0.
- **Actions:** "Read the label" (photo → proposed values → a person confirms each one), "Look up by barcode", "Search raw ingredients", "State it".
- A dish or drink card sums its lines per serve. Any line with an unknown value makes the total "at least X", with the missing items named.

### S4. Count a shelf (phone-width web, `/count` and `/count/:sessionId`, from L3)
- **Before starting:** pick a period (F1 ≤6 h), then pick shelves.
- **The walk is blind,** in shelf order. Each line has a stepper (− / +), a typed number, and an **open-bottle tenths bar** for drinks (F3). Food lines get a pack helper ("3 × 5 kg + 2.4 kg loose" → 17 400 g).
- **"Photo this shelf"** proposes a count for every line on that shelf:
  - "the photo shows 7 full and 1 at about 4/10";
  - nothing it cannot name is guessed;
  - unnamed objects appear as "something not on this shelf's list" to park or skip.
- **Every proposed line needs a tap to accept or a number to replace it.** Typing is always one tap away and works with no photo at all.
- **"Shelf done"** posts that shelf through `record_stock_count` on sync (F2), offline via `spotCountOutbox`.
- Barcode jumps to an item (the L3 scan/search).

### S5. Count review (manager; dense by design)
- Per shelf: counted vs expected, variance (money for owner/manager only), not counted, parked, conflicts, carry-this, and sign-off (from L4).
- New column **"how it was entered":** typed, stepper, photo accepted, photo changed, barcode, or sheet.
- A shelf where most lines were "photo accepted" gets a soft prompt to spot-check one line. This is the anchoring guard (§4 K5).

## §3 Phased build plan

Rules:
- Every PR is ≤15 files and ≤30K characters of `git diff mergebase head` (memory: gate-correctness-size-wall-30k), and is opened as a DRAFT (memory: ci-audit-gate: CI PASS auto-merges).
- Migrations are numbered at merge and cited by slug (ADR 0235); the version is picked past everything on main.
- Gateway `.ts` runs `tsc --noEmit -p tsconfig.spec.json`.
- Every migration gets a pgtest, and every new guard is mutated.
- "Fails on main" means the named test is red at `e26a5152d` and green on the branch.

### Phase 0: records (docs only)
| # | Branch | Files | Test that fails on main → passes | Depends on |
|---|---|---|---|---|
| I0 | `docs/inventory-every-good` | 1. An ADR for this walk's calls; the number comes from the guard. 2. Dated brackets in `README.md:140` and ADR 0115 `:3` citing the parity run as *inferred* applied. 3. Supersede the stale sections of `08-softwares/inventory-command.md` (retire-to-write: that note's §4/§7/§9, G23). 4. A `claims.d` row. | CLAIMS row: `20260903171000` is in the tree **and** `inventory.dto.ts` no longer requires `wineId` (status `open` → fails until I5a lands) | #589 (ADR 0115 lock text). Rebase on it, do not race it. |

### Phase 1: server correctness and honesty
| # | Branch | Files (≤15) | Test that fails on main → passes | Depends on |
|---|---|---|---|---|
| I1 | `fix/inventory-reads-say-when-they-fail` (G15) | `inventory.service.ts` (`fetchLotRollup` `:178-195`, `fetchLocationBreakdown` `:198-214` return `{ok,data}`); its spec; `useInventoryNextData.ts`; `RowDropdown.tsx` / later S2 | spec: Supabase returns `{error}` → `openMl` is `undefined` with `rollupReadable:false`, not `0` (`:163`); locations `undefined`, not `[]` (`:173`) | none |
| I2 | `fix/photo-count-reads-the-file-it-got` (G10, G11, G22) | `photo-count.service.ts` (`detectMediaType` `:132-139` by magic bytes; refuse HEIC/PDF with words); `InventorySheets.tsx` (client downscale to 1600 px JPEG at `:145-157`; drop `(${confidence} confidence)` `:163`; "Counted" not "Bottles counted" `:185,207`); `SpotCountPanel.tsx:167`; specs | spec: a PNG renamed `.jpg` is sent as `image/png`; a HEIC header is refused before the model call. Web test: the note text has no "confidence" | none |
| I3 | `fix/count-returns-its-own-item` (G16) | `inventory.service.ts:595-606` (item-scoped rollup); spec | spec: one count calls the rollup with an `inventory_id` filter, not house-wide | I1 (same file; sequence) |
| I4 | `fix/house-item-api` (G1 corrected, G7) | `inventory.dto.ts` (`wineId` optional when `kind`+`uom`+`displayName` given, ADR 0115(b) "carry this" `0115-…md:7-9`); `inventory-ledger.dto.ts:64,224` (`inventoryId` suffices); `inventory.service.ts` create and write-off paths; `mapInventoryItem` `?? 750` → `null` "size not known" (`:86-87`); specs | spec: POST `items` `{kind:'food',uom:'g',displayName:'Un'}` → 201 (400 today); write-off by `inventoryId` with no `wineId` → 201; an item with no library size maps `bottleSizeMl: null` | I1, I3; #589 |
| I5 | `fix/lot-cost-keeps-small-units` (G24) | migration (widen `inventory_lots.unit_cost` to `numeric(14,6)`; rebuild dependent views `inventory_lot_rollup`/`inventory_location_breakdown`, `20260902150000_lot_cost_truth.sql:445,486`); pgtest | pgtest: lot `unit_cost 0.035` reads back `0.035` (main: `0.04`) | none. Parity job proves prod follows. |
| I6 | `fix/inventory-analytics-house-first` (G14) | migration: `inventory_analytics` sales CTE groups by `(restaurant_id, inventory_id)` and joins on both (baseline `:3333-3341`), so `idx_inv_txn_restaurant_date` (`:9332`) serves the outer filter; pgtest | pgtest: `EXPLAIN (FORMAT JSON) … WHERE restaurant_id=$1` shows the `inventory_transactions` scan conditioned on `restaurant_id` (main: unconditioned aggregate) | none |
| I7 | `perf/inventory-pages-on-demand` (G13; OD-231) | `App.tsx:76-77` → `lazyWithRefresh`; `InventoryRoute.tsx:16-28` (lazy children; a failed flag read retries once, then says "We could not read this page's setting" with Reload, instead of falling back silently, `useMudavymDesign.ts:271`); a guard script plus its mutation test | guard: no static import of `InventoryCommandPage`/`InventoryRoute` in `App.tsx`. Web test: a rejected flag read renders the words, not the command page | #666 (`ReceivingWorkspace.tsx`, in the lazy tree) |
| I8 | `fix/row-open-reads-what-it-shows` (G17) | `inventory-ledger.dto.ts` (`limit` ≤ 50); `useInventoryNextData.ts:823-835` (`limit=3`); `beverages.service.ts:776-792` (`books=` scope); `beverages.controller.ts`; specs | spec: `GET transactions?limit=3` → 3 rows (400 today); `row-record?books=pos` runs no menu read | #650 (same `beverages.service.ts` till path). Land after it. |
| I9 | `fix/recipe-write-is-one-act` (G19) | **Owned by recipes walk #6, lane 1** (`../recipes/audit.md` §5.1). Listed here only as a dependency. | (#6's) | #6 |

### Phase 2: figures and links (server)
| # | Branch | Files | Test that fails on main → passes | Depends on |
|---|---|---|---|---|
| I10 | `feat/item-figures` | new `item-figures.service.ts` and spec; `inventory.controller.ts` GET `item/:id/figures`; DTO. Returns on hand, value, usage/day (ledger sale+pour, 28 d), days of cover, cost trend (lots by `received_at`, baseline `:3185`), waste (30 d `waste`; `comp` separate), count gap (last 5 `stock_counts`). Each field carries `readable` and a `source` sentence; money fields are null for staff. | spec: a fixture house with 2 waste rows and 1 comp → `waste.qty=2, given=1`; a staff token → `value:null`; a failed lots read → `costTrend.readable:false` | I1, I5; reuse `inventory-science.ts` from #619/#624 for cover when merged, else a local helper marked to fold |
| I11 | `feat/item-used-in` | new `item-used-in.service.ts` and spec; controller route. Union of `menu_items.inventory_item_id`; `cocktail_ingredients` on the item's `beverage_id`/`master_wine_id`; `recipe_lines.inventory_id` when the table exists (feature-detected); name-matched menu lines in a separate group | spec: an item linked by `menu_items.inventory_item_id` and by a cocktail line → both listed, `linked:true`; a label-only match → group `named_not_linked` | I4; #656 (food menu rows, `kitchen_line`); recipes #6 for `recipe_lines` |
| I12 | `fix/usage-chart-joins-by-id` (G18) | `beverages.service.ts` `readTillLines` takes `inventoryId` through `pos_item_mappings` (baseline `:4216`); `RowDropdown.tsx:532-538`; specs | spec: renaming an item keeps its till chart (today the label join drops it) | I8, #650 |

### Phase 3: UI
| # | Branch | Files | Test that fails on main → passes | Depends on |
|---|---|---|---|---|
| I13 | `feat/inventory-item-drawer` | `App.tsx` nested route; new `next/ItemDrawer.tsx`, `ItemCards.tsx` and tests; `services/api/inventory.ts`; CSS with tokens only | web test: `/inventory/:id` renders 8 cards; a card with `readable:false` says "could not be read", never 0; a staff role sees no ₺ | I7, I10 |
| I14 | `feat/item-drawer-evidence` | port `WhereTheCountComesFrom` `:473`, `HowFastItPours` `:531`, `WhatItHasCost` `:633` and `Paperwork` `:735` into card evidence; tests | web test: clicking "Cost trend" opens the receipts panel | I13, I12 |
| I15 | `feat/item-drawer-used-in` | `ItemUsedIn.tsx` and test; the drink drawer variant | web test: "Named on the menu, not linked" group renders with "Link this" | I11, I13 |
| I16 | `chore/retire-row-dropdown` | delete `RowDropdown.tsx` (829 lines) and its CSS; a row click opens the drawer | guard: nothing imports `RowDropdown` | I14, I15 |
| I17 | `feat/inventory-holds-food` | kind chips; a "Carry this" sheet (kind, unit, name, pack size); unit display (`12.4 kg` from `12400 g`); write-off for any kind (`InventorySheets.tsx:246,276-277`); waste and count-gap chips; tests | web test: a food item adds, lists under Food, and writes off; a write-off with no `wineId` no longer throws | I4, I10 |

### Phase 4: nutrition and allergens
| # | Branch | Files | Test that fails on main → passes | Depends on |
|---|---|---|---|---|
| I18 | `feat/item-nutrition-tables` | migration: `item_nutrition` (per `inventory_id`, `basis` 100g/100ml, nullable numerics, `source` CHECK in `stated`, `label_confirmed`, `open_food_facts`, `usda_fdc` or `from_abv`, plus `source_ref`, `stated_by`, `stated_at`) and `item_allergens` (14-value CHECK; status `contains`, `may_contain` or `free`; absence means not stated); RLS by house (ADR 0141); pgtest | pgtest: another house cannot read; an unknown allergen value is refused; a `NULL` energy stays `NULL` | I4 |
| I19 | `feat/item-nutrition-lookups` | gateway `nutrition.service.ts` and spec. OFF `api/v2/product/{barcode}.json` with a UA header; FDC search (key from env; absent → "lookup not set up", never a fake). Results come back as a **proposal**; a person confirms. Attribution strings. | spec: no FDC key → `{available:false}`; an OFF product missing salt → `salt:null`, not 0 | I18. The FDC key on Railway is the founder's keystroke (listed, not done). |
| I20 | `feat/item-label-read` | photo → proposed per-100 values and allergen words (vision, the same client as photo-count); confirm endpoint; spec | spec: the model's output is never written without a confirm call; no `confidence` field leaves the gateway | I18, I2 |
| I21 | `feat/item-nutrition-card` | `NutritionCard.tsx` and test (S3); per-serve roll-up for drinks and dishes ("at least X" with missing lines named) | web test: an unknown figure shows "not known"; a roll-up with one unknown line shows "at least" | I13, I19, I11 |

### Phase 5: count (port F-1544, then CV)
Port by cherry-picking each lane's single commit (`417f5cfea`, `09466bdfe`, `18c48a254`, `d5d799d84`, `59302df4c`, `ca80164c5`) onto main, then re-slicing it to ≤30K. Its specs and pgtests come along as the "fails on main" tests, because the tables, routes and pages they test do not exist on main.

| # | Branch | Content (slices) | Depends on |
|---|---|---|---|
| C1a-d | `feat/count-session-envelope-{1..4}` | L1: migration+pgtest · service core · service spec · controller+module | I3 |
| C2a-d | `feat/count-open-bottles-{1..4}` | L2: migration+pgtest · `stock-count-result.ts`+guard · `recordSpotCount` · specs | C1, I3 (same `recordSpotCount`) |
| C3a-d | `feat/count-walk-web-{1..4}` | L3: outbox+sync · walk model+test · `CountWalk.tsx` · index+route+api | C2, I7 (route lazy) |
| C4a-g | `feat/count-review-{1..7}` | L4: migration+pgtest ×2 · service ×2 · spec ×2 · `CountReview.tsx`+test | C3 |
| C6a-b | `feat/count-sheet-import-{1,2}` | L6: `countSheet.ts`+test · panel+test (closes G20) | C4 |
| C7 | `docs/adr-phone-stock-count` | ADR "0343", **renumbered at the guard** (main is at 0354) | C1 |
| C8 | `feat/count-photo-a-shelf` | gateway `shelf-count.service.ts` sends the **names on this shelf only, never expected quantities** (keeps the walk blind). It returns per-name full count, open level in tenths, and unnamed objects. `CountWalk` "Photo this shelf" fills lines as *proposed*. `stock_counts.source` (`20260902190000…sql:95`) records `photo_accepted`/`photo_changed`. Photo goes to a private, house-scoped bucket, path on the line. Specs. | C3, I2 |
| C9 | `feat/count-review-entry-method` | S5 "how it was entered" column and the spot-check prompt | C4, C8 |
| C10 | `test/shelf-count-eval` | fixture set (shelf photos with ground truth) and a harness reporting line accuracy **to the team only**; C8 ships dark until measured on real house shelves | C8 |
| held | `feat/count-month-period` (L5) | waits for month close (ADR 0334 code is integ-only; `month-close.service.ts` is absent on main) | month close reaching main |
| held | `feat/count-walk-mobile` (L7) | F4: web first; native later | OD-109 |

If **#692** (the audit streams and raises the cap; gate-owned, founder review) merges, the 30K wall lifts and C1-C6 collapse back to 5 lanes. The plan works either way.

**Lane count:** Phase 0: 1 · Phase 1: 8 (I9 belongs to #6) · Phase 2: 3 · Phase 3: 5 · Phase 4: 4 · Phase 5: 9 groups (C1-C4, C6-C10; ≈25 PRs at the 30K wall). That is **30 lanes**, or ≈46 PRs while #692 is unmerged.

**Order:** I0 → I1, I2, I5, I6 in parallel → I3 → I4 → I7, I8 → I10-I12 → I13-I17 → I18-I21. C1 starts after I3, in parallel with Phase 2.

## §4 Forks: the session's calls

Each call names the rejected alternatives, then one attempt to kill the leading choice.

**K1. Where the KPI cards live → in the item drawer (S2), not at the page top.**
- Rejected:
  - Page-top tiles. They push "what is out" below the fold at 7pm, the reason ADR 0315 has none (`InventoryNext.tsx:11-13`).
  - A separate KPI page. It is a second place to look.
- Kill attempt: "the founder asked for full KPI cards; he may mean the page." His sentence is about clicking an item ("clicking an item shows… full KPI cards"). House-wide figures he would miss (waste, count gaps) are added as chips. **Survives.**

**K2. What the drawer is → a nested route `/inventory/:itemId` rendered as a sheet (full screen on a phone).**
- Rejected:
  - Growing `RowDropdown`. It is already 829 lines and has no room for eight cards, used-in and nutrition.
  - A standalone page. It loses the list.
- Kill attempt: "a sheet is heavier than a dropdown; the founder said 'I prefer simpler'." One surface replaces four inline sections, and Back closes it. **Survives.**

**K3. Literal "clicking a KPI card opens a nutrition card" → each card opens its own evidence; the eighth card, "What's in it", opens the nutrition card.**
- Rejected: every card opens nutrition. That hides the evidence behind money figures; a waste figure opening calories explains nothing.
- Kill attempt: "this departs from his words." The ask's purpose (nutrition one click from the item) is met, and every figure stays explainable. **Survives, as a stated departure.** Listed in the ADR for his reversal.

**K4. Nutrition source → person-stated first (with a label-photo read that a person confirms), then Open Food Facts by barcode for packaged goods, then USDA FDC for raw ingredients; drinks also get "from alcohol only" energy from ABV. Allergens are person-stated only.**
- Rejected:
  - An LLM estimating nutrition. That invents figures.
  - Paid APIs (Edamam, Nutritionix). Cost, plus caching terms we have not read.
  - TürKomp. Its licence was not verified.
  - Inferring allergens from ingredient names. It is a legal duty in TR and the EU (sota.md "Legal floor"), and a wrong "free" is harm.
- Kill attempt: "ODbL share-alike contaminates our database." We store per-item values with attribution and do not redistribute a derived database. If we ever publish one, it must carry ODbL. **Survives, with that condition written into the ADR.** Second kill attempt: "is it worth building before food recipes exist?" Allergens alone are a legal floor for every house today. **Survives.**

**K5. CV count shape → a shelf photo inside the count walk proposes every line on that shelf (closed set of names, no expected quantities); every line needs a tap; typing is always available; open levels are in tenths.**
- Rejected:
  - Auto-posting CV counts. Nobody credible does this (sota.md "Takeaway").
  - Open-set shelf recognition. It is harder, and the shelf list already knows what should be there.
  - Keeping one item per photo. That means 60 photos for 60 lines.
  - A Bluetooth scale. Hardware; deferred.
  - Voice. A noisy bar and two languages; rejected for now.
- This decides **OD-230** as a mix of stepper, typing, tenths bar, barcode to find and photo per shelf (`OPEN-DECISIONS.md:319`).
- Kill attempt: "a proposed number anchors the counter and defeats a blind count, so variance becomes the model's error." This is real. Mitigation:
  - only names are sent, never expected quantities, so the model is blind too;
  - every line records how it was entered (C9);
  - the review prompts a spot-check where most lines were photo-accepted;
  - C8 ships dark until C10 measures it.
- **Survives, conditionally.** If C10 shows that people accept wrong proposals, the button stays off and typing remains.

**K6. Food quantities → integer in the smallest unit (g/ml/each) per ADR 0070; widen lot `unit_cost` to 6 decimals (I5).**
- Rejected: `numeric` quantities. Refused 5-0 in OD-113's audit (`OPEN-DECISIONS.md:72`).
- Kill attempt: "6-decimal cost is a ledger change too." It is a cost column, not a quantity. No CHECK or integer local depends on it except the two views I5 rebuilds. **Survives.**

**K7. Treat 20260903171000 as applied (F-A) and build the API on it, rather than re-gating.**
- Rejected:
  - Waiting for a prod read. Prod is off-limits to this walk.
  - Writing a new migration. It would collide with what parity says exists.
- Kill attempt: "parity proves columns match, so if both sides lack them it is also green." That is false here: the tree **has** them (`:276-280`), so a green run means prod has them too. The parity job's own exclusions were not read in full (§6). **Survives, with I0 recording it as inferred.**

**K8. Port the unpushed F-1544 lanes rather than rebuild.**
- Rejected: rebuilding from the ADR text. Six built lanes with specs already exist.
- Kill attempt: "they sit on a 1357-commit integration branch and may depend on it silently." The file check shows L1-L4 and L6 modify only files that exist on main or files they create themselves; L5 is held. Cherry-pick conflicts were not tried (§6). **Survives.** If a cherry-pick needs integ-only code, that lane is rebuilt on main from its spec.

**K9. Usage has one source → the ledger (sale+pour rows); the till chart joins by item id.**
- Rejected: keeping the label join (G18).
- Kill attempt: "the ledger only sees mapped sales." True, which is why the card says "from sales we can tie to this item", and an unmapped till line is listed under "Named on the menu, not linked". **Survives.**

**K10. Waste vs comp → separate lines.**
- Rejected: summing them. A comp is a decision, not a loss.
- Kill attempt: "owners think of both as shrink." Both show on one card; only waste is the headline. **Survives.**

**K11. OD-231 (failed flag read) → retry once, then say so with Reload. Never fall back silently to the command page.**
- Rejected:
  - Today's silent fallback (`useMudavymDesign.ts:271`).
  - Retrying forever.
- Kill attempt: "the command page is better than an error." The command page is retired weight (I7) and shows a different truth. **Survives.**

**K12. Photo retention → kept privately with the count line for 400 days, then deleted.**
- Rejected:
  - 30 days. Disputes surface at month and quarter close.
  - Forever. Staff faces may be in shot.
- Kill attempt: "faces mean personal data under KVKK." Use a house-scoped private bucket, signed reads, managers only, and a stated retention. **Survives,** with the retention sentence in the ADR.

## §5 Integration contract with neighbouring softwares

| Neighbour | Inventory gives | Inventory takes | Key / failure rule |
|---|---|---|---|
| **Receiving / door** (#2 cost-math; `receiving.service.ts`, PRs #664 #666 #668) | the house item to carry (`kind`, `uom`, `display_name`) | lots with `unit_cost` per smallest unit (I5); a new item only via "carry this" (ADR 0115(b)) | `inventory_id`. The door never invents a kind or unit; unknown → park. |
| **Recipes** (#6; `../recipes/audit.md` §5) | `GET item/:id/used-in`; per-item nutrition and allergens per 100 | `recipe_lines(inventory_id, qty smallest unit)`, an atomic write RPC (I9 = #6 lane 1), depletion by recipe | Recipes owns `recipe_lines` and the cocktail editor. Inventory only reads, and feature-detects the table. |
| **Menu** (#1; PR #656, #761 #762) | the "Named, not linked" list with a "Link this" hand-off | `menu_items.inventory_item_id` (1:1 sale link); food rows by `kitchen_line` | Link by id. A name match is shown as unlinked, never counted. |
| **Till / POS** (`pos_item_mappings`, Toast map `inventory.service.ts:1883-2130`) | — | sale and pour ledger rows; mapping by id | Unmapped lines are listed, not guessed. |
| **Analytics engine** (`inventory-science.ts`, #619 #624; goals #722 #725 #730) | figures endpoint (I10) as the one source for cover and usage | open-ml-aware cover from #619 once merged | One definition of days of cover. If both exist, I10 calls theirs. |
| **Reports / month close** (#4; ADR 0334) | waste, count gap and value per period from I10 | the count period filing (L5, held) | Waste = `waste` rows; comp separate (K10). |
| **Orders** (`OrderLetter.tsx`) | days of cover and on hand | — | unchanged |
| **Cellar** (`/cellar`, `RowExpander.tsx:217`) | the `row-record?books=` scope (I8) | — | /cellar keeps reading the menu book; the default stays all books. |
| **Notifications** (low-stock digest) | — | — | Untouched; reads the same on-hand figure. |
| **Mobile** (`apps/mobile`) | count API (C1-C4) | — | L7 is held (F4). |

## §6 What stays unverified

- **Production state of `20260903171000`** is inferred from a green parity run (F-A, K7). Prod was not read, by rule. `check_schema_parity.sh` was read only to `:60`; its table exclusions beyond `_bak_*` were not checked.
- **The F-1544 port:** no cherry-pick was attempted. Conflicts with main's 45 newer commits (e.g. `App.tsx` changed 3 times, `inventory.service.ts` once since the base) are unknown. Whether L1-L4 call integ-only helpers at runtime was not traced, only file existence. ADR "0343"'s final number is the guard's.
- **G24 (lot cost precision)** was found by this pass and not adversarially verified. Whether any writer already stores cost per larger pack to dodge it was not traced.
- No bundle build, `EXPLAIN` or test run happened in this pass. Every "fails on main" claim is a design for the lane to prove, not a measured red.
- **Production data size** is unknown. The OD-113 note measured 72/2/4 rows on 2026-09-02 (`OPEN-DECISIONS.md:72`), so G14/G16/G17 are probably cheap today. They stay low priority behind correctness.
- **CV:**
  - No shelf-photo accuracy is known. Vendor claims are marketing (sota.md).
  - Whether `claude-haiku-4-5` (`photo-count.service.ts:77`) is strong enough for multi-item tenths is unmeasured. C10 decides, and the model may need to change.
  - iOS HEIC transcoding behaviour was not tested.
- **Nutrition:** OFF licence and API terms come from third-party summaries (sota.md). Turkey's 2024-04-06 amendment content is not verified. Getting an FDC key is the founder's action.
- **#589** (ADR 0115 lock) may change the kind and uom vocabulary; I4 and I17 must re-read it at build time.
- Whether `stock_counts.source` has a CHECK that needs a migration for C8's values was not read (`20260902190000…sql:95`).
