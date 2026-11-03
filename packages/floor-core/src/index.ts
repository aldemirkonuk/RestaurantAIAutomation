/**
 * @wineops/floor-core — the Floor Checker's pure logic, ported into Mudavym
 * (plan `08-softwares/floor-checker.md` §2 PR2; ADR 0345, ADR 0346 D4).
 *
 * No React, no database, no clock: every function that needs the time takes
 * `now`, and the warn/late minutes are the house's settings, passed in.
 *
 * This is the first half of plan §2 PR2 (PR2a): the time logic. The 15-file
 * cap splits PR2: floor-merge, merge-orientation, adjacency and heat follow
 * in PR2b (branch `feat/floor-core-carries-the-floor-geometry`, "carry the
 * Floor Checker's floor geometry"), which must be restacked onto this before
 * it lands. The plan's §2b entry for the PR2a/PR2b split is owed to the
 * docs PR (the docs-floor-checker worktree); this PR's 15-file cap leaves no
 * room for it here.
 */
export * from "./freshness";
export * from "./waiter-score";
