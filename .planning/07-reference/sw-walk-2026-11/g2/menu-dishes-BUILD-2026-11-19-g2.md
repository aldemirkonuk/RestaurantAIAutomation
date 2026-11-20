# g2 menu-dishes build 2026-11-19

PR: #1915 (draft), branch feat/g2-menu-dishes-plan-and-words, head 0f548ff29, base feat/g1-menu-takes-all-prices (#1907 tip 01a1ab775). 15 files, 796 lines.

Gap check: real at the #1907 tip. Premise corrected: drinks have no plan list or batch take-off (per-row "Not on the menu" cell and per-row take-off only, and dishes had both). Built the batch list + take-off for dishes only.

Built: POST recipes/:house/dishes/take-off-menu (owner/manager, re-reads menu, soft remove, skips dishes the menu prints, says why); /dishes count line + Show them + sheet + one button (panel lives in DishesPage.tsx to hold 15 files); menus.service typed 500s with sentences for discard, price correction and the current-menu reads (getMenu, readLines, readCurrentMenus); /menu says the gateway sentence + Retry for the read and the discard; route-access.expected.json + spec gain the Dishes rows (and PUT items/:itemId/weights, also missing) and the controller; dishes-recipe.spec route inventory names takeOffMenu.

Tests: gateway jest src/recipes src/menus src/auth/guards 37 suites / 545 pass; web vitest dishes+menu+cellar/next+onboarding 54 files / 756 pass; tsc clean (gateway minus simplewebauthn TS2307, web); vite build ok.
Mutation: 9 mutants, each caught (bare Errors 3 fail; on-menu not skipped 1; no-menu guard 1; Roles removed 2; web filter widened 2; double-fire 1; failure words 1; gateway sentence ignored 2; Retry no-op 1).

Not done: price correction web sentence + Retry on /menu (no correction screen at this base; lives in #1841 stack; its gateway failure now has words). Retarget #1915 after #1907 lands.

Browser checks owed: in the PR body (5 checks).
