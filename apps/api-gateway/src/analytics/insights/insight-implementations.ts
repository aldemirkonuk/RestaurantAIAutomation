/**
 * Which catalogued insight types the engine can ACTUALLY emit today.
 * =================================================================
 *
 * `insight-catalog.ts` enumerates the compositional candidate space — every
 * dimension × measure × comparator that *would* make sense. That enumeration is
 * a roadmap, and it is legitimate as one. It is not a capability claim: the vast
 * majority of those types have no generator behind them.
 *
 * The Browse-All explorer used to answer "computable now" by filtering the
 * catalogue on DATA AVAILABILITY ALONE. A restaurant with a POS feed was told
 * every check-derived type in the space was computable — an order of magnitude
 * more than the engine can produce. ADR 0020 (`0020-no-fabricated-answers.md`,
 * Locked): *"A mislabelled number is a fabrication."* Renaming the label would
 * not have fixed it; the count itself was wrong.
 *
 * So a type is computable now only when BOTH hold:
 *   1. a generator emits it  (this file), and
 *   2. the restaurant has the data it needs  (catalogue `requires`).
 *
 * ## Keeping this honest
 *
 * `IMPLEMENTED_INSIGHT_TYPES` is a declared list, because the generator builds
 * its keys as string literals and template literals with no registry to read at
 * runtime. A hand-maintained list would rot silently, so it is not trusted:
 * `insight-implementations.spec.ts` re-derives the truth straight from
 * `insight-generator.service.ts` — every `this.record(...)` key, with the
 * templated ones inside the `timeSeriesInsights` helper expanded across that
 * helper's call sites — and fails if the two sets differ by a single key. The
 * extractor throws rather than guesses when it meets a key shape it cannot
 * resolve, so a refactor that outruns it breaks the build instead of quietly
 * shrinking the count.
 *
 * Add a generator → add its key here, or the suite goes red.
 */

import {
  DataRequirement,
  INSIGHT_CANDIDATES,
  InsightCandidate,
} from "./insight-catalog";

/**
 * Catalogue keys with a live generator in `insight-generator.service.ts`.
 *
 * 12 come from literal `this.record("…")` call sites; the other 12 are the
 * four-insight `timeSeriesInsights` pack (`vs_same_weekday`,
 * `vs_prev_period_{7,30}d`, `trend_direction`, `anomaly_day`) applied to the
 * three series the generator feeds it: overall bottles, overall purchasing
 * spend, overall sales.
 */
export const IMPLEMENTED_INSIGHT_TYPES: readonly string[] = [
  "overall.bottles.anomaly_day",
  "overall.bottles.forecast_gap",
  "overall.bottles.trend_direction",
  "overall.bottles.vs_prev_period_7d",
  "overall.bottles.vs_same_weekday",
  "overall.purchase_spend.anomaly_day",
  "overall.purchase_spend.trend_direction",
  "overall.purchase_spend.vs_prev_period_30d",
  "overall.purchase_spend.vs_same_weekday",
  "overall.revenue.anomaly_day",
  "overall.revenue.goal_pace",
  "overall.revenue.trend_direction",
  "overall.revenue.vs_prev_period_7d",
  "overall.revenue.vs_same_weekday",
  "table.avg_check.attribute_correlation",
  "table.avg_check.driver_weights",
  "table.avg_check.peer_rank",
  "table.revenue.hot_entity_live",
  "vendor.purchase_spend.concentration",
  "waiter.avg_check.peer_rank",
  "wine.bottles.basket_affinity",
  "wine.bottles.vs_prev_period_7d",
  "wine.consumption_qty.concentration",
  "wine.stockout_risk.peer_rank",
] as const;

export const IMPLEMENTED_INSIGHT_TYPE_SET: ReadonlySet<string> = new Set(
  IMPLEMENTED_INSIGHT_TYPES,
);

/** Does a generator emit this catalogue type today? */
export function isImplemented(key: string): boolean {
  return IMPLEMENTED_INSIGHT_TYPE_SET.has(key);
}

/** A catalogue candidate plus whether a generator stands behind it. */
export interface AnnotatedCandidate extends InsightCandidate {
  implemented: boolean;
}

export function annotatedCandidates(): AnnotatedCandidate[] {
  return INSIGHT_CANDIDATES.map((c) => ({
    ...c,
    implemented: isImplemented(c.key),
  }));
}

/**
 * The four numbers the coverage meter is allowed to show. They partition the
 * catalogue exactly: `computable + blockedOnData + notBuilt === catalogued`
 * (once availability is known).
 */
export interface CatalogCoverage {
  /** Every enumerated type — the roadmap. */
  catalogued: number;
  /** Catalogued types with a generator behind them. */
  implemented: number;
  /**
   * Implemented AND this restaurant has the data. The only number that may be
   * called "computable now". `null` when availability is unknown (signed out,
   * or the availability probe failed) — an unknown is never rendered as a
   * figure.
   */
  computable: number | null;
  /** Implemented, but this restaurant is missing the data. `null` as above. */
  blockedOnData: number | null;
  /** Catalogued with no generator yet — roadmap, not capability. */
  notBuilt: number;
}

/**
 * Coverage for one restaurant. Pass `null` when availability is unknown: the
 * data-dependent fields come back `null` rather than a guess.
 */
export function catalogCoverage(
  available: ReadonlySet<DataRequirement> | null,
): CatalogCoverage {
  const catalogued = INSIGHT_CANDIDATES.length;
  const implementedCandidates = INSIGHT_CANDIDATES.filter((c) =>
    isImplemented(c.key),
  );
  const implemented = implementedCandidates.length;
  if (!available) {
    return {
      catalogued,
      implemented,
      computable: null,
      blockedOnData: null,
      notBuilt: catalogued - implemented,
    };
  }
  const computable = implementedCandidates.filter((c) =>
    c.requires.every((r) => available.has(r)),
  ).length;
  return {
    catalogued,
    implemented,
    computable,
    blockedOnData: implemented - computable,
    notBuilt: catalogued - implemented,
  };
}
