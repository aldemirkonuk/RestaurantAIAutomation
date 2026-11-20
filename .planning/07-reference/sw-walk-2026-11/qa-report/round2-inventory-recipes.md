# QA round 2: Inventory (all goods, used-in, KPI cards, nutrition) and drink/cocktail recipes <-> goods

Date 2026-11-07. Judged as a bar manager. Read-only: no repo edits, no server, no DB, no production.
Tree note: the working checkout is `059169a59` (Sep 23) and is 204 commits behind `origin/main` `4e4399c05`. Everything below was read from an `origin/main` extract (`git archive`) in the session scratchpad, so `file:line` cites `origin/main`. "Known" = already a gap id in `sw-walk/inventory/verdicts.json` (I-G#) or `recipes/verdicts.json` (R-G#). "NEW" = not in either.

## Tests run (existing, pure/unit only)
- API: `npx jest src/inventory src/beverages src/common` in the extract: 62 of 63 suites, 1083 of 1085 tests pass. The 2 failures are `commitment-patterns.spec.ts` reading `services/agent-orchestrator/...py`, which my partial extract does not contain. Not a product defect.
- Web: `npx vitest run src/pages/inventory`: 19 files, 419 tests pass. Note the test "groups the footer ... past 1,000 titles" (`InventoryNext.test.tsx:888`) took 35,276 ms in jsdom for 1,001 rows.
- Probes (scratch only): `recipeprobe.js` (the recipe-line regex), inline node probes for `fold`, oz/ml round trip, per-pour cost. Nothing ran against a DB, so every "stored/trigger" claim is code-read and marked.

## Important framing
The three things the ask names are mostly **not built on main**: no "used in" (grep `used in|usedIn` in `pages/inventory`: none), no KPI cards (`InventoryNext.tsx:11-13` says "No KPI tiles" on purpose), no nutrition or allergen anywhere (grep `nutrition|kcal|allergen|calorie` across `apps/web/src`, `apps/api-gateway/src`, `supabase/migrations`: only 3 unrelated test files). The session proposals (`inventory/proposal.md`, `recipes/proposal.md`) describe them. So this report does two jobs: (1) what breaks today, (2) holes in the proposals before anyone builds them.

## Counts
BLOCKER 5 (all known, "ask not met") / BUG 9 (7 NEW) / HARM 6 (4 NEW, 2 of them proposal-level) / SMOOTH 6 / IMPROVE 7.

## Scenario walk (22)

| # | Scenario | Result today | Evidence |
|---|---|---|---|
| 1 | One ingredient (lime juice) used in 40 recipes; click it, see all | FAILS: nothing to click. No good-to-recipe link exists | B-1 |
| 2 | Recipe containing a sub-recipe, then a loop (A uses B, B uses A) | Cannot happen today: no sub-recipe column. Proposal tests only self-inclusion | B-5, H-5 |
| 3 | Unit conversion oz / ml / cl in a recipe | None. `unit` is free text; no conversion, no cost | `cocktails.sql:60-72`; `beverages.dto.ts` unit `@MaxLength(30)` only |
| 4 | "1 1/2 oz gin", "3 mint leaves", "1 orange peel", "2 oz. gin" typed in the recipe box | FAILS: misparsed, see U-4 | probe table below |
| 5 | Zero-stock good | Page: row "Out". Summary API: "unknown" if par is also 0. See U-8 | `useInventoryNextData.ts:133-140` vs `common/stock-status.ts` |
| 6 | Negative stock | Cannot be stored: `apply_stock_movement` raises "stock would go negative" (`20261222100000_...sql:214`). But the sale that caused it is refused, see H-3 | |
| 7 | Deleted good still in a recipe | Today harmless (recipe lines are text). Under the proposal: undefined, see H-5 | `recipes/proposal.md` has no retire rule |
| 8 | Substitute brand (house gin changes) | No way except editing each recipe by hand. Proposal has no swap or "or equivalent" | I-4 |
| 9 | Garnish by count ("1 orange peel", "3 mint leaves") | FAILS: stored as quantity 1 unit "orange". Proposal fixes with "each" | U-4 |
| 10 | Batch cocktail (10 serves from a jug) | Not modelled (no yield/serve). Proposal: `yield_serves` | R-G14 known |
| 11 | Cost per pour after a price change | No cost per pour anywhere in recipes. In inventory, WAC blends old and new lots; proposal's "at today's prices" restates history | I-6 |
| 12 | 5,000 goods: does the list load? | FAILS twice: library join URL too long, then 1,000-row cap. See U-1, H-1 | |
| 13 | 5,000 goods: type in the search box | Slow by construction: each keystroke rewrites the URL and re-renders every row, no virtualisation. Not measured in a real browser | U-2 |
| 14 | Search "raki" / "cilek" / "istanbul" in the recipes list | FAILS for the recipe list; WORKS on the inventory list | U-5 vs S-1 |
| 15 | KPI that disagrees with the list | Dashboard/summary vs page differ for stock 0, par 0; also a failed lot read turns value into a smaller number with no error | U-8, H-2 |
| 16 | Empty nutrition data | Nothing exists to be empty. Proposal's S3 handles it well ("not known", never 0) | B-4 |
| 17 | Add a food (flour, 25 kg sack) | FAILS: API requires a wine library id | B-2 |
| 18 | Add a good with par 0 (garnish, no reorder) | FAILS: server turns 0 into 6 | U-3 |
| 19 | Save a recipe with one bad line | Whole recipe is erased, user told "Nothing was changed" | H-4 |
| 20 | Count 4.5 bottles of vodka | Recorded as 5 (rounded). Half-bottle precision lost | U-9 |
| 21 | Another house reads my recipes | Blocked: tenancy fixed in `20260818000000_beverage_security_fixes.sql:29-51`; writes check `cocktails.restaurant_id` (`beverages.service.ts:677-690`) | S-3 |
| 22 | Pour a 15 ml (0.5 oz) or 22 ml (0.75 oz) measure | Pour-size floor is 30 ml in the web (`volumeUtils.ts:9`) and 25 ml in the API (`inventory.dto.ts` pourSizeMl `@Min(25)`); 0.75 oz shows as 0.7 oz | I-3, U-7 |

## BLOCKER (the ask is not met; all known)
- **B-1 No "used in" for a good.** `RowDropdown.tsx` shows stock, pace, cost, paperwork only. Schema: `cocktail_ingredients.beverage_id` points at the global `beverages` table (no `restaurant_id`) and `wine_id` at the wine library, never at the house's `restaurant_inventory`. The recipe editor never sets either (`CocktailRegister.tsx:113-122` builds free text only). Repro: add "30 ml gin" to a Negroni, open the gin on /inventory: no link. Known I-G3/I-G4, R-G2/R-G5.
- **B-2 Only wine-keyed goods can be added.** `inventory.dto.ts:34-36` requires `wineId`; create and re-activate key on `master_wine_id` (`inventory.service.ts:957-962, 1051`). `mapInventoryItem` invents a 750 ml bottle and 150 ml pour for anything without a library row (`:87-88`). Repro: POST `/inventory/:rid/items` `{stockLive: 10}` with no `wineId`: 400. Known I-G1 (schema may already allow it; API and UI do not).
- **B-3 No KPI cards.** On hand, value, usage, days of cover, cost trend, waste, count gap: only some exist as row-level text; waste and count gap have no reader (I-G5, I-G6).
- **B-4 No nutrition or allergen data or UI** (I-G8). Recipes cannot roll up nutrition because no source exists.
- **B-5 A drink takes no stock and has no cost per serve.** Only wine depletes (`pos-hub.service.ts:1365`); `pos_item_mappings` holds one `inventory_id`; nothing sums a recipe. Known R-G1, R-G2, R-G30.

## BUG
- **U-1 NEW. The library join dies at about 420 goods.** `useInventoryNextData.ts:196-198` sends every wine id in one URL: `getWinesByIds` -> `GET /wines?ids=<uuid,uuid,...>` (`services/api/wines.ts:55-62`). At 37 characters per id, 420 ids is about 15.5 KB, over Node's 16 KB header limit once cookies/auth are added; 5,000 ids is about 185 KB. Server then does `.in("id", ids)` (`wines.service.ts:494-501`), which also lands in the PostgREST URL, and no `limit` is passed, so even a successful read stops at 1,000 rows. No chunking anywhere. Effect: names, vintage, grape and type go missing for most rows. Repro (unrun, arithmetic): a house with 500 wine-keyed items.
- **U-2 NEW. No virtualisation, no debounce.** `InventoryTable.tsx:164` maps every row to a `<tr>` with its own cells; each keystroke in search calls `setParams(..., {replace:true})` (`InventoryNext.tsx:182, 736`) and re-filters and re-renders all rows. Evidence is only the 35 s jsdom test for 1,001 rows (jsdom is slow, real numbers unmeasured). Expect visible lag at 5,000.
- **U-3 NEW. Par 0 becomes 6, max 0 becomes 24 on create.** `inventory.service.ts:1054-1055` `dto.thresholdMin || 6`. The page deliberately keeps "par 0 = no par" (`useInventoryNextData.ts:1-25`), but nothing can create one. Repro: POST item with `thresholdMin: 0`: row shows par 6.
- **U-4 Extends R-G24. The recipe-line regex misreads garnish and fractions.** Regex at `CocktailRegister.tsx:113`. Probe results: `1 1/2 oz gin` -> quantity 1, text "1/2 oz gin" (half ounce lost to any maths); `3 mint leaves` -> unit "mint", text "leaves"; `1 orange peel` -> unit "orange"; `2 fresh mint sprigs` -> unit "fresh"; `7 Up top` -> unit "Up"; `2 oz. gin` -> no unit, text "oz. gin"; `60ml (2oz) gin` -> text "(2oz) gin"; `1.000 ml tonic` -> quantity 1. `½ oz` and `1/2 oz` fall through to text with no quantity (known). The saved list still looks right on screen, so the person does not notice until something computes on it.
- **U-5 NEW. Recipe list search does not fold Turkish.** `CocktailRegister.tsx:236` uses `toLowerCase().includes`. Probe: "raki" misses "Rakı Sour", "cilek" misses "Çilek", "istanbul" misses "İstanbul Mule" (`İ` lowercases to `i` + U+0307). The inventory list got `fold` (`useInventoryNextData.ts:339-351`); this list did not.
- **U-6 NEW. A recipe line with a name-less link shows "—", and amending drops links.** `CocktailRegister.tsx:198` prints `free_text ?? —`. The editor round-trips only quantity, unit, free text (`:78-86`), then replaces the whole recipe (`beverages.service.ts:689-715`). Any line written with `beverageId`/`wineId` only (API, import, future picker) shows as a bare dash and is deleted on the next amend. Latent today (nothing writes links), live the day a picker lands unless C1 replaces this editor first.
- **U-7 NEW. oz display rounds a bar measure.** `mlToOz` rounds to 0.1 (`volumeUtils.ts:22`): 0.75 oz -> 22 ml -> shows 0.7 oz; 1.25 -> 1.3; 1.75 -> 1.8. Stored ml is fine, display lies by up to 0.05 oz.
- **U-8 NEW. Two surfaces disagree on stock 0 / par 0.** Page `standingOf` returns `out` when `stock <= 0` before looking at par (`useInventoryNextData.ts:135`). The shared fixture and the API say that case is `unknown`, "not critical" (`datasets/sim/fixtures/below-par-cases.json:93-97`; `stock-status.ts` classifyStock). So the page chip "Out N" counts a discontinued item the dashboard summary (`getInventorySummary`, `inventory.service.ts:1493-1560`) calls unreadable. Also `totalBottles` (`:1502`) sums `stock_live || 0`: null counts as 0, and kg and bottles would add together once non-wine goods exist.
- **U-9 Extends I-G22. A count rounds to whole units.** `Math.round(Number(dto.countedQty))` (`inventory.service.ts:563, 592`): 4.5 -> 5, 0.4 -> 0, and a nearly empty bottle reads "out". The proposal's tenths bar fixes it for drinks.
- Small, NEW: **empty or blank `freeText` is accepted.** `free_text: l.freeText?.trim() ?? null` (`beverages.service.ts:706`) turns "   " into "" which passes the CHECK (`cocktail_ingredients_has_a_referent`, not-null only). Via API, a blank ingredient line is stored.

## HARM
- **H-1 NEW. Silent truncation at 1,000 goods, and the footer says "All N of N listed".** `getRestaurantInventory` (`inventory.service.ts:254-272`) and `database.service.ts:42-53` make one unpaged read; `supabase/config.toml:18` `max_rows = 1000`. The three side reads (`:178-252`) are unpaged too, and a house with 3 locations per good hits the cap on `inventory_location_breakdown` at about 333 goods, so zone names would vanish first. Nothing flags a cap. A bar manager with 1,400 goods would see 1,000 and a total value smaller than reality, and be told the list is complete.
- **H-2 Known I-G15 (confirmed here). A failed lot or location read looks like "no cost / none on hand".** `fetchLotRollup`/`fetchLocationBreakdown` destructure `{data}` only (`:184, :204`); `openMl: rollup?.open_ml ?? 0` (`:163`), `locations ?? []` (`:173`) so `zones` is `[]`, not `null`, and the web header comment's promise ("a failed zone read is not rendered as empty") does not hold. Value, WAC and open-bottle ml drop with no message.
- **H-3 NEW (code-read, unverified in DB). A sale at zero stock is refused and, as far as the code shows, never replayed.** `apply_stock_movement` raises on negative (`20261222100000_...sql:214`); `pos-hub.service.ts:1498-1506` counts it `tally.failed` and notes the failure. I found no retry or queue for that cause (`insufficient`/`go negative` appear in no handler). Real bar case: bottle poured before the delivery was receipted; later the receipt adds stock and the earlier pour is never booked, so the system overstates stock by that pour. Reported, not hidden, but not repaired.
- **H-4 Known R-G7 (concrete repro). Saving a recipe can erase it.** Delete at `beverages.service.ts:689-693`, insert at `:699-715`, two calls. Repro: PUT lines with one valid UUID `beverageId` that is not in `beverages` -> FK error after the delete -> `guard()` returns 500 -> the web prints "Nothing was changed" (`CocktailRegister.tsx:131`) but the old recipe is gone.
- **H-5 NEW (proposal). Retiring a good has no rule.** `recipes/proposal.md` says an unlinked "kept on the shelf" line makes the whole sale line wait (A8). Nothing stops `softDeleteItem` (`inventory.service.ts:2045-2110`) on a good used by 40 recipes. Result: 40 drinks stop depleting their other spirits until someone relinks. The Used-in list (I11) is the natural place to refuse or warn, and the proposal does not use it for that. Related, `recipes/proposal.md:77` and C5 test only "a prep that includes itself"; an A->B->A loop made by saving B's new version is not covered.
- **H-6 NEW (proposal). Used-in lookup may leak recipes across houses.** I11 reads `cocktail_ingredients` "on the item's `beverage_id`/`master_wine_id`". `beverages` is a global catalogue and `cocktail_ingredients` has no `restaurant_id` (`cocktails.sql:60-72`), so the query must join `cocktails.restaurant_id = house` AND `cocktails.deleted_at IS NULL`. The proposal does not say so; today's reads do (`beverages.service.ts:677-690`) but a new service might copy the item-side join instead. Also 55 demo cocktails have `restaurant_id NULL`. Add a cross-tenant spec to I11.
- Known and confirmed, no new repro needed: `?? 750` / `?? 150` invented sizes (`:87-88`, I-G1/R-G13), partial-volume void returns whole bottles (R-G11).
- NEW minor (API only): `reactivate` writes `stock_live: 0` directly (`inventory.service.ts:970`) while `trg_project_stock_from_lots` (baseline `:12188`) re-projects from lots on the next lot change. If lots were not emptied first, old bottles reappear on the next receipt. The web Remove flow zeroes first, so this needs an API caller.

## SMOOTH (checked, holds)
- **S-1** Inventory search folds `İ ı ş ç ğ ö ü é ß œ æ` and mixes case (`fold`, `useInventoryNextData.ts:339-351`). Probe: Rakı/raki, IĞDIR/igdir, Şişe/sise, Kavaklıdere/KAVAKLIDERE all match. Not folded: `ł ø đ ﬁ` (IMPROVE).
- **S-2** Unknown is not zero on the client: absent stock/par stay `null` and render a dash; par 0 means "no par", not 10 (`toRow`, `standingOf`).
- **S-3** Tenancy: recipe reads and writes look the cocktail up by house first (`beverages.service.ts:677-690`); the cross-tenant read policy was closed in `20260818000000_beverage_security_fixes.sql`; stock writes call `assertInventoryBelongsToRestaurant` before the RPC.
- **S-4** Stock cannot go negative in the ledger, and the refusal is surfaced in the POS import report, not swallowed.
- **S-5** Spot counts are idempotent (`count:{inventoryId}:{clientCountId}`), attributed from the JWT, and a count with no change still stamps `last_counted_at`.
- **S-6** Unit tests are solid where they exist: 1083 API and 419 web tests pass; `classifyStock` and the web copy share one fixture so they cannot drift silently.

## IMPROVE
- **I-1** Recipe editor: one "swap ingredient in all recipes" action for a brand change (scenario 8); the proposal's append-only versions would otherwise create 40 versions for one swap.
- **I-2** Used-in list needs a count, a sort and a cap ("lime juice: 120 drinks") and should hide retired cocktails by default.
- **I-3** Pour floor: web 30 ml, API 25 ml, bar measures 15 and 22 ml. One floor, 10 ml or lower, and the same number in both places.
- **I-4** Proposal: give a recipe line an optional "or equivalent" (house pour well) so a brand change is one edit.
- **I-5** Proposal: say which cost a serve uses. "At today's prices" restates margin history on every delivery; stamp the cost at sale (cost-math contract) and show both.
- **I-6** Fold `ł ø đ` and ligatures; sort with `localeCompare(…, 'tr')` for Turkish houses (`useInventoryNextData.ts:290, 320` use the browser default).
- **I-7** Systemic, outside this software: 56 migration files on main are dated after today (latest `20270301...`), so a migration stamped with the real date sorts before applied ones.

## What I could not check
Anything needing a database (trigger behaviour in H-3 and the reactivation note, real PostgREST row cap on the hosted project, view results); real-browser render time for 1,000 and 5,000 rows; any screen with real data; the unbuilt features themselves (only the proposals).
