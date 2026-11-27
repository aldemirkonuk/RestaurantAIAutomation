/**
 * @wineops/floor-core — the Floor Checker's pure logic, ported into Mudavym
 * (ADR 0345 E1; ADR 0346 D4; both Proposed, built under OD-242). The `@wineops/` scope is the workspace's, as
 * `packages/ui` and `packages/database` use.
 *
 * No React, no database, no clock: every function that needs the time takes
 * `now`, and the warn/late minutes are the house's settings, passed in.
 *
 * The package lands in serial parts; `.planning/STATE.md` records what has
 * landed and what follows. Exported so far: table freshness,
 * the waiter score, the reassignment proposal, coverage attribution,
 * response time, the Food-up brief, table adjacency and the short-visit rules.
 */
export * from "./freshness";
export * from "./waiter-score";
export * from "./reassignment";
export * from "./attribution";
export * from "./response-time";
export * from "./meal-alert";
export * from "./adjacency";
export * from "./visit-leave";
