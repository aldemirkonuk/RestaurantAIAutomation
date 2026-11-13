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
 * the waiter score, the reassignment proposal and coverage attribution.
 */
export * from "./freshness";
export * from "./waiter-score";
export * from "./reassignment";
export * from "./attribution";
