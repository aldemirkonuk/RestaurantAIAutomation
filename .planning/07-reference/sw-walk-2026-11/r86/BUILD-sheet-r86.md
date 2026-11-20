# r86 sheet-fix: recipe sheet taste, r85 findings 1, 2, 3, 5 (2026-11-19)

Branch fix/r86-recipe-sheet-fix, stacked DRAFT PR #1957 on #1955 (fix/r84-recipe-sheet-taste). Commit a4afacdff (originally on #1955) re-applied as 3 files of lib + sheet + card. Merged up (plain merges) into resolve/r85-dish-taste-meet (1ee923416) and #1956 (fix/r85-dish-sheet-taste 09fb78d86).

Why stacked: the fix took #1955's diff from 27,139 to 38,629 chars (> 30,000). #1955 got a plain revert commit (tree back to 6e8c7ed2e, 27,139); #1957 re-applies it (diff 19,907).

## What changed
1. RecipeSheet banner (and the first-read "unread, not absent" line): when the read got no answer, "Mudavym could not be reached just now. The recipe could not be read again. What is shown is the last read." useRecipe exposes `unreachable`. lib/unreachable.ts copied byte-identical from #1946 (origin/fix/r82-unreachable-in-words-helper); its test file NOT copied (it needs #1946's client.ts change). Dedupe: when #1946 lands the file is identical, so the merge is clean; useRecipe.reason() and the version-list lines (RecipeSheet "This version/earlier versions could not be read (reason)") still print the raw reason and are NOT fixed here.
2. CLS: RecipeTasteLine renders a 30px aria-hidden placeholder and the RecipeTaste section holds min-height 450px while the read is in flight (q.isLoading); both are released when the read settles. Test pins the reserved heights and the release. NOT measured in a browser (brief: no stack/browser). 450px is the walk's figure for a worked-out card. A drink with nothing to show gives the space back at settle, which can still shift once (one line at the top for a not-worked-out drink): accepted.
3. Staff: RecipeTaste calls useCanEditRecipe (owner/manager); staff get no Work it out / Read again. Words for staff: "Not worked out yet. A manager works it out from the saved recipe." and "No recipe yet, so there is nothing to work a taste out from." (so they are not told to save a recipe they cannot).
5. TasteCard Footer: when the only layer is source 'recipe', the "Worked out from the recipe, 2 min ago, 1 source." footer line is dropped; the layer list says it once. A recipe layer beside a person's layer keeps the footer.

## Decisions (taken, no founder ask)
- D-A staff read-only. Rationale: the recipe PUT is owner/manager only and the sheet is read-only for staff; the roll-up writes a recipe layer, so it belongs with who writes the recipe. Rejected: keep "roles gate money, not palates" (BUILD D2): leaves a write action on a read-only sheet; hide at the gateway: wider change, not asked.
- D-B reserve height by a fixed min-height while loading. Rejected: always-reserved hole (blank space for undescribed drinks); measuring the card (needs a browser); CSS contain/aspect tricks.
- D-C unreachable helper copied locally, identical to #1946. Rejected: waiting for #1946; a different local helper (add/add conflict later).
- D-D one-layer recipe drops the footer, not the list row (the row carries the age). Rejected: dropping the list (the list is the only place a note shows).

## Proof
- vitest src/pages/inventory src/pages/cellar src/services/api src/lib on #1957: 121 files, 2043 passed; tsc --noEmit -p apps/web clean. Meet: src/pages/cellar inventory recipes services/api 88 files 1519 passed, tsc clean. #1956 tip: 137 passed + 1 failed, src/lib/seo/crawl-surface.test.ts (vercel.json vs App.tsx routes), failing identically at the #1956 tip before my merge (8a273137a): pre-existing, not mine.
- Mutations (revert one, run src/pages/cellar/next/recipe + TasteCard): useRecipe unreachable=false -> 2 fail; drop section minHeight -> 1 fail; drop line minHeight -> 1 fail; canWrite=true -> 3 fail; recipeOnly=false -> 1 fail. All restored.
- Gateway untouched: no gateway tsc/jest run.
