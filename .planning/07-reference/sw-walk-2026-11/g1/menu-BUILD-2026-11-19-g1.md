# g1 menu build 2026-11-19: take the menu's prices onto many dishes

Gap verified real: no open PR title covers a batch; per-row UseMenuPrice (#1512) and the Menu column (#1420) only. Make-current never touches dishes.

PR: #1907 (draft) feat/g1-menu-takes-all-prices, base integ/g1-menu-take-prices-base (merge of #1829 + #1512 + #1691; conflicts in DishesPage.tsx, recipes.service.ts, dishes-list.spec.ts, dishes-recipe.spec.ts resolved keeping both sides). 10 files, 606 lines.

Route: brief said /restaurants/:id/dishes/take-menu-prices; the controller prefix is recipes, so it is POST /recipes/:restaurantId/dishes/take-menu-prices.

Tests: gateway jest src/recipes 24 suites pass (new dishes-take-menu-prices.spec.ts, 9 tests); web vitest src/pages/dishes + cellar/next/recipe pass (new DishesPage.takeMenuPrices.test.tsx, 5 tests); tsc clean both; vite build ok.
Mutation: already-equal check removed -> 2 gateway fail; 404 check + Roles guard removed -> 2 fail; web differ filter removed -> 3 fail; button double-fire -> write-once test fails.
Pre-existing failure: auth/guards/route-access.spec.ts (expected json lacks all DishesController routes) - fails on base too.

Left: drinks (brief excluded them); a dish whose menu line states two prices is left to the single-dish UseMenuPrice; PR must wait for #1829/#1512/#1691 to land, then retarget; route-access.expected.json regeneration for DishesController is owed by whoever owns it.

Browser checks owed: see PR #1907 body (6 checks: count line, Show them filter + sheet, button writes and Menu column clears, several/two-price never listed, staff sees nothing, gateway-down says Nothing was changed).
