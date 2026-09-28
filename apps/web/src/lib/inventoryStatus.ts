/**
 * inventoryStatus — the SPA's copy of the ONE below-par definition.
 *
 * Phase 1 (D6) unified three frontend classifications into this file. The
 * 2026-09-03 POS lens then found that the frontend and the backend still
 * disagreed, in three different ways, on one screen, in the same second:
 *
 *   /inventory chip          9 below par, "2 critical"   (this file, stock <= par)
 *   GET …/low-stock          7                            (v_low_stock_items, stock < par)
 *   GET …/summary            criticalCount 0              (stock === 0)
 *   low-stock-alerts         Tsantali 2/5 → "critical"    (stock <= par * 0.5)
 *
 * So the rule now lives in `datasets/sim/fixtures/below-par-cases.json` and
 * BOTH sides run it — this file's `inventoryStatus.test.ts` and the gateway's
 * `apps/api-gateway/src/common/stock-status.spec.ts`. Two languages, one table
 * of answers. Add a case to the fixture, never to one suite alone: a comment
 * did not stop the last divergence and will not stop the next.
 *
 * Bands (ratio = liveStock / par):
 *   critical : ratio <= 0.5
 *   low      : 0.5 < ratio < 1
 *   at_par   : ratio == 1     ← NOT below par; the system will not act on it
 *   healthy  : ratio > 1
 *   unknown  : stock or par missing, or par <= 0
 *
 * Two changes from the pre-2026-09-05 version, both of which were counting
 * wines the rest of the product would never act on:
 *
 *   1. `ratio <= 1` became `< 1` plus an explicit `at_par`. `v_low_stock_items`
 *      — the predicate that decides whether an ALERT fires — is strictly `<`,
 *      so a wine exactly at par was counted as needing attention by the chip
 *      while nothing downstream agreed. Over-reporting is the same fault as
 *      under-reporting, pointed the other way.
 *   2. `threshold > 0 ? threshold : 1` is gone. It invented a par of 1 for
 *      every wine that had none, so a wine with no par and no bottles rendered
 *      "Critical" against a number nobody set. No par means no verdict.
 */

export type StockStatusKey =
  | "healthy"
  | "at_par"
  | "low"
  | "critical"
  | "unknown";

export interface StockStatus {
  key: StockStatusKey;
  label: "Healthy" | "At par" | "Low" | "Critical" | "Unknown";
  color: string;
  bg: string;
  text: string;
}

/** At or under this fraction of par, a wine is critical rather than merely low. */
export const CRITICAL_RATIO = 0.5;

const HEALTHY: StockStatus = {
  key: "healthy",
  label: "Healthy",
  color: "emerald",
  bg: "bg-emerald-100",
  text: "text-emerald-700",
};
const AT_PAR: StockStatus = {
  key: "at_par",
  label: "At par",
  color: "sky",
  bg: "bg-sky-100",
  text: "text-sky-700",
};
const LOW: StockStatus = {
  key: "low",
  label: "Low",
  color: "amber",
  bg: "bg-amber-100",
  text: "text-amber-700",
};
const CRITICAL: StockStatus = {
  key: "critical",
  label: "Critical",
  color: "rose",
  bg: "bg-rose-100",
  text: "text-rose-700",
};
const UNKNOWN: StockStatus = {
  key: "unknown",
  label: "Unknown",
  color: "gray",
  bg: "bg-gray-100",
  text: "text-gray-500",
};

export function classifyStock(
  liveStock: number | null | undefined,
  parLevel: number | null | undefined,
): StockStatus {
  if (liveStock == null) return UNKNOWN;
  const stock = Number(liveStock);
  const par = Number(parLevel);
  if (!Number.isFinite(stock)) return UNKNOWN;
  // No par is not a par of nothing: there is nothing to be below.
  if (!Number.isFinite(par) || par <= 0) return UNKNOWN;

  const ratio = stock / par;
  if (ratio <= CRITICAL_RATIO) return CRITICAL;
  if (ratio < 1) return LOW;
  if (ratio === 1) return AT_PAR;
  return HEALTHY;
}

/** The one predicate every counter and every alert asks. */
export function isBelowPar(
  liveStock: number | null | undefined,
  parLevel: number | null | undefined,
): boolean {
  const key = classifyStock(liveStock, parLevel).key;
  return key === "critical" || key === "low";
}
