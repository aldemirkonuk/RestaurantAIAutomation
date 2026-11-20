# BUILD recipe-taste (2026-11-19, r84)

Founder ask: dishes and cocktails show their taste profile. Roll-up (#1941 pure, #1942 endpoints) and TasteCard (#1925 chain) existed; nothing put them on the recipe sheet because the two stacks share no base.

## Branches / PRs (all DRAFT)
- Meet (no PR): `resolve/r84-recipe-taste-meet` e3f1103eb = #1947 tip 6a36ee8d3 + plain merge of #1141 head 01d54c01f + plain merge of #1942 head f77332e86 + one test fix.
- A: `fix/r84-taste-client` (base = the meet): client `rollupTaste`, TasteCard `subject/describe/emptyWords` props. 10,007 chars.
- B: `fix/r84-recipe-sheet-taste` (base = A's branch; merge of A in): RecipeTaste (summary line + card + Work it out / Read again), mounted on the cocktail RecipeSheet, scoped CSS. 23,418 chars vs A. (Single PR vs the meet was 33,425, over 30K, so two stacked.)

## Real conflicts in the meet
1. `CocktailRegister.tsx` (#1947 chain edits main's inline `Recipe`: export + RecipeNutrition mount; #1141 chain replaced it with `RecipeSheet`). Took RecipeSheet; dropped the unused RecipeNutrition import. `RecipeNutrition.test.tsx` lost its "mounts on the register" case (the component it mounted is gone; the sheet has its own nutrition card #1141). RecipeNutrition component itself is now unmounted on the cocktail page: a follow-up call (delete it or mount it) is the founder's, not made here.
2. `app.module.ts`: RecipesModule + TasteModule both kept. 3. `scripts/sql_outside_migrations.txt`: union, deduped.
4. `CellarNext.test.tsx` `?open=` test asserted the old inline `recipe-empty`; now asserts the mounted RecipeSheet like its sibling.

## Decisions (no founder asked)
- D1 Read-only card on a recipe sheet (`describe={false}`): TasteForm writes a staff layer for a GOOD; a cocktail/dish taste is worked out from its recipe. Rejected: reuse the form (posts the wrong subject; blurs "from recipe" provenance).
- D2 One action, label by state: "Work it out" until a `recipe` layer exists, then "Read again". Offered to every role (gateway has no role gate on rollup: "roles gate money, not palates"). Rejected: auto-run on open (a write on a read; the roll-up appends layers).
- D3 Roll-up reads the SAVED recipe, so with unsaved typed lines the sheet says so. Rejected: the preview endpoint on typed lines (kept for a later slice; it would need debounce and a "not saved" taste).
- D4 Words: 503 recipes_unavailable, no saved recipe (404 `recipe_not_written` is a real answer on POST, unlike the read's bare 404 = absent), 400 refusal shows the gateway's sentence, 5xx shows only a generic sentence, no response = "Mudavym could not be reached just now." `lib/unreachable.ts` is on #1946 (not in this base); same sentence inlined in taste.ts. Rejected: adding lib/unreachable.ts here (add/add conflict with #1946). When #1946 lands, taste.ts can import it.
- D5 iv-* classes in TasteCard are inventory-page CSS; the cellar page does not load it, so a scoped `.cl-rcp .iv-*` block (same values, 44 px taps on phone) is in cellar-next.css. Rejected: restyle TasteCard with cl-* (would change the drawer).
- D6 Summary line: own small component (reuses leadLine, Glyph, PROV_MARK, .tc-line CSS); TasteSummary untouched (it is hard-wired to goods and to the drawer's evidence panel).

## Tests
- web vitest `src/pages/cellar src/pages/inventory src/services/api`: 71 files, 1349 tests pass (at B). At A: 48 files 1114 pass. `tsc --noEmit -p apps/web`: clean.
- gateway on the meet: jest `src/taste src/recipes` 11 suites 166 pass; `tsc --noEmit` clean except ignored TS2307.
- New: RecipeTaste.test.tsx (10), taste.test.ts rollupTaste (7), RecipeSheet.test.tsx (2 sheet-level: order line -> cards -> card; Work it out calls rollup for this drink).
- Mutants, committed first, each restored, all KILLED (15): 404 coded as absent; label ignores worked; kind hard-wired; hasRecipe ignored; failure not said; describe ignored; unreachable removed; 503 words removed; action on failed read; line moved below cards; unsaved note dropped; button not held while busy; recipe layer not detected; 5xx treated unreachable; 5xx sentence leaked.

## NOT DONE
- Dish recipe sheet: the dishes stack (#1222/#1223/#1224 -> #1915) is not on the meet, and no dish sheet exists on it. `RecipeTaste` takes `kind="dish"` (tested at component and client level); mounting it on the dish sheet waits for that stack (one mount line + hasRecipe).
- Browser check not run (brief: no stack/browser). Owed: open a cocktail with a saved recipe, Work it out, Read again; phone 375 taps; light/dark.
- Merge order: all chains to main first (#1947 chain, #1141 chain with #863, #1942 chain), then retarget A onto main, then B onto A. The meet itself is never merged.
- The meet branch and B were not CI-run by me; the repo guards (claims, migrations) not run.
