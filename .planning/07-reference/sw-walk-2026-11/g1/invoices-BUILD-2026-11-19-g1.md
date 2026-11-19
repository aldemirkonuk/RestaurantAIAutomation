# g1 invoices build, 2026-11-19: recipe draw slice 4 (a cocktail sale draws its recipe)

Gap verified real at the newest owner tip (`origin/fix/r57-ts-c-void-of-a-pour-returns-ml`, #1820): `pos-hub.service.ts` had no call to `record_recipe_draw`/`reverse_recipe_draw`; `recipe_current` is only on #863 (open, in neither main nor the r57 branch).

## PRs (all DRAFT)
- #1908 `feat/g1-inv-recipe-draw-wired-to-sales` (head f5e2d04a0), base #1820 branch: generic hub. recipe-sale.ts + pos-hub.service.ts wiring + 15-case spec. 29.6K diff.
- #1909 `feat/g1-inv-recipe-draw-wired-to-toast` (head 7310a873c), base #1908: Toast door, same branch, key `toast_sale_<order>_<item>` for sale and void. 9.7K diff.
Split because one PR was 40K (over the 30K wall).

## Tests
- jest src/pos-hub: 23 suites / 503 passed. jest src/toast: 4 suites / 79 passed. tsc clean (TS2307 simplewebauthn ignored). check_stock_wrappers_check_ownership.py PASS.
- Mutation: 5 on the hub branch, 3 on Toast, each fails its named case.
- PGlite e2e (probe/e2e.mjs, 308 migrations incl. #863 merged onto the r57 tip in wt/g1-inv-recipe-slice4): 9/9 pass; short-as-booked mutation fails E8. Needs a worktree with #863 merged to rerun (MIG_DIR in pgbuild.mjs).

## Left (not done)
1. DISHES: not built. FORK: `pos_item_mappings.cocktail_id` is drinks only and recipe_versions has no dish owner until `feat/a-dish-has-a-recipe-schema` (a branch, not an open PR) lands. Founder call: dishes reuse cocktail_id vs a dish_id column.
2. Blocked on #863 landing (and #1421/#1478/#1480/#1483 content is already inside the #1820 base). Until then recipe-mapped lines fail safe (queue, nothing moved).
3. Consumption mirror (recordConsumption: sales velocity/revenue rows) is not written for recipe lines; only stock moves. Cocktail revenue per drink in analytics is unchanged.
4. Fractional quantities of a recipe line (0.5 serves) queue as bad_quantity; not rounded.
5. A recipe line's `comped` flag is not special-cased: a comped drink still draws stock (correct) but books no consumption row (see 3).
6. Queue reasons reuse the two the table allows (unmapped, no_sale_volume); no new reason/migration. Reviewer sees the specific reason in raw.unresolved_detail.
7. Simpos: goes through the generic hub (covered by #1908); no separate Simpos code exists.

## Process note
A second agent worked the same brief in wt/g1-recipe-draw4 (branch feat/a-mapped-cocktail-sale-draws-its-recipe, not pushed when I checked) and overwrote one of my files mid-build; I moved to my own worktrees. If it later opens a PR it duplicates #1908/#1909. Also: I created and removed one stray worktree inside the main checkout by a mistyped `git worktree add`; main checkout tracked state untouched.

## Browser checks owed (after #863 + #1908/#1909 on a local stack)
Map a button to a cocktail with a saved linked recipe; close a check with 2: each good drops 60 ml; re-post: unchanged; void: returned; unlink one line: appears in unresolved review with reason. Toast: order.closed drops, order.voided returns, double close no second drop.
