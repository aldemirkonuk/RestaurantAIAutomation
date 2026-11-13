/**
 * "Below par" — one definition, for the whole gateway.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The 2026-09-03 lens run found THREE answers to one question, on one screen,
 * about the same rows, in the same second:
 *
 *   /inventory chip          9 below par, "2 critical"   (stock <= par)
 *   GET …/low-stock          7                            (stock <  par, via v_low_stock_items)
 *   GET …/summary            criticalCount 0              (stock === 0)
 *   low-stock-alerts         Tsantali 2/5 → "critical"    (stock <= par * 0.5)
 *
 * The `criticalCount` one is not a definition at all — `stock === 0` is "out of
 * stock", which is a different question, and it answered 0 while the alert
 * service was calling a wine critical.
 *
 * THE RULE
 * --------
 * Below par means `stock < par`, STRICTLY — the predicate `v_low_stock_items`
 * already uses, which is the one that decides whether an alert fires. A wine
 * sitting exactly at par is `at_par`: the system will not act on it, so no
 * counter may claim it needs acting on. Over-reporting is the same fault as
 * under-reporting, pointed the other way.
 *
 * Whether "exactly at par" ought to count is a judgement about reorder policy,
 * not about code, and it is not written in `.planning/decisions/`. It lives in
 * `datasets/sim/fixtures/below-par-cases.json` as ONE line so reversing it is
 * one edit in one file rather than a hunt through three.
 *
 * DRIFT
 * -----
 * `apps/web/src/lib/inventoryStatus.ts` is the SPA's copy — two languages, one
 * rule. Both suites run `datasets/sim/fixtures/below-par-cases.json`, the same
 * lockstep the operating-hours pair uses, because a comment did not stop these
 * three from diverging and will not stop the next two.
 */

export type StockBand =
  | "healthy"
  | "at_par"
  | "low"
  | "critical"
  | "unknown"
  /** Below par by its figures, on a row `v_low_stock_items` does not hold. */
  | "not_alerted";

/** At or under this fraction of par, a wine is critical rather than merely low. */
export const CRITICAL_RATIO = 0.5;

/**
 * Which band a wine sits in.
 *
 * `unknown` is returned — never `critical` — when the stock or the par is
 * missing or non-positive. A failed read and an empty shelf must not render the
 * same (ADR 0067), and "this wine has no par set" is not "this wine has a par
 * of nothing": a par of 0 makes every ratio infinite or undefined, so there is
 * nothing to be below.
 */
export function classifyStock(
  stockLive: number | null | undefined,
  parLevel: number | null | undefined,
): StockBand {
  if (stockLive === null || stockLive === undefined) return "unknown";
  const stock = Number(stockLive);
  const par = Number(parLevel);
  if (!Number.isFinite(stock)) return "unknown";
  if (!Number.isFinite(par) || par <= 0) return "unknown";

  const ratio = stock / par;
  if (ratio <= CRITICAL_RATIO) return "critical";
  if (ratio < 1) return "low";
  if (ratio === 1) return "at_par";
  return "healthy";
}

/** The one predicate every counter and every alert asks. */
export function isBelowPar(
  stockLive: number | null | undefined,
  parLevel: number | null | undefined,
): boolean {
  const band = classifyStock(stockLive, parLevel);
  return band === "critical" || band === "low";
}

export function isCritical(
  stockLive: number | null | undefined,
  parLevel: number | null | undefined,
): boolean {
  return classifyStock(stockLive, parLevel) === "critical";
}

/** The fields of a `restaurant_inventory` row the summaries classify. */
export interface StockRow {
  id: string;
  stock_live?: number | null;
  threshold_min?: number | null;
  last_counted_at?: string | null;
}

/** A summary missing a read refuses rather than count 0 low (QA 12a). */
export class LowStockListUnreadError extends Error {
  constructor(what: string) {
    super(`${what} was not read, so no item can be called low or fine.`);
    this.name = "LowStockListUnreadError";
  }
}

export interface StockSummary {
  lowStockCount: number;
  criticalCount: number;
  atParCount: number;
  unknownCount: number;
  healthyCount: number;
}

/**
 * A row's band, with OD-161's rule for a wine nobody has counted.
 *
 * `last_counted_at` is stamped only by a count. An uncounted row's figure is
 * a count of nothing unless receipts and sales gave it one, and which rows
 * have one is decided in SQL by a live stock movement
 * (a_received_wine_not_counted_yet_can_run_low): `v_low_stock_items` holds the
 * uncounted rows whose received-minus-sold figure is below par. So an
 * uncounted row is classified only when the view holds it, and is `unknown`
 * otherwise.
 *
 * Which rows can run low is the view's answer alone (QA 12a R1): a copy of
 * its row tests (`canRunLow`) went stale when every_good_can_run_low widened
 * it to every good. A below-par row the view does not hold is `not_alerted`.
 */
export function bandOfRow(
  row: StockRow,
  inView: ReadonlySet<string> | null,
): StockBand {
  const held = inView?.has(row.id) ?? false;
  if (row.last_counted_at == null && !held) return "unknown";
  const band = classifyStock(row.stock_live, row.threshold_min);
  // No alert fires for a row the view leaves out, so no counter calls it low.
  if ((band === "low" || band === "critical") && !held) return "not_alerted";
  return band;
}

/**
 * The alert band of a row `v_low_stock_items` returned: `critical` or `low`,
 * or null when the row is not below par after all (the view's predicate and
 * this module having drifted). The view holds a never-counted wine only when
 * receipts and sales put it below par, so every row it returns is in view by
 * construction. The alert service (notifications/low-stock-alerts.service.ts)
 * and the dashboard's alert list both ask this, so a counted 2 of 5 is
 * critical in the inbox and on the dashboard alike; the dashboard used to call
 * only `stock_live === 0` critical, and read the same wine as a warning
 * (QA round 9c).
 */
export function alertBandOfViewRow(row: StockRow): "critical" | "low" | null {
  return alertBandOf(bandOfRow(row, new Set([row.id])));
}

/** A band as an alert reads it: `critical`, `low`, or null (not alerted). */
export function alertBandOf(band: StockBand): "critical" | "low" | null {
  return band === "critical" || band === "low" ? band : null;
}

/**
 * The stock counts every summary shows (GET /inventory/summary and the
 * dashboard's inventory card), from ONE classification over ONE array. QA
 * round 9c found the dashboard counting `stock_live === 0` over counted rows
 * while /inventory counted `classifyStock` over counted rows plus the
 * uncounted rows the view holds: a wine received 5 and sold 5, never counted,
 * par 3, fired a critical alert and read criticalCount 1 on /inventory and 0
 * on the dashboard. Both now read this, so they cannot disagree.
 */
export function summarizeStock(
  inventory: readonly StockRow[] | null | undefined,
  lowStock: readonly { id: string }[] | null | undefined,
): StockSummary {
  if (inventory == null) throw new LowStockListUnreadError("The house's inventory");
  if (lowStock == null) throw new LowStockListUnreadError("The low-stock list");
  const inView = new Set(lowStock.map((item) => item.id));
  const bands = inventory.map((row) => bandOfRow(row, inView));
  const count = (...want: StockBand[]) =>
    bands.filter((b) => want.includes(b)).length;
  return {
    lowStockCount: count("low", "critical"),
    criticalCount: count("critical"),
    atParCount: count("at_par"),
    // A wine whose stock or par we could not read, or nobody counted, is NOT
    // healthy. Folding it into the healthy count is how an unreadable row
    // becomes a reassuring one.
    unknownCount: count("unknown"),
    healthyCount: count("healthy"),
  };
}
