# Round 14 - recipes <-> goods: PR #863 (1/3) and PR #864 (2/3)

Tested 2026-11-07 at stack head `6dc34721` (detached worktree `/private/tmp/claude-501/qa-wt-r14-recipes`, node_modules symlinked, removed afterwards). SQL built from all 300 migrations in PGlite (PG 18, not a Supabase stack; concurrency is not truly testable there). Probes: `round14-probes-recipes/` (`r14-recipe-cost-probe.spec.ts`, `sql-probe.sql`, `sql-run.mjs` with mutations, `sql-run2.mjs`, `sql-probe-results.txt`, `mutations.txt`). Coverage was not asked for or measured.

## Verdicts

| PR | Verdict | One line |
|---|---|---|
| #863 migration (recipe_versions / recipe_lines / recipe_current / save_recipe_version) | **WORKS** (for what it claims: data model + one write path) | Repo pgtest passes; versioning, units, tenant and append-only hold; 3 small edge gaps below. |
| #864 `recipeCost` + DTO + ADR 0360 | **PARTIAL** | The pure cost function is correct on the happy path and honest about unknowns, but it is a lone function: no caller, no route, no sale link, no margin, 2-decimal rounding, and 4 ADR claims name code that is not in this PR. |

Neither PR gives the founder's ask. Nothing in the stack lets a bar manager enter a cocktail, see its cost, or sell it and see stock fall.

## #863 - what I ran and saw

Repo SQL test `supabase/tests/20270406100000_..._test.sql`: PASSED on the stack head.

Does the test fail without the code? Mutations to the migration (each rebuilt in PGlite, repo test rerun):
- append-only trigger on recipe_lines removed: FAILS ("an UPDATE on recipe_lines raises"). Good.
- stale-version check removed: FAILS. Good.
- house-item ownership check removed: FAILS. Good.
- drink-belongs-to-house check removed: FAILS. Good.
- oz factor changed 295.735 -> 300: FAILS ("1.5 oz stores 444"). Good.
- **`FOR NO KEY UPDATE` lock removed: test still PASSES.** The concurrency guarantee (migration lines ~100-104, "Locking the drink serialises saves") has no test. The code reads correct (lock, then compare expected version, then max+1), but nothing proves it; two sessions are needed.

Bar-manager scenarios (probe `sql-probe.sql`):
- Conversions stored (qty_base): 60 ml = 600 ml10; 2 cl = 200; 1 oz = 296 (29.6 ml vs 29.5735, 0.09% high, tenth-of-ml resolution); 1 tsp = 50; 0.001 l = 10; 5 g = 5000 mg; 0.005 kg = 5000 mg; 0.5 each = 500 and 2 each = 2000 each_milli. Same item on several lines is allowed. WORKS.
- Garnish by count: stored as `each_milli`; an `untracked` garnish is text only. WORKS.
- Edit creates version N+1: second save returned version 2, current moved to it, version 1 still has all 9 lines. Stale second editor on v1: refused RCP09 with a sentence, nothing written. WORKS.
- Tenant: house 2 saving house 1's drink refused (RCP00); linking another house's item refused (repo test); soft-deleted drink refused; hard delete of a cocktail or an item that a recipe line uses is refused (23001). Clients hold no grant. WORKS.
- Turkish names: "Seker surubu" with Turkish letters (Ş, ş, İ, ğ) stored and returned intact. WORKS.
- Perf: 500 saves of 6-line recipes in 368 ms in PGlite; read of all current lines of a house (3000 rows) 1.0 ms; "used in" by item 1.0 ms. The index `recipe_lines_inventory_idx` exists. **There is no list/read endpoint or view in #863/#864 to measure "500 recipes list speed" on a real route** (F4: no recipe view). Only the raw join was timed.
- Sub-recipe / batch: only `owner_kind = 'cocktail'`; no line can point at another recipe (no column), so a sub-recipe or a cycle cannot even be expressed. Batch cocktail is expressible only as `yield_serves` (a 10-serve batch of 750 ml gin costs 2.36 per serve in the cost fn). Deferred by ADR ("preps and batches"). Not a defect, a gap.

Edge defects in the migration (all small):
1. **Huge quantity gives a raw 500-type error**: qty 1e30 ml returns SQLSTATE 22003 "bigint out of range", not the RCP00 sentence. DTO `qty` has `@IsNumber` with no `@Max`, so the gateway will not catch it either. (`sql-probe.sql` A5.)
2. **Whitespace-only label passes**: a label of U+00A0 is stored (btrim does not strip NBSP). Label length is capped only in the DTO (200); the DB accepted a 5000-char label. (A2, A3.)
3. **Unit family is not checked at save**: a 30 ml line linked to a kg item (sugar) is accepted; the cost will later say `size_not_known` for it. (B4.) Also `yield_serves` has no upper bound (1,000,000 accepted) and the DTO has no `@Max` (int overflow possible through the API).
4. `recipe_lines.restaurant_id` is not tied to its version's house by FK: a direct service_role insert with another house's id was accepted (B6). Only the RPC keeps them equal. Low risk (service_role only).
5. Linked items later deactivated stay in the current recipe; nothing flags it (the cost fn also ignores `is_active`, see below).

## #864 - what I ran and saw

Repo spec `recipe-cost.spec.ts`: 9/9 pass. Without the code the spec cannot run (the file is the code); I also checked it is not vacuous: it pins Negroni = 57.00, 2 of 3, not_linked, yield 2, `size_not_known` for an `each` item and for a case, weight and count lines. It does not pin a lot WAC of 0, partial WAC, rounding, or an unknown unit string.

Bar-manager costing through `recipeCost` (`r14-recipe-cost-probe.spec.ts`):
- Cocktail 60 ml gin (700 ml bottle, 22 per bottle = 264/12) + 20 ml lime (0.01/ml) + 15 ml syrup (1 L bottle at 8): lines 1.89 + 0.20 + 0.12, total **2.21** (exact 2.2057). 3 of 3, basis `invoice_lot_wac`. WORKS.
- **The same gin held as a `case` item at 264: total null, `size_not_known`.** This is the "264/12 case". ADR 0360 item 7 states it on purpose (no column records bottles per case; I confirmed `restaurant_inventory` has none, `pack_size` lives only on receipt lines). Honest, but it means any house that keeps spirits as case items gets no cost at all. A drink with one case-held ingredient has no total.
- Per-gram food: item priced per gram 0.035, 5 g = 0.18 (0.175 rounded). BUT `inventory_lots.unit_cost` is `numeric(10,2)` (baseline migration line 3180) and `restaurant_inventory.last_purchase_price` is `numeric(10,2)` (line 3280), so 0.035 per g is stored as 0.04 and the cost comes out 0.20 (+14%). Per-kg pricing (35/kg) gives the right 0.18. The cost function is right; the stored price cannot hold sub-cent per-unit prices. Not in this PR's scope, but it makes "per-gram food" wrong in the real data.
- Conversions in the cost fn: l, ml, kg, g, mg, each correct. A `glass`, `shot` or `pack` item, and a weight line on a bottle item, give `size_not_known`.
- Garnish by count: 2 each at 0.30 = 0.60. OK.
- Price states: no price -> null `unknown`, total null (good). **WAC of exactly 0 with an invoice flag -> cost 0.00 and the recipe counts as complete** (a free gin; defended in inventory-cost.ts as a measurement). `last_purchase_price` 0 -> unknown. Last price with no lot -> used (basis `last_purchase_price`). **A WAC covering 1 of 10 bottles still counts as "priced" and `complete` is true**; only the line's basis string says `_partial`, the recipe-level flag does not.
- Archived item and mixed currency: **the function ignores both.** An inactive/soft-deleted item is priced as normal; a lot in EUR is added as if it were the house currency. There is no currency field on lots or items at all (grep), so mixed currency is not detectable. Not caught here.
- **Rounding is 2 decimals, not 6.** Each line is rounded to 2 dp and the total is rounded separately from the unrounded sum, so lines can disagree with the total: three lines each costing 0.004 show 0.00, 0.00, 0.00 and a total of 0.01. Sub-cent ingredients (a dash of bitters, 0.7 ml) show as 0.02 or 0.00 and, at 1e-7 per g, as a priced 0.00. The ADR asks for no precision; the brief for this test expected 6 dp. A batch of 10 serves is fine at 2 dp, a 1 ml bitters is not.
- `yield_serves` non-integer (2.5) gives `unknown` basis, which is a misleading label (it should say invalid yield); the DB makes it an integer so this is unreachable through the RPC.
- Margin vs menu price: **not present.** `recipe-cost.ts` exports only `costPerBaseUnit` and `recipeCost`. ADR item 8 says no pour-cost percentage until a tax basis exists (#784). No menu-price join anywhere.
- 500 recipes: 500 x 6 lines of pure costing took 5 ms. There is no list route to time.

### ADR 0360 against the code at the stack head

| ADR claim | In code at #864 head? |
|---|---|
| Item 7: cost from `resolveUnitCost`, per base unit, bottle/keg by `bottle_size_ml`, case/pack = `size_not_known` | Yes: `recipe-cost.ts` (`costPerBaseUnit`, `CONTAINERS`), and spec line "does not price a case per bottle". |
| Item 7: total only when every stocked line is linked and priced, else "2 of 3" | Yes: `recipeCost`, `priced/of/complete`. |
| Item 3 units, item 4 append-only/409, item 11 one write path, item 12 grants, item 5 yield | Yes, in #863 (SQL), proven by its pgtest. The 409 mapping (RCP09 -> HTTP) is not in either PR. |
| Item 9: owner/manager writes (`RolesGuard`), `seesHouseAmounts` hides price and cost, gateway never reads lot cost for that role | **No.** Not in #863/#864. It exists only on the unmerged branch `origin/feat/recipe-engine-gateway` (commit `784071301`, no PR yet). |
| Item 13: GET returns `legacyLines` from `cocktail_ingredients` | **No**, same branch only. |
| Item 7: "computed on read" | No reader exists in this stack. |
| ADR 0020: a failed read says it failed (503 with a sentence) | No route in this stack. |
| Claims file `ADR-0360-RECIPE-LINES-EXIST` | Passes, but it only greps for the string `recipe_lines` in migrations; it checks none of the behaviours (case = unknown, 409, role gating). Weak guard. |
| Migration version `20270406100000` / ADR number 0360 | No collision with main or open PRs (checked). #845's migration is `20270410100700`, later, so order is fine. |

So #864's title promises "cost a serve from today's prices" and ADR 0360 describes a full feature, while the diff delivers only the arithmetic. The ADR states an end state; the PR does not have it. Mark it Proposed -> it is, but its "Decision" prose reads as built.

### Which price is used, and does it disagree with #845 (sale carries its cost)?

- Recipe cost (ADR 0360 item 7): today's lot WAC from `inventory_lot_rollup` (average of all live lots that have a cost), falling back to `last_purchase_price`. The reader is not wired, so this is design only.
- #845 stamps each sale draw with the unit_cost of the specific lot(s) FIFO took, at the moment of the sale (`inventory_lot_draws.unit_cost`, `v_take * v_lot.unit_cost`).
- They disagree by design, in two ways: (a) average of all live lots vs the oldest lot, so if the old lot cost 20 and the new one 24, the recipe shows 22 while the sale was stamped 20; (b) the recipe ignores the version stamp on the sale side - **nothing in #845 or #863 records which recipe version a sale used**, so "old sales keep the old version" is not provable: there is no sale-to-recipe-version link yet (C5: no function other than `save_recipe_version` touches the recipe tables).
- The ADR does not mention #845 or say which basis margin reporting should use. Needs one sentence in the ADR: "the recipe card shows replacement-ish cost (WAC); the sale ledger shows actual cost (lot stamp); reports must not mix them".

## What is still missing

From the 3-part series: part 3 (gateway routes: `recipes.controller/service/module`, role gating, legacy lines, route-access entries) is on `origin/feat/recipe-engine-gateway` without a PR, and I did not test it. Missing outright: any UI sheet (the ADR says "lane 2"), sub-recipes/preps/batches and cycle protection, dish/food recipes (owner_kind is cocktail only), a list endpoint, margin vs menu price, a currency model, a way to give a case item a bottles-per-case count, 6-dp or per-line-consistent rounding, a test for the save lock, and a decision on WAC vs lot stamp.

From the founder's ask (recipes <-> goods, depletion on sale for drinks and food): the depletion on sale is entirely absent. No till-to-recipe map (ADR "Not in this record"), no function reads `recipe_lines` to take stock (C5), the POS still skips non-wine lines (round 7 seams B2), food has no recipes at all, and sale-to-version stamping does not exist. The goods side is there (a line points at `restaurant_inventory.id`), the sale side is not. Also note the `numeric(10,2)` price columns make per-gram costing coarse regardless of this series.

## Counts

PRs tested 2 (#863, #864; branch for 3/3 only inspected). Verdicts: 1 WORKS, 1 PARTIAL, 0 BROKEN. Repo tests re-run: 1 SQL (pass), 9 jest (pass). Mutations: 6 on the migration (5 caught, 1 not caught: the save lock). Probes executed: 10 jest probe groups (about 25 observations) + 31 SQL observations. Defects/gaps found: 5 migration edge gaps, 7 cost-function gaps (case = unknown, 2-dp rounding, zero WAC complete, partial WAC complete, archived ignored, currency ignored, per-gram precision lost upstream), 4 ADR claims without code in this stack, 1 ADR-vs-#845 price disagreement unaddressed. Not done: real Supabase stack, true concurrent sessions, any route/UI, branch `feat/recipe-engine-gateway`.
