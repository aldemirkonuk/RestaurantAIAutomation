# QA round 14: inventory feature PRs #860 / #861 / #862 (used-in, figures, carry a food)

Date 2026-11-07. Stack head `b3723e2ab` (#862) on `259feea3f` (= origin/main). Own commits: #860 `90b45d359`, #861 `68e55b1f2`. Worktrees `/private/tmp/claude-501/qa-wt-r14-{1,2,3}` (read-only use, removed at the end). Probes: `sw-walk/qa-report/round14-probes-inventory/`.

## How it was tested
- Existing specs at each PR's own commit: #860 4/4, #861 9/9 (4 + 5), #862 13/13 at the stack head. `tsc --noEmit` on api-gateway at the head: 2 errors, both `@simplewebauthn/server` not installed in the shared node_modules (environment, not the PRs). `check_route_exposure.py` and `check_money_routes_are_sealed.py` PASS at the head. CI on the PRs: Vercel deploys "rate limited" (infra), the rest green/pending.
- **Real SQL**: all 299 migrations built in PGlite (`build.mjs`). A PostgREST-shaped client over PGlite (`pgsupa.mjs`: eq/neq/in/is/not/gte/gt/or/order/limit/maybeSingle/single/insert, row cap 1000 as in `supabase/config.toml:18`, URL cap 16,000 chars as an EMULATED limit) runs the REAL `ItemUsedInService`, `ItemFiguresService`, `HouseItemService` (ts-node) against real tables, CHECKs, enums, the `restaurant_inventory_house_declared_uidx` index and the `inventory_lot_rollup` view. Fidelity limits: PGlite is one session, superuser, no RLS/PostgREST/Kong; `lower()` collation is PGlite's, not production's; the 16 KB URL limit is a stand-in.
- Mutation matrix (`mutate.py`): each guard in the new services removed one at a time, the PR's own spec re-run. Table below.

## What the stack IS
Three **API-only** endpoints, no web code, no migration, no seed:
`GET /inventory/:r/item/:id/used-in` (#860), `GET .../figures` (#861), `POST /inventory/:r/house-items` (#862). `grep used-in|house-items|/figures` across `apps/web/src` and `apps/mobile`: no hit. So nothing a bar manager can click exists yet; the empty-state and error-state UI checks have no UI to run on.

## Verdicts

| PR | Verdict | One line |
|---|---|---|
| #860 used-in | **PARTIAL** (API works and is tenant-safe; the answer is thin and there is no UI) | Menu lines + house cocktails by catalogue id work; recipes are explicitly "not recorded"; web writes no `beverage_id`, so house cocktails will mostly be absent |
| #861 figures | **PARTIAL** | Right shape, honest nulls, money gated. Shadow lots leak into the cost trend; per-gram money is wrong until #839 merges; silent 1000-row cap on waste |
| #862 carry | **PARTIAL** | The row is created correctly and the DB agrees. The row then does not reach the dashboard low-stock KPI / ask-AI / MCP low-stock (inner join to the wine library), the list API still tags flour "750 ml bottle, 5 glasses", and Turkish case duplicates slip the unique index |

No REGRESSION found (nothing existing is changed; the module/controller additions resolve: `OrganizationsModule` exports `OrganizationsService`, `DatabaseModule` is global).

## #860 where one item is used (`item-used-in.service.ts`)

| Scenario | Result | Evidence |
|---|---|---|
| Item used in 40 cocktails | 40 distinct cocktails listed. A cocktail using it twice appears twice (41 lines): a UI that prints `lines.length` would say 41 | `p1-used-in.out.txt` S1 |
| Used in 0 | `lines: []`, readable, with a source sentence. Honest | S2 |
| Archived / draft menu, discarded line, soft-deleted cocktail | Excluded (menu `status = active` `:121`, `neq discarded`, `deleted_at is null` `:239`). `in_review` and `flagged` lines ARE counted as sold, same rule as `menus.service.ts:1056` so consistent | S3 |
| Recipe that was versioned | No recipe versioning exists in the schema (cocktails: no version column). Not testable; the response says `recipes.recorded:false` | S15 |
| Sub-recipe loop | Cannot occur: `cocktail_ingredients` has only `beverage_id`/`wine_id`/`free_text`, no recipe reference | schema dump `schema2.mjs` |
| Deleted good still referenced | Returns 200 with the item as if live, no `deletedAt`/`isActive` field. `readHouseItem` (`:50-58`) does not filter `deleted_at`. A manager who removed "Old Vodka" and opens it sees live-looking lines | S5 |
| Another house | H2 asking for H1's item: 404. H2's cocktail using the same catalogue gin, and an H2 menu line carrying a corrupt `inventory_item_id` pointing at my item: neither leaks (house filter on `menu_items` and `cocktails`) | S6 |
| Bad uuid in the URL | 404 text, not 500 | S6b/c |
| Turkish names | `Rakı`/`RAKI`/`raki`, `İstanbul`, `Çilek Likörü`/`ÇİLEK LİKÖRÜ`: all match. **Not folded**: `ß` (`Straße` vs `Strasse`), `Ł`, `Ø`, and the apostrophe (`Dewar's 12` vs `Dewars 12`: `dewar s 12`). Non-Latin names fold to empty and silently return no suggestions (`Ğ`-only or `乌龙茶`). Suggestions only (never counted) so it is a miss, not a wrong count | S7 |
| Wildcard `Un_` / `%` | No wildcard behaviour (`Unx` not matched). The PR's claim holds; note `Un%`, `Un_` and `Un` all fold to the same string and match each other | S8 |
| 5,000 unlinked lines | Paging by id works, tail line found in 9 queries / 40 ms (PGlite) | S9 |
| Failed reads | Each group goes `readable:false, lines:null`, other groups still answer; item read fails 503. Good | S11 |
| House cocktail count at scale | The ingredient read is unpaged and the `cocktails` read passes every id in the URL. 3,000 house cocktails using one bottle, or 1,200 catalogue cocktails using it, makes the cocktail group "could not be read" (loud, not silent: the URL fails before the 1000 cap bites). Today the catalogue is 55 cocktails (`BEVERAGE_CATALOGUE_PLAN.md:310`), so LATENT | S12/S12b |
| Wine with library link | Linked by `wine_library_id` listed, a line linked to another item skipped, an unlinked same-name line goes to `namedNotLinked` | S14 |

**Missing for the founder's ask in #860:** (1) recipes (dishes) are not read at all: `recipes: {recorded:false}`; there is no food-recipe-to-good link in the schema. (2) The web recipe editor never sends `beverageId` (grep `beverageId` in `apps/web/src`: 0), so `cocktail_ingredients.beverage_id` is only written by API clients; a house cocktail typed in the UI will not show under its spirit. "Click lime juice, see 40 recipes" will, for a UI-built bar, show 0 cocktails today. (3) No UI.

## #861 figures (`item-figures.service.ts`)

| Scenario | Result | Evidence |
|---|---|---|
| 0 counts | `last: []`, "Never counted." readable | F2a |
| 1 count | row with expected, counted, variance -2, who, money -10 at WAC 5 | F2b |
| Positive, zero, negative variance | +25, -50, +30 as money; correct signs | F2c |
| Count in `stock_state = 'shadow'` | **Shown in the same list as live counts** (the `stock_counts` read has no `stock_state` filter, `:116-122`); the table allows `live|shadow` (`stock_counts_stock_state_check`) | F2c row `[3,9,6,30]` |
| Waste larger than stock | 50 g waste on a 2 g lot reports 50 / value 600; the ledger itself cannot write below zero (`valid_quantity_after`), so this only arises from later stock loss. No guard, no wrong figure | F1 |
| Waste vs comp | Kept apart (qty30d vs given30d); shadow-stock, 31-day-old and other-house rows ignored | F7b |
| Waste reversal booked as a positive `waste` row | Counted as +abs, so -10 then +10 reads 20. Theoretical: reversals use other types | F7 |
| More than 1000 waste rows in 30 days | **Silent**: 1,200 rows of 1 reads `qty30d 1000`, `readable:true` (no `count`/`range`). LOW likelihood | F8 |
| Cost trend: 1 point | `changePct:null` and "Not enough receipts"; the single point is returned | F3a |
| Cost trend: 0 points | `points: []`, same sentence | F3b |
| **Shadow lot in the trend** | `[10, 99, 12]`: a shadow-state lot at 99 enters the trend and the change% (the comment at `:152` says "as the WAC excludes them", but the WAC also keeps `stock_state='live'` only: `inventory_lot_rollup` definition). One-line fix: `.eq("stock_state","live")`. Control mutation (adding that filter) keeps the spec green | F3c |
| Depleted lots | Still returned (status `depleted` is not filtered) - a receipt is a receipt, correct | F3d |
| Currency mix | `inventory_lots`/`inventory_transactions` carry no currency column (house `restaurants.currency` default USD), so a euro delivery into a lira house cannot be detected; the trend subtracts them. By design gap, not new | schema |
| **Six-decimal costs** | At the stack head `unit_cost` is `numeric(10,2)` and the rollup view rounds WAC to 2 places: 0.035/g and 0.0385/g both store as 0.04 (trend `[0.04, 0.04]`), and a salt lot at 0.004/g gives WAC 0.00, so 1,000 g wasted shows value **0** and the count gap money **0** as known figures (not null). With PR #839's migration applied (`p2b-with839.mjs`): trend `[0.004, 0.0045]`, change 12.5%, waste value 4.25, count money -4.25: correct. **#861 money for any g/ml good is only right once #839 merges**; nothing in #861 or #862 declares that dependency | F3e-g, p2b |
| Staff caller | No value, no money, trend `points:null` with "Cost is shown to owners and managers." Role unreadable -> "unread" sentence. Good | F4 |
| Other house | 404; a foreign-house lot carrying my `inventory_id` is not read (house filter on every query) | F5 |
| Each read failing | Waste / counts / trend / who-counted / WAC each degrade on their own with a sentence, never 0 | F9 |
| Cost | 6 queries for one item (4 ms PGlite) | F10 |

**Missing for the founder's ask in #861:** these are per-item drawer figures. There are no list-level KPI cards (on hand, value, days of cover, waste, count gap across the house) and no endpoint for them; the PR says on hand / WAC / value / velocity "are NOT here". No UI.

## #862 carry a food / other good (`house-item.service.ts`)

| Scenario | Result | Evidence |
|---|---|---|
| Flour, g, no par | 201, row `kind food, uom g, wine_name = display_name, identity_provenance house_declared, stock_live 0, threshold_min 0, is_active true`, no library row. DB CHECKs and the trigger accept it | `p3-carry.out.txt` C1 |
| Appears in `house_items`, `inventory_analytics`, the `restaurant_inventory` list read | Yes | C1 |
| Appears in `v_active_inventory` | **No** (0 rows) | C1 |
| Low-stock with par 500, stock 0 | **Not in `v_low_stock_items`** (inner `JOIN master_wine_library`), which feeds the dashboard low-stock card (`dashboard.service.ts:624, 1181, 1420`) and the MCP low-stock tool (`mcp-tool-readers.service.ts:70`). The plain rule `stock_live < threshold_min` does list it, and the web list/ask-readings read the table directly, so /inventory shows it but the dashboard counts it as fine | C1b |
| List API shape for the new row | `bottleSizeMl 750, bottleSizeOz 25.4, pourSizeMl 150, glassesPerBottle 5, unit_type BOTTLE, sale_type bottle` for flour: `mapInventoryItem` (`inventory.service.ts:87-88`) still invents a wine bottle (the known B-2/I-G1 fabrication; #862 does not touch it, and `bottle_size_ml` is null so it falls to 750) | `p4-list.mjs` |
| Duplicate | `UN (FLOUR)` after `Un (flour)`: 409 naming `existingId`. Two simultaneous identical POSTs: one 201, one 409 (index decides) | C2a, C7 |
| Turkish duplicates | `Rakı` then `RAKI`: both created (PG `lower('I')='i'` != `'ı'`), `IRMIK` and `ırmık` both created: two rows for one good. `İzmir Köfte` then `izmir köfte`: 409 but `existingId: null` (the JS `toLowerCase()` fallback at `:78` disagrees with PG, so the UI cannot point at the existing row). Collation is PGlite's; the `I`/`ı` case is the same in any non-Turkish production locale | C2b-h |
| Validation | kg and l refused with "store it in g/ml" (400). wine refused. 121-char name 400. Missing name 400. `kind cocktail` accepted | C3 |
| Prototype keys as uom | `uom: "constructor"` / `toString` / `__proto__` hit `BIG_UNIT[dto.uom]` (a plain object, `:19`) and return 400 with the message "...small units: function Object() { [native code] }". Still a refusal; cosmetic, wrong text | C3n-p |
| Par out of range / NUL char | `thresholdMin 3e9` (no `@Max` in the DTO) and a NUL byte in the name reach Postgres and return **500** with the DB message instead of 400; `2147483647` is accepted as a par | C3g, C3i |
| Unknown or non-uuid house | 500 with FK / uuid text (the tenant guard stops this in production; the service does not) | C6 |
| Body `restaurantId` | Ignored; row lands in the URL house | C5 |
| Re-carry a name after soft-delete | Allowed (the index excludes deleted rows); the old id keeps its menu links | C4 |
| First stock | `apply_stock_movement(p_inventory_id, p_stock_state, p_delta, ...)` is keyed on inventory id, so a food can receive a lot/count through the existing ledger routes; this PR creates none | C8 |
| Role | Any house member can POST (same as the wine `POST :restaurantId/items` when no price is sent, `inventory.controller.ts:166-190`); no audit actor recorded on the row | code |

**Missing for the founder's ask in #862:** foods can now be carried but there is no UI to add or receive one, the dashboard low-stock card / MCP / ask tools (`v_low_stock_items`) will not see them, the list API labels them as 750 ml bottles, and "foods in the inventory UI" depends on a web client that does not exist.

## Cross-cutting: still true after the stack
- **1000-row cap (H-1) NOT FIXED.** `DatabaseService.getRestaurantInventory` (`database.service.ts:43-53`) has no range/limit. 5,001 goods in the PGlite house: the list read returns 1,000 rows in 64 ms; the web footer prints "All {rows.length} of {rows.length} titles are listed" (`InventoryNext.tsx:964`) from what it loaded. Carrying foods (#862) makes crossing 1,000 goods far more likely, so the stack worsens this gap without addressing it.
- The `getWinesByIds` ids-in-URL overflow (U-1) is no longer called by `pages/inventory` at this commit (only `useWineQueries.ts`, `wines.ts`); not re-verified in a browser.
- Not tested: any browser/UI state (no UI), real PostgREST/Kong limits, production collation, a real multi-user concurrent load.

## Does a test fail without the code? (mutation matrix, one guard removed at a time)
| PR | Guard removed | Own spec | |
|---|---|---|---|
| #860 | cocktails not scoped to house (drop .eq restaurant_id on cocktails) | 1 failed, 3 passed, 4 total | **CAUGHT** |
| #860 | deleted cocktails counted (drop .is deleted_at) | 4 passed, 4 total | **SURVIVES** |
| #860 | menu_items not scoped to house in soldAs (drop .eq restaurant_id) | 4 passed, 4 total | **SURVIVES** |
| #860 | archived/draft menus counted (drop status active) | 1 failed, 3 passed, 4 total | **CAUGHT** |
| #860 | discarded lines counted (drop neq discarded in soldAs) | 4 passed, 4 total | **SURVIVES** |
| #860 | failed read shown as [] (failed() returns lines []) | 1 failed, 3 passed, 4 total | **CAUGHT** |
| #860 | namedNotLinked paging dropped (single page) | 4 passed, 4 total | **SURVIVES** |
| #860 | item of another house found (drop restaurant filter in readHouseItem) | 1 failed, 3 passed, 4 total | **CAUGHT** |
| #861 | waste window dropped (30d) | 2 failed, 3 passed, 5 total | **CAUGHT** |
| #861 | shadow-stock waste counted (drop stock_type live) | 5 passed, 5 total | **SURVIVES** |
| #861 | waste and comp added together | 2 failed, 3 passed, 5 total | **CAUGHT** |
| #861 | sample lots in cost trend (drop neq sample) | 1 failed, 4 passed, 5 total | **CAUGHT** |
| #861 | cost trend 90d window dropped | 5 passed, 5 total | **SURVIVES** |
| #861 | CONTROL: add `stock_state = live` to the cost-trend read (the fix for F3c) | 1 failed, 4 passed, 5 total | **spec turns RED (its lot fixtures have no `stock_state`, so the fix needs the fixtures updated)** |
| #861 | counts not scoped to house (drop restaurant_id on stock_counts) | 5 passed, 5 total | **SURVIVES** |
| #861 | lots not scoped to house (drop restaurant_id on inventory_lots) | 5 passed, 5 total | **SURVIVES** |
| #861 | staff sees money (seesMoney always true) | 1 failed, 4 passed, 5 total | **CAUGHT** |
| #861 | last 5 counts -> unlimited (drop limit 5) | 5 passed, 5 total | **SURVIVES** |
| #862 | par default 3 instead of 0 | 1 failed, 3 passed, 4 total | **CAUGHT** |
| #862 | kg allowed (drop BIG_UNIT check) | 1 failed, 3 passed, 4 total | **CAUGHT** |
| #862 | wine allowed through carry | 1 failed, 3 passed, 4 total | **CAUGHT** |
| #862 | duplicate returns 500 not 409 | 1 failed, 3 passed, 4 total | **CAUGHT** |
| #862 | name not trimmed | 2 failed, 2 passed, 4 total | **CAUGHT** |
| #862 | not marked house_declared | 1 failed, 3 passed, 4 total | **CAUGHT** |
| #862 | stock_live set at creation (invented stock) | 1 failed, 3 passed, 4 total | **CAUGHT** |

Of 25 mutations (24 guards + 1 control): 15 caught, 9 survive. Survivors that matter: tenant scoping on `menu_items` (#860 soldAs) and on `stock_counts` and `inventory_lots` (#861) is untested (the code has the filters; real-DB probes S6/F5 confirm they work today, but a deletion would pass CI); also untested: soft-deleted cocktails, discarded lines, named-not-linked paging past 1000, shadow-stock waste, the 90-day trend window, the last-5 limit. Without its code every other test fails: all 7 of #862's, #860's cocktail-scope / archived-menu / unreadable / other-house, #861's 30-day window, waste-vs-comp, sample lots, staff-money.

## What of the founder's ask is still missing
| Ask | Status after #860-#862 |
|---|---|
| Inventory UI with ALL goods incl. foods | **Missing.** API can create a food (#862); no web screen creates, receives, or labels one; list API still invents a 750 ml bottle for it; list is capped at 1,000 |
| Click an item -> used in which items | **API only** (#860). No click target, no panel, no web client function. Dishes/recipes not read; house cocktails only when written with a catalogue `beverage_id`, which the web editor never does |
| KPI cards | **Missing at list level.** Only per-item waste / count gap / cost trend (#861), no UI, and money for per-gram goods is wrong until #839 merges |
| Nutrition card | **Missing entirely** (grep `nutrition|kcal|allergen` in `apps/web/src/pages/inventory` and `apps/api-gateway/src/inventory`: 0; no table or column) |
| Foods in lists/KPIs/par/low-stock/orders | Lists: yes (table read). `v_low_stock_items` (dashboard, MCP): **no**. `v_active_inventory`: **no**. Orders/par: par is stored (0 by default, not the DB default 3), nothing reads a carried food into an order letter in this stack (not traced end to end) |

## Counts
Probe lines run: used-in 36, figures 31, carry 40 (plus 4 list/cap lines and the per-gram rerun with #839). Findings: BUG 5 (shadow lot in trend, shadow count in count gap, food missing from `v_low_stock_items` consumers, Turkish duplicates / null `existingId`, deleted good returned as live), DEPENDENCY 1 (#861 money needs #839), LATENT 3 (cocktail URL overflow, 1000-row cap on waste, 1000-row cap on list), COSMETIC/LOW 4 (prototype-key uom text, 500 instead of 400 for out-of-range par and NUL, ß/Ł/Ø/apostrophe not folded, reversal abs). Verdicts: #860 PARTIAL, #861 PARTIAL, #862 PARTIAL, REGRESSION none.
