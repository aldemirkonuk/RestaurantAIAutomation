# g2 till-recipe build, 2026-11-19

PR: #1914 (DRAFT), branch feat/g2-till-recipe-mapping, head 9a1a4cfa8, stacked on #1909 (feat/g1-inv-recipe-draw-wired-to-toast).

## Gap check at the owner tip (7310a873c)
- (a) Real. cocktail_id is written by upsertItemMapping, but no web code sends it (no cocktail_id in apps/web outside the cellar register); no dish link exists.
- (b) Real. GET /pos-hub/check-margin has no web caller; priceNotSent / costNotKept are import-time tallies that no screen reads.

## Built
- Gateway: POST mappings/:r/till-recipe (setTillRecipe), GET checks/:r, GET checks/:r/:checkId (listRecentChecks, getCheckView), till-check-view.ts.
- Web: TillRecipeMap.tsx and CheckMarginSection.tsx mounted in PosMappingPanel; posHub.ts client functions.

## Tests
- jest src/pos-hub: 24 suites / 518 pass. New spec pos-hub.till-recipe.spec.ts (15).
- vitest src/components/inventory + src/pages/inventory: 31 files / 490 pass. New: TillRecipeMap (10), CheckMarginSection (5).
- tsc gateway (TS2307 simplewebauthn ignored) and web clean; vite build ok.
- Mutation (committed first, then reverted): shelf-replace guard, comped-line count, inventory clear on link, replace flag, confirm step, price-not-sent null branch, failed check list, failed recipe search. One survivor (failed search swallowed) was caught by a sharper test, re-mutated, killed.

## Left (not done)
- Dish -> button link: the dishes table lives only in the #1907 stack (migration 20270803100000), not in the #1909 chain; no dish sale draw exists. Needs: dish_id column + check constraint, a food-recipe draw writer, then the picker's second tab.
- Check margin excludes drink-recipe lines (recipe_draws keeps no cost at sale). Needs a cost snapshot on recipe draws.
- "Price not sent" on a check counts stored lines with no price and no comp; the import tally's once-per-check count is unchanged.

## Browser checks owed (local stack not used)
See PR #1914 body, six checks (list, search+save, shelf-move ask, take off, failed read wording, check margin + 375px).
