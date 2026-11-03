/**
 * @wineops/floor-core — the Floor Checker's pure logic, ported into Mudavym
 * (ADR 0345 E1; ADR 0346 D4; both Proposed, built under OD-242). The `@wineops/` scope is the workspace's, as
 * `packages/ui` and `packages/database` use.
 *
 * No React, no database, no clock: every function that needs the time takes
 * `now`, and the warn/late minutes are the house's settings, passed in.
 *
 * The package lands in serial parts, each under the audit gate's size limit;
 * `.planning/decisions/claims.d/feat-floor-core-1-skeleton-and-freshness.jsonl`
 * records the order. This part exports only table freshness.
 */
export * from "./freshness";
