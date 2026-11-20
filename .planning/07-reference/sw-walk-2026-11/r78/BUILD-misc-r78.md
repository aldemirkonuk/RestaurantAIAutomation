# BUILD misc-fix r78 (2026-11-19)

Source: r77 WALK-w1 findings 1,2; WALK-w2 findings 3,4. One worktree at a time, each removed after push.

## (a) #1905 w1 finding 1 - FIXED on stacked #1930 (head f46fd02e7), base = #1905 branch
Decision (recorded): do NOT wire step 2. ADR 0213 made create account-only; the house is opened on /get-started (GetStarted.tsx has the restaurant step), and the page's own lede says "The house comes after you verify". So the restaurant form was dead since before #1905. Removed the form, its state, locale helper, currency/place/phone imports, wide layout. registerAccount already notes the mail outcome and goes to /verify-email. AuthContext.registerRestaurant (and #1905's noteSignUpMail call inside it) stays: other callers and tests use it.
- Tests: new Register.ownerPath.test.tsx (2); removed the source-read test in AuthContext.houseOpening.test.tsx that read the deleted handleCreateSubmit. vitest src/pages/__tests__ + src/contexts + brand + styles pass; tsc clean.
- Mutant: old Register.tsx restored -> source guard fails.
- CAVEAT: #1930 diff is 41.6K chars (> 30K cap). It is ~590 deleted lines in one file; a middle slice would leave unused-import tsc errors, so it was not split.
- Browser checks owed: /register?type=new account -> Create account lands /verify-email; card width max-w-2xl; public design on and off.

## (b) #1915 w1 finding 2 - FIXED on stacked #1931 (head 815389d2d), base = #1915 branch (#1915 already 56K)
MenuNext Retry now also invalidates ['menu','versions']. Test: MenuNext.test.tsx new case; src/pages/menu 54 pass; tsc clean. Mutant killed.
- Browser check owed: /menu with gateway down, restore, Retry: kept-menus sentence replaced by Current/Last used.

## (c) #1914 w2 finding 4 - FIXED on stacked #1932 (head 2cd3c4f36), base = #1914 branch (#1914 already 58K)
errText in CheckMarginSection, TillRecipeMap, PosMappingPanel says "Mudavym could not be reached just now." for an ERR_NETWORK with no response; a gateway sentence still wins. 3 new tests; src/components/inventory 74 pass; tsc clean. 3 mutants (old files) killed.
- Browser check owed: till mapping / check margin / POS queue with gateway stopped.

## (d) #1912 w2 finding 3 - FIXED on #1912 (head 6b13f7dce; PR diff 19.6K)
normalizeInventoryItem kept stockLive null (was ?? 0) and shadowStock undefined (was ?? 0; the "0 g" in "Live / shadow" was the shadow). InventoryItem.stockLive is now number | null. Fallout was 4 spots (OneTapActionCenter param types, useInventoryQueries update call, a test), all fixed; readers of stock/shadow already say ?? 0 or skip unread rows (inventory sums filter stock !== null).
- Tests: iv-list-units.test.tsx 2 new (unread -> dash/unknown/not "0 g"; counted 0 stays 0 and Out). 158 files / 2186 tests pass (inventory, api, hooks, components, dashboard, cellar, contexts); tsc clean. Mutant (old inventory.ts) kills the unread case.
- NOT FIXED (out of scope, noted): cellar useCellarNextData still turns an unread stock into 0 in its building total and CellarRow (`num(it.stockLive) ?? 0`, lines ~1362/1392) - behavior is unchanged from before, but that total can claim completeness over an unread row. thresholdMin is still normalised `?? 0` (an absent par reads as "no par").
- Browser check owed: /inventory row whose gateway stock is null shows "—", standing "Stock not read", not "0 g"/Out.

Not run: browser, local stack (per brief). Gateway untouched, so no gateway tsc/jest.
