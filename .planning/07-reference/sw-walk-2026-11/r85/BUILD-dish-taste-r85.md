# BUILD dish-taste (2026-11-19, r85)

## Branches
- Meet (no PR): `resolve/r85-dish-taste-meet` 847b1014a = #1955 tip a65e6d4eb + plain merge of #1931 head cb79b5856 (carries #1915 daf6914df, #1222-#1224). Confirmed with `gh pr view`: #1931 base = #1915's branch, #1915 base = g1-menu-takes-all-prices.
- PR (DRAFT, base = the meet): `fix/r85-dish-sheet-taste` 8a273137a. Diff vs meet 4,040 chars.

## Real conflicts in the meet
1. `RecipeSheet.tsx`: r84 added RecipeTasteLine above DrinkCards; the dishes stack added `draftCost` to DrinkCards. Kept both.
2. `RecipeSheet.test.tsx` beforeEach: kept both mock resets (taste/roll and h.post).
3. `scripts/sql_outside_migrations.txt`: union of the two test lists (file was already unsorted).

## Finding
The dish sheet is NOT a separate component: `RecipeSheet` serves both owners (`{ dishId }` vs `{ cocktailId }`, `owner.kind`). r84 mounted the taste line and card with `kind="cocktail"` hard-wired, so on a dish they would have read and worked out a COCKTAIL with the dish's id (a 404/absent, or a wrong taste if ids ever met). Fix: `kind={owner.kind}` in both mounts. RecipeTaste, TasteCard and the client were already kind-generic.

## Roll-up reads dish lines: already true, no gateway change
`TasteService.rollupSubject` (taste.service.ts) reads `recipe_current_dish` by `dish_id`, then `recipe_versions`, `recipe_lines` (a dish line is a recipe_lines row, 20270803100000_a_dish_has_a_recipe.sql:22). Existing taste-recipe.spec "reads grams and milligram lines" covers kind dish. Mutant: `recipe_current_dish` -> `recipe_current`: KILLED (1 failed of 19).

## Decisions (no founder asked)
- D1 No new migration for `taste_profiles.dish_id` FK to `dishes` (the migration comment says the dishes stack adds it). Reason: a schema change cannot be proven here (no isolated DB; the only running stack belongs to another agent and I must not touch it), and nothing reads wrongly without it (assertSubject already refuses a dish not in this house). Rejected: write the FK unproven. Left as NOT DONE below.
- D2 Same words on the dish sheet as the cocktail's ("How it tastes", Work it out / Read again, read-only card). Rejected: dish-specific copy (nothing in it says drink).

## Tests
- web vitest `src/pages/cellar src/pages/inventory src/services/api`: 88 files, 1511 tests pass. `tsc --noEmit -p apps/web`: exit 0.
- gateway jest `src/taste src/recipes`: 30 suites, 452 pass; `tsc --noEmit -p tsconfig.json`: nothing but ignored TS2307.
- New: RecipeSheet.test.tsx "how it tastes on a dish sheet" (reads 'dish', never 'cocktail'; Work it out posts rollup for 'dish'; card shows the result; line present).
- Mutants (committed first, restored): line kind -> "cocktail" KILLED; card kind -> "cocktail" KILLED; gateway dish table -> recipe_current KILLED.

## NOT DONE
- `taste_profiles.dish_id` foreign key to `dishes` (D1).
- Browser check not run (brief). Owed: open a dish with a saved recipe, taste line on top, Work it out then Read again; a dish with no recipe shows the "Save a recipe" note; phone 375 taps; light/dark; a dish id that is also never a cocktail id shows no cross-read.
- CI, repo guards (claims, migrations) not run on these branches.
- Unlisted since r84: RecipeNutrition still unmounted on the cocktail page (founder call).
- Merge order: #1947 chain, #1141 chain, #1942 chain, #1954/#1955, the dishes stack (#1222-#1224, #1915, #1931) to main first; then retarget this PR. The meet is never merged.
