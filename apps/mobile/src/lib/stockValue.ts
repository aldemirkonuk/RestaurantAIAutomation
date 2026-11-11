/**
 * Stock value and cost label when a cost may be unknown (ADR 0051). Insights
 * used to sum `quantity × (wac ?? 0)`, counting a wine with no recorded cost
 * as free. Here an unknown cost is counted, not summed.
 */

export const COST_NOT_KNOWN = "cost not known yet";

export interface CostedItem {
  wac?: number | null;
  quantity?: number | null;
  lotLiveQty?: number | null;
}

export interface StockValueTotal {
  /** Sum over the wines whose cost is known. */
  known: number;
  /** Wines with bottles on hand and no known cost: left out of `known`. */
  unknownItems: number;
}

export function unitCostOf(item: Pick<CostedItem, "wac">): number | null {
  const c = item.wac;
  return typeof c === "number" && Number.isFinite(c) && c >= 0 ? c : null;
}

export function totalStockValue(items: readonly CostedItem[]): StockValueTotal {
  let known = 0;
  let unknownItems = 0;
  for (const i of items) {
    const bottles = i.quantity ?? i.lotLiveQty ?? 0;
    if (bottles === 0) continue;
    const cost = unitCostOf(i);
    if (cost == null) unknownItems += 1;
    else known += cost * bottles;
  }
  return { known, unknownItems };
}

/** "$1,240", or "$1,240 + 2 wines whose cost is not known yet": never a total that hides them. */
export function totalStockValueText(t: StockValueTotal, fmt: (n: number) => string): string {
  if (t.unknownItems === 0) return fmt(t.known);
  const wines = `${t.unknownItems} wine${t.unknownItems === 1 ? "" : "s"}`;
  if (t.known === 0) return `${COST_NOT_KNOWN} (${wines})`;
  return `${fmt(t.known)} + ${wines} whose cost is not known yet`;
}

/** The cost line's label. An agreed cost is neither an invoice nor an estimate. */
export function costLabel(provenance: string | null | undefined, cost: number | null): string {
  if (cost == null) return "Cost";
  if (provenance === "invoice") return "Cost (invoice)";
  if (provenance === "agreed") return "Cost (agreed at delivery)";
  return "Cost (est.)";
}
