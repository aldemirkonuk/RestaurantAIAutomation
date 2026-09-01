/**
 * WineOps Insight Catalog — the compositional candidate space
 * ===========================================================
 *
 * SOTA insight engines (Power BI Quick Insights, Tableau Explain Data) do not
 * hand-write N insight formulas — they enumerate a cross-product of
 *
 *      DIMENSION  ×  MEASURE  ×  COMPARATOR
 *
 * and let a validity matrix prune nonsense combinations. Each surviving
 * triple is an *insight candidate type*; at runtime each type × the live
 * entities of its dimension (each table, each waiter, each wine...) yields
 * many concrete candidates, which are computed, scored, and ranked.
 *
 * This file is pure data + pure functions (no NestJS/DB) so the candidate
 * space is testable and countable. The generator service executes it.
 */

export type InsightCategory =
  | "sales"
  | "purchasing"
  | "inventory"
  | "efficiency"
  | "tables"
  | "staff"
  | "basket"
  | "risk"
  | "forecast"
  | "goals";

/** What data a candidate needs before it can be computed. */
export type DataRequirement =
  | "consumption" // wine_consumption_log
  | "orders" // procurement_orders
  | "inventory" // restaurant_inventory (+ lot rollup)
  | "checks" // pos_checks (POS-agnostic check feed)
  | "tables" // restaurant_tables (+ distances/seats)
  | "venue" // restaurant_venue_profiles
  | "goals"; // analytics_goals

export interface InsightDimension {
  key: string;
  label: string;
  /** Whether this dimension has enumerable entities at runtime. */
  entityScoped: boolean;
  requires: DataRequirement[];
}

export interface InsightMeasure {
  key: string;
  label: string;
  unit: "currency" | "count" | "percent" | "ratio" | "units";
  requires: DataRequirement[];
}

export interface InsightComparator {
  key: string;
  label: string;
  /** Template family used by the verbalizer. */
  template: string;
  /**
   * Data the *comparator* needs, over and above the dimension and the measure.
   *
   * Most comparators are pure re-shapings of the measure's own series and add
   * nothing. Two do not, and saying otherwise mislabels a type as computable
   * when its generator provably cannot run (ADR 0020 — a mislabelled number is
   * a fabrication):
   *   - `goal_pace` reads `analytics_goals`, not the measure's series.
   *   - `basket_affinity` mines `pos_checks.items`, not the consumption log.
   * `insight-implementations.spec.ts` derives each implemented type's real
   * guard from the generator source and fails if this drifts.
   */
  requires?: DataRequirement[];
}

// ---------------------------------------------------------------------------
// Dimensions — the "sliced by" axis
// ---------------------------------------------------------------------------

export const DIMENSIONS: InsightDimension[] = [
  { key: "overall", label: "Overall", entityScoped: false, requires: [] },
  {
    key: "day_of_week",
    label: "Day of week",
    entityScoped: true,
    requires: [],
  },
  {
    key: "daypart",
    label: "Daypart",
    entityScoped: true,
    requires: ["checks"],
  },
  {
    key: "table",
    label: "Table",
    entityScoped: true,
    requires: ["checks", "tables"],
  },
  {
    key: "table_zone",
    label: "Table zone",
    entityScoped: true,
    requires: ["checks", "tables"],
  },
  { key: "waiter", label: "Server", entityScoped: true, requires: ["checks"] },
  { key: "wine", label: "Wine", entityScoped: true, requires: ["consumption"] },
  {
    key: "wine_type",
    label: "Wine category",
    entityScoped: true,
    requires: ["consumption", "inventory"],
  },
  { key: "vendor", label: "Vendor", entityScoped: true, requires: ["orders"] },
  {
    key: "venue_feature",
    label: "Venue feature",
    entityScoped: true,
    requires: ["venue", "checks"],
  },
];

// ---------------------------------------------------------------------------
// Measures — the "of what" axis
// ---------------------------------------------------------------------------

export const MEASURES: InsightMeasure[] = [
  { key: "revenue", label: "sales", unit: "currency", requires: ["checks"] },
  {
    key: "bottles",
    label: "bottles sold",
    unit: "units",
    requires: ["consumption"],
  },
  { key: "checks", label: "checks", unit: "count", requires: ["checks"] },
  {
    key: "avg_check",
    label: "average check",
    unit: "currency",
    requires: ["checks"],
  },
  { key: "covers", label: "covers", unit: "count", requires: ["checks"] },
  {
    key: "wine_attach_rate",
    label: "wine attach rate",
    unit: "percent",
    requires: ["checks"],
  },
  {
    key: "revenue_per_seat",
    label: "sales per seat",
    unit: "currency",
    requires: ["checks", "tables"],
  },
  /**
   * Seating-density outcomes (Batch 6 / features 361–460):
   * check-in density and sales linked over seating capacity.
   */
  {
    key: "checkin_density",
    label: "check-in density",
    unit: "ratio",
    requires: ["checks", "tables"],
  },
  {
    key: "checks_per_seat",
    label: "checks per seat",
    unit: "ratio",
    requires: ["checks", "tables"],
  },
  {
    key: "wine_revenue_per_seat",
    label: "wine sales per seat",
    unit: "currency",
    requires: ["checks", "tables"],
  },
  {
    key: "revenue_per_cover",
    label: "sales per cover",
    unit: "currency",
    requires: ["checks"],
  },
  {
    key: "wine_per_cover",
    label: "wine sales per cover",
    unit: "currency",
    requires: ["checks"],
  },
  {
    key: "seat_utilization",
    label: "seat utilization",
    unit: "percent",
    requires: ["checks", "tables"],
  },
  {
    key: "turnover_per_seat",
    label: "turnover per seat",
    unit: "ratio",
    requires: ["checks", "tables"],
  },
  {
    key: "tip_per_seat",
    label: "tips per seat",
    unit: "currency",
    requires: ["checks", "tables"],
  },
  {
    key: "tip_pct",
    label: "tip percentage",
    unit: "percent",
    requires: ["checks"],
  },
  {
    key: "purchase_spend",
    label: "purchasing spend",
    unit: "currency",
    requires: ["orders"],
  },
  {
    key: "order_count",
    label: "purchase orders",
    unit: "count",
    requires: ["orders"],
  },
  {
    key: "consumption_qty",
    label: "wine poured",
    unit: "units",
    requires: ["consumption"],
  },
  {
    key: "inventory_value",
    label: "inventory value",
    unit: "currency",
    requires: ["inventory"],
  },
  {
    key: "days_of_cover",
    label: "days of cover",
    unit: "units",
    requires: ["inventory", "consumption"],
  },
  {
    key: "stockout_risk",
    label: "stockout risk",
    unit: "percent",
    requires: ["inventory", "consumption"],
  },
];

// ---------------------------------------------------------------------------
// Comparators — the "compared how" axis
// ---------------------------------------------------------------------------

export const COMPARATORS: InsightComparator[] = [
  {
    key: "vs_same_weekday",
    label: "vs same weekday history",
    template: "baseline",
  },
  { key: "vs_prev_period_7d", label: "week over week", template: "period" },
  { key: "vs_prev_period_30d", label: "month over month", template: "period" },
  { key: "trend_direction", label: "trend", template: "trend" },
  { key: "anomaly_day", label: "unusual day", template: "anomaly" },
  { key: "peer_rank", label: "vs peer group", template: "peer" },
  { key: "concentration", label: "concentration", template: "concentration" },
  {
    key: "attribute_correlation",
    label: "correlation with attribute",
    template: "correlation",
  },
  {
    key: "driver_weights",
    label: "regression driver weights",
    template: "driver",
  },
  {
    key: "basket_affinity",
    label: "sold-together affinity",
    template: "basket",
    // Mined from pos_checks.items, not the wine consumption log.
    requires: ["checks"],
  },
  { key: "forecast_gap", label: "actual vs forecast", template: "forecast" },
  {
    key: "goal_pace",
    label: "pace vs goal",
    template: "goal",
    // Needs a goal to pace against.
    requires: ["goals"],
  },
  { key: "hot_entity_live", label: "live surge watchlist", template: "hot" },
];

// ---------------------------------------------------------------------------
// Validity matrix — which triples make sense
// ---------------------------------------------------------------------------

/** Measures that make sense per dimension (subset keys; "*" = all). */
const DIMENSION_MEASURES: Record<string, string[] | "*"> = {
  overall: "*",
  day_of_week: [
    "revenue",
    "bottles",
    "checks",
    "avg_check",
    "covers",
    "wine_attach_rate",
    "tip_pct",
    "consumption_qty",
    "purchase_spend",
    "checkin_density",
    "revenue_per_seat",
    "wine_revenue_per_seat",
    "revenue_per_cover",
    "seat_utilization",
  ],
  daypart: [
    "revenue",
    "bottles",
    "checks",
    "avg_check",
    "covers",
    "wine_attach_rate",
    "tip_pct",
    "consumption_qty",
    "checkin_density",
    "revenue_per_seat",
    "wine_revenue_per_seat",
    "revenue_per_cover",
    "seat_utilization",
  ],
  table: [
    "revenue",
    "checks",
    "avg_check",
    "covers",
    "wine_attach_rate",
    "revenue_per_seat",
    "tip_pct",
    "checkin_density",
    "checks_per_seat",
    "wine_revenue_per_seat",
    "revenue_per_cover",
    "wine_per_cover",
    "seat_utilization",
    "turnover_per_seat",
    "tip_per_seat",
  ],
  table_zone: [
    "revenue",
    "checks",
    "avg_check",
    "covers",
    "wine_attach_rate",
    "revenue_per_seat",
    "checkin_density",
    "checks_per_seat",
    "wine_revenue_per_seat",
    "revenue_per_cover",
    "wine_per_cover",
    "seat_utilization",
    "turnover_per_seat",
    "tip_per_seat",
  ],
  waiter: [
    "revenue",
    "checks",
    "avg_check",
    "covers",
    "wine_attach_rate",
    "tip_pct",
    "bottles",
    "checkin_density",
    "revenue_per_cover",
    "wine_per_cover",
  ],
  wine: [
    "bottles",
    "consumption_qty",
    "revenue",
    "days_of_cover",
    "stockout_risk",
    "inventory_value",
  ],
  wine_type: [
    "bottles",
    "consumption_qty",
    "revenue",
    "inventory_value",
    "days_of_cover",
    "stockout_risk",
  ],
  vendor: ["purchase_spend", "order_count"],
  venue_feature: [
    "revenue",
    "checks",
    "avg_check",
    "covers",
    "wine_attach_rate",
    "tip_pct",
    "checkin_density",
    "revenue_per_seat",
    "seat_utilization",
  ],
};

/** Comparators valid per dimension kind. */
const DIMENSION_COMPARATORS: Record<string, string[]> = {
  overall: [
    "vs_same_weekday",
    "vs_prev_period_7d",
    "vs_prev_period_30d",
    "trend_direction",
    "anomaly_day",
    "forecast_gap",
    "goal_pace",
    "concentration",
  ],
  day_of_week: ["vs_same_weekday", "peer_rank", "trend_direction"],
  daypart: ["peer_rank", "vs_prev_period_7d", "trend_direction"],
  table: [
    "peer_rank",
    "vs_prev_period_7d",
    "trend_direction",
    "attribute_correlation",
    "driver_weights",
    "hot_entity_live",
    "anomaly_day",
  ],
  table_zone: ["peer_rank", "vs_prev_period_7d", "attribute_correlation"],
  waiter: [
    "peer_rank",
    "vs_prev_period_7d",
    "trend_direction",
    "driver_weights",
    "anomaly_day",
  ],
  wine: [
    "peer_rank",
    "vs_prev_period_7d",
    "vs_prev_period_30d",
    "trend_direction",
    "anomaly_day",
    "basket_affinity",
    "forecast_gap",
    "concentration",
  ],
  wine_type: [
    "peer_rank",
    "vs_prev_period_7d",
    "vs_prev_period_30d",
    "trend_direction",
    "concentration",
  ],
  vendor: [
    "peer_rank",
    "vs_prev_period_7d",
    "vs_prev_period_30d",
    "trend_direction",
    "concentration",
    "anomaly_day",
    "forecast_gap",
  ],
  venue_feature: ["attribute_correlation", "driver_weights", "peer_rank"],
};

/** Category assignment per (dimension, measure) family. */
export function categorize(
  dimension: string,
  measure: string,
  comparator: string,
): InsightCategory {
  if (comparator === "goal_pace") return "goals";
  if (comparator === "forecast_gap") return "forecast";
  if (comparator === "basket_affinity") return "basket";
  if (comparator === "hot_entity_live") return "tables";
  if (
    dimension === "table" ||
    dimension === "table_zone" ||
    dimension === "venue_feature"
  )
    return "tables";
  if (dimension === "waiter") return "staff";
  if (
    dimension === "vendor" ||
    measure === "purchase_spend" ||
    measure === "order_count"
  )
    return "purchasing";
  if (measure === "inventory_value" || measure === "days_of_cover")
    return "inventory";
  if (measure === "stockout_risk" || comparator === "concentration")
    return "risk";
  if (
    measure === "wine_attach_rate" ||
    measure === "avg_check" ||
    measure === "revenue_per_seat" ||
    measure === "tip_pct" ||
    measure === "checkin_density" ||
    measure === "checks_per_seat" ||
    measure === "wine_revenue_per_seat" ||
    measure === "revenue_per_cover" ||
    measure === "wine_per_cover" ||
    measure === "seat_utilization" ||
    measure === "turnover_per_seat" ||
    measure === "tip_per_seat"
  )
    return "efficiency";
  return "sales";
}

export interface InsightCandidate {
  /** Stable key: dimension.measure.comparator */
  key: string;
  dimension: string;
  measure: string;
  comparator: string;
  category: InsightCategory;
  template: string;
  requires: DataRequirement[];
}

function buildCandidates(): InsightCandidate[] {
  const out: InsightCandidate[] = [];
  const measureByKey = new Map(MEASURES.map((m) => [m.key, m]));
  const comparatorByKey = new Map(COMPARATORS.map((c) => [c.key, c]));
  for (const dim of DIMENSIONS) {
    const allowedMeasures = DIMENSION_MEASURES[dim.key];
    const allowedComparators = DIMENSION_COMPARATORS[dim.key] ?? [];
    const measures =
      allowedMeasures === "*" ? MEASURES.map((m) => m.key) : allowedMeasures;
    for (const mKey of measures) {
      const m = measureByKey.get(mKey);
      if (!m) continue;
      for (const cKey of allowedComparators) {
        const c = comparatorByKey.get(cKey);
        if (!c) continue;
        // prune residual nonsense
        if (cKey === "basket_affinity" && dim.key !== "wine") continue;
        if (cKey === "goal_pace" && dim.key !== "overall") continue;
        if (
          cKey === "attribute_correlation" &&
          !["table", "table_zone", "venue_feature"].includes(dim.key)
        )
          continue;
        const requires = Array.from(
          new Set([...dim.requires, ...m.requires, ...(c.requires ?? [])]),
        );
        out.push({
          key: `${dim.key}.${mKey}.${cKey}`,
          dimension: dim.key,
          measure: mKey,
          comparator: cKey,
          category: categorize(dim.key, mKey, cKey),
          template: c.template,
          requires,
        });
      }
    }
  }
  return out;
}

/**
 * The enumerated candidate space. Each entry is an insight TYPE; concrete
 * insights at runtime = type × entities of its dimension (every table,
 * waiter, wine...), so the effective space is in the thousands.
 */
export const INSIGHT_CANDIDATES: InsightCandidate[] = buildCandidates();

export function candidatesByCategory(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of INSIGHT_CANDIDATES)
    counts[c.category] = (counts[c.category] || 0) + 1;
  return counts;
}

/** Candidates whose data requirements are satisfied by the available set. */
export function availableCandidates(
  available: Set<DataRequirement>,
): InsightCandidate[] {
  return INSIGHT_CANDIDATES.filter((c) =>
    c.requires.every((r) => available.has(r)),
  );
}
