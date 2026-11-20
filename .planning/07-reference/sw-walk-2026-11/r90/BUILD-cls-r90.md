# r90 cls-fix (2026-11-19)

PR: https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/1961 (DRAFT, base fix/r88-taste-basis = #1960's branch), head e99d63287, diff 19,285 chars.
Worktree wt/r90-cls (from origin/fix/r88-taste-basis 40e8b39a7). Harness: r90/w1 (cls90.cjs 3 runs per case, dbg.cjs layout-shift rects, tl.cjs per-frame timeline). Local stack from the branch's migrations (dishes table not in this chain: seed2.sql = r89 seed without dishes), production build + vite preview 3410.

## Finding re-read
The 1440 movers were not the rail. The rail (`.mdv-rail`) never moves. Sources named FOOTER and NAV were the register page's: CellarNext's signature footer and its "Cellar registers" spine. Timeline at 1440 on /cocktails (before): first paint is the no-tenant frame, then (1) register head's basis+evidence lines arrive (+47 px, rule/table drop), (2) cocktail list read becomes a table (+165 px under it, footer rides down), (3) with ?open the recipe panel mounts and the recipe lands (other books pushed off screen), (4) the taste line's reserved 30 px collapses (r86/r88).

## Decisions (no founder question asked)
1. PR placement: stacked DRAFT on #1960's branch. The register's own loading code is on main, the opened-drink sheet is on the chain, so no single owning PR fits; a main-based PR would conflict with the chain's CocktailRegister edits.
2. No shell PR on main: shell files are identical to main, the rail does not move; the shell's residual is 0.0046 (header house name arrives, search moves) + 0.0009 (counter read label). Fix needs the branch list before first paint (AuthContext initial state from the cached branches) = an auth question, not taken. Recorded, not built.
3. Footer: kept at the foot of a min-height column and `visibility:hidden` until authLoading/registersLoading end (hidden holds room, is not a shift). Honest too: the signature says what was read.
4. Skeleton rows = 3 (the fewest a house list has). A house with more rows moves the books section down by the extra rows only.
5. ?open room = `calc(100vh - 56px)`, only for the linked drink (`holdRoom`), only while the list/recipe is read; a click holds nothing (user-input shifts are exempt anyway).
6. Taste line/card reservations (r86/r88) left untouched, per the finding ("independent of the taste").

## Measured (1440x900 / 375x812, 3 runs, local prod build)
| case | before | after |
|---|---|---|
| 1440 owner /cocktails | 0.0786 | 0.0082 |
| 1440 staff /cocktails | 0.0695 | 0.0081 |
| 1440 owner ?open | 0.178-0.184 | 0.061 |
| 1440 staff ?open | 0.169-0.186 | 0.066 |
| 375 (all four) | 0.0000 | 0.0000 |
Remaining ?open: 0.052-0.058 = taste line collapse (a drink with no taste sentence); 0.0046+0.0009 shell; 0.0027 spine nav (registers unread = Wines alone, then the carried set; widening is by design, ADR-level "do not assert a set").
375 is 0 before and after because the shifting parts are below the fold on a phone; r89's 0.042-0.052 there (cost panel) did not reproduce on this seed/branch.

## Proof
`vitest run src/pages/cellar/next` 22 files / 468 tests pass; `tsc --noEmit -p tsconfig.json` clean; 7 new specs; 6 mutations each fail >=1 test (footer visibility, head hold, table room, link room, holdRoom prop, sheet min-height).

## Not done
- Dishes page (/dishes) not measured (no dishes table in this chain's migrations).
- Whole-page CLS under the 2 s delayed taste read not re-measured.
- No-tenant first frame ("No restaurant is active") still paints for ~20 ms before the branch list resolves; AuthContext sets loading=false before activeRestaurantId. Not touched (auth).
- Spine nav widening 1 -> N registers not reserved.
