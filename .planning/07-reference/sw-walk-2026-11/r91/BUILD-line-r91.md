# r91 taste-line (2026-11-19)

PR: https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/1962 (DRAFT, base fix/r90-cocktails-paint-loaded-layout = #1961), head 017a7ebbf, diff 15,948 chars. Not folded into #1961: #1961 alone is 19,285 and +this = 33,669 > 30K, so a stacked PR.

## Decision (recorded)
The recipe sheet's top taste line always keeps its one line once the sheet opens (never collapses):
- pending -> placeholder of the same height (TASTE_LINE_RESERVE_PX);
- a sentence -> the sentence (unchanged);
- no taste yet -> "No taste worked out yet." (min-height held), plus for owner/manager a "Work it out" link running the roll-up (same call as the card, one shared hook `useWorkOut`); staff see the words only.
Two edges the brief did not name, chosen to match the card: taste notes off ('absent') -> words only, no link (cannot be worked out); sheet with no saved recipe -> words only, no link (`hasRecipe` prop, default true; RecipeSheet passes it). A failed roll-up says why on the line. Failed read: unchanged (failed line).

## Measured (1440x900 / 375x812, r90 harness cls90.cjs, local prod build, 3 runs)
| case | before (#1961) | after |
|---|---|---|
| 1440 owner ?open | 0.0601-0.0640 | 0.0086-0.0172 |
| 1440 staff ?open | 0.0659-0.0666 | 0.0171-0.0187 (one run 0.0535, not reproduced in a second pass) |
| 1440 /cocktails | 0.008 | 0.0081-0.0162 |
| 375 all | 0.0000 | 0.0000 |
Remaining ?open sources: header/counter 0.0046, spine NAV 0.0027, counter 0.0009, recipe head/lines landing 0.009.

## Proof
`vitest run src/pages/cellar/next` 22 files / 475 tests pass; `tsc --noEmit -p tsconfig.json` clean. 12 new/changed specs in RecipeTaste.test.tsx (pending, sentence, none x manager/owner/staff, no-recipe, failed roll-up, absent). Mutations: null line (10 fail), no min-height (1), link for staff (1), link without recipe (1; first run passed all, spec added, then failed).

## Not done
- Staff 0.0535 outlier run not root-caused (3 later runs 0.017-0.019; the recipe head/lines 0.009 shift is the nearest candidate).
- Dishes page not measured/changed (no dishes in this chain).
- Remaining sources above untouched.
- Stack torn down; vite previews killed with a broad pkill.
