# g1 inventory build, 2026-11-19: STOPPED, duplicate of live work

Gap: a sale never draws a recipe's goods (recipe-draw slice 4 + mapping UI).

Verified at 13:08 EST:
- Gap is real: no open PR among 500 listed (gh pr list --state open) titled slice 4 / mapping UI / record_recipe_draw caller. #1540 head e7fc3d166 (base feat/a-voided-recipe-sale-gives-its-draw-back).
- #863's recipe_current / recipe_lines are NOT in #1540's ancestry (git grep recipe_current at e7fc3d166 in supabase/migrations: 0 hits). Stacking on #1540 would fail scripts/check_queried_tables_exist.py.
- Two other agents are building this same slice right now, unpushed (no remote branch):
  - wt/g1-inv-recipe-slice4, branch feat/g1-inv-recipe-slice4-mapped-sale-draws, merge 05b7c52ae (#863), untracked pos-hub/recipe-sale.ts (272 lines, last write 13:07:44).
  - wt/g1-recipe-draw4, branch feat/a-mapped-cocktail-sale-draws-its-recipe, ba436fa27, edits to pos-hub.service.ts and toast.service.ts plus recipe-sale.ts (last write 13:06:21).
Building a third copy would duplicate and collide, so nothing was built. No PR, no worktree, no commit.

Left: gateway wiring, PosMappingPanel cocktail picker, Usage-card NOT_DRAWN_BY_SALES narrowing, PGlite Negroni test, tests. Owed to whichever of the two live worktrees ships first.
Dish buttons: ESCALATE (needs a new mapping column or migration; founder decision under ADR 0366).
Browser checks owed: none yet (nothing built).
