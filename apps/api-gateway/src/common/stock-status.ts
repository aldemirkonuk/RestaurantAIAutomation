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

export type StockBand = "healthy" | "at_par" | "low" | "critical" | "unknown";

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
