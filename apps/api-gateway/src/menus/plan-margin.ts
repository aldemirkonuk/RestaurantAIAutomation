/**
 * What a new menu's prices do to the margin, in the plan (r109 menu-g4).
 *
 * The plan shows, per line and per kind, the house price and this menu's.
 * This adds the margin at each, against the house's own target (ADR 0193's
 * advice rule, margin-to-target.ts), computed with EXACTLY the inputs
 * /inventory's advice uses (adviseWineRow: the wine's recorded cost and lot
 * WAC, its confirmed pour or the house's, its bottle size, the house's
 * targets and band), at two prices: the house's now and this menu's. So the
 * plan and Inventory never disagree; tax is treated as the advice treats it
 * (not at all, today), and they move together if that changes.
 *
 * The session's calls (r109, founder delegated): margin is cost, so it is
 * computed only for an owner or a manager; anyone else gets null and no
 * number that could be turned back into a cost. Margin never enters the plan
 * fingerprint: make-current must not be refused because a cost moved. A
 * state the rule cannot price (no target, no cost, pour not confirmed) is a
 * state, never a default margin. A dish gets none: there is no plate rule.
 */
import type { AdviceState } from "../pricing/margin-to-target";
import { adviseWineRow, type HouseTerms, type InventoryPriceRow, type KindAdvice } from "../pricing/margin-advice.service";

export interface MarginAt {
  /** Gross margin in percent at that price; null when the rule cannot state one. */
  marginPct: number | null;
  state: AdviceState;
}

export interface KindMargin {
  atHouseNow: MarginAt;
  atThisMenu: MarginAt;
  /** The house's target for this kind, in percent; null when none is set. */
  targetPct: number | null;
}

export interface MarginInputs {
  terms: HouseTerms;
  rows: Map<string, InventoryPriceRow>;
  lots: Map<string, Record<string, unknown>>;
}

function at(advice: KindAdvice | null): MarginAt {
  if (!advice) return { marginPct: null, state: "no_price" };
  return { marginPct: advice.currentMarginPct, state: advice.state };
}

/**
 * The margin of one plan line's bottle and glass, at the house's prices now
 * and at this menu's. Null for a kind neither price sells, and for a wine
 * the house has no row for (a new wine, a line not linked).
 */
export function planLineMargin(
  inputs: MarginInputs,
  inventoryId: string | null,
  prices: { houseBottle: number | null; houseGlass: number | null; menuBottle: number | null; menuGlass: number | null },
): { bottle: KindMargin | null; glass: KindMargin | null } {
  const row = inventoryId ? inputs.rows.get(inventoryId) : undefined;
  if (!row || !inventoryId) return { bottle: null, glass: null };
  const lot = inputs.lots.get(inventoryId) ?? null;
  const house = adviseWineRow({ ...row, menu_price_current: prices.houseBottle, menu_price_glass: prices.houseGlass }, lot, inputs.terms);
  const menu = adviseWineRow({ ...row, menu_price_current: prices.menuBottle, menu_price_glass: prices.menuGlass }, lot, inputs.terms);
  const kind = (h: KindAdvice | null, m: KindAdvice | null, targetPct: number | null): KindMargin | null =>
    h || m ? { atHouseNow: at(h), atThisMenu: at(m), targetPct } : null;
  return {
    bottle: kind(house.bottle, menu.bottle, inputs.terms.bottlePct),
    glass: kind(house.glass, menu.glass, inputs.terms.glassPct),
  };
}

/** True when this menu's price would land below the house's target ("raise" at this menu's price). */
export function landsBelowTarget(m: KindMargin | null | undefined): boolean {
  return !!m && m.atThisMenu.state === "raise";
}
