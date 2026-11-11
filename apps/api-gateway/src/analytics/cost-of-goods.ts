/**
 * Cost of goods is what sold (cost-math lane 3.1; ADR 0298 with its source
 * changed to the stamped draws, proposal fork F1).
 *
 * Two till reads meet here, both one jsonb value from a SECURITY INVOKER
 * function over the house (so PostgREST's 1,000-row cap never cuts them):
 *
 * - `pos_item_sales(house, since)` — net sales of stock items on closed,
 *   non-voided checks (ADR 0298 decisions 2 and 8);
 * - `pos_cost_of_goods(house, since)` — the cost each till movement's bottles
 *   carried when they left their lots, a matched void netted back, plus the
 *   late prices settled on those same sales; a late price settled in the
 *   window on a sale before it is named apart and is not in the cost, since
 *   that sale is not in the window's revenue (proposal F6; batch review
 *   2026-11-11; migration what_sold_cost_is_its_draws).
 *
 * The invariant: **an unknown cost is never 0.** `cost` in the second read
 * holds priced bottles only, so cost of goods is printed only when no moved
 * item has a bottle of unknown cost; otherwise it is withheld and the reason
 * says "cost known for N of M items" (founder, 2026-10-04: "Withhold, say N
 * of M"). The withheld total is not shrunk to the known part; the known part
 * is given apart, as the exact cost of the named items whose every bottle
 * carries its cost (`costOfCostedItems`), and it feeds no ratio: the items
 * left out are voids and glass pours, not a random sample, so a ratio over
 * the rest would lean one way. Pure: no I/O, no clock beyond the `now` it is
 * given.
 */

import * as E from "./engine";

export interface TillSalesRead {
  items?: Array<{
    inventory_id: string;
    sales: number | string;
    in_house?: boolean;
  }>;
  checks?: number;
  lines?: number;
  unmapped_lines?: number;
  unreadable_lines?: number;
}

export interface TillCostRead {
  items?: Array<{
    inventory_id: string;
    bottles_out: number | string;
    bottles_back: number | string;
    cost: number | string;
    settled_after_sale: number | string;
    settled_on_earlier_sales?: number | string;
    uncosted_out: number | string;
    uncosted_back: number | string;
    in_house?: boolean;
  }>;
  cost?: number | string | null;
  settled_after_sale?: number | string | null;
  settled_on_earlier_sales?: number | string | null;
  rows?: number;
  rows_unstamped?: number;
  first_move_at?: string | null;
}

export interface CogsCoverage {
  /** In-house items the till moved in the window. */
  itemsMoved: number;
  /** Of those, items every bottle of which (out and back) has a known cost. */
  itemsCosted: number;
  bottlesOut: number;
  bottlesBack: number;
  /** Bottles out or back whose cost is unknown. */
  bottlesUncosted: number;
  /** Of those, bottles a void gave back with no known cost (most often a void naming no sale). */
  bottlesBackUncosted: number;
  /** Till rows written before costs were stamped, or glass pours not yet stamped. */
  rowsUnstamped: number;
  /** Ledger rows naming an item that is not this house's: left out, and named. */
  itemsNotInHouse: number;
  /**
   * The summed cost of the `itemsCosted` items (six places, unrounded), or
   * null when one of them did not read as a number. Exact for those items;
   * not a floor of the total (a void given back at an unknown cost leaves its
   * sale's cost in the other items' rows).
   */
  costedItemsCost: number | null;
}

export interface SalesCoverage {
  checks: number;
  lines: number;
  unmappedLines: number;
  unreadableLines: number;
  itemsNotInHouse: number;
}

export interface TillFigures {
  cogs: number | null;
  /** The part of cogs that is late prices settled on the window's own sales; null with cogs. */
  settledAfterSale: number | null;
  /**
   * Late prices settled in the window on bottles sold BEFORE it: not in cogs
   * (their sales are not in this window's revenue), named so the correction
   * is seen when it became known (proposal F6). Feeds no ratio. Null when the
   * cost read failed or the figure did not read as a number.
   */
  settledOnEarlierSales: number | null;
  /**
   * While cogs is withheld: the exact cost of the items whose every bottle
   * carries its cost, with how many of how many items those are. Not the
   * cost of goods and feeds no ratio. Null when cogs is printed, or when no
   * item is costed.
   */
  costOfCostedItems: { amount: number; items: number; of: number } | null;
  revenue: number | null;
  grossMarginDollars: number | null;
  grossMargin: number | null;
  cogsRatio: number | null;
  primeCostRatio: number | null;
  inventoryTurnover: number | null;
  daysInventoryOutstanding: number | null;
  gmroi: number | null;
  cogsCoverage: CogsCoverage | null;
  salesCoverage: SalesCoverage | null;
  cogsWindow: { firstMoveAt: string | null; spanDays: number | null };
  basis: { cogs: string; revenue: string; costDerived: string };
}

/** Under this many days of till movement an annual rate is not a rate (ADR 0298 d4). */
export const MIN_SPAN_DAYS = 28;

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : NaN;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** What the cost read says about how much of the cost is known. */
export function cogsCoverageOf(read: TillCostRead): CogsCoverage {
  const items = read.items ?? [];
  const mine = items.filter((i) => i.in_house !== false);
  let bottlesOut = 0;
  let bottlesBack = 0;
  let bottlesUncosted = 0;
  let bottlesBackUncosted = 0;
  let itemsCosted = 0;
  let itemsMoved = 0;
  let costedItemsCost: number | null = 0;
  for (const i of mine) {
    const out = num(i.bottles_out);
    const back = num(i.bottles_back);
    const unc = num(i.uncosted_out) + num(i.uncosted_back);
    // A field that does not read as a number is an unknown, never 0: every
    // bottle the item moved is then counted as of unknown cost.
    const moved = (Number.isFinite(out) ? out : 0) + (Number.isFinite(back) ? back : 0);
    const uncosted = Number.isFinite(unc) ? unc : Math.max(moved, 1);
    // An item listed only for a late price settled in the window moved no
    // bottle here: its cost is in the total, but it is not an item sold.
    if (moved === 0 && uncosted === 0) continue;
    bottlesOut += Number.isFinite(out) ? out : 0;
    bottlesBack += Number.isFinite(back) ? back : 0;
    bottlesUncosted += uncosted;
    const backUnc = num(i.uncosted_back);
    if (Number.isFinite(backUnc)) bottlesBackUncosted += backUnc;
    itemsMoved += 1;
    const c = num(i.cost);
    if (uncosted === 0 && Number.isFinite(c)) {
      itemsCosted += 1;
      if (costedItemsCost != null) costedItemsCost += c;
    }
  }
  return {
    itemsMoved,
    itemsCosted,
    bottlesOut,
    bottlesBack,
    bottlesUncosted,
    bottlesBackUncosted,
    rowsUnstamped: num(read.rows_unstamped) || 0,
    itemsNotInHouse: items.length - mine.length,
    costedItemsCost,
  };
}

/**
 * The till's figures for one house. `sales` / `cost` are the two reads, or
 * `null` when that read failed (a failed read is null, never 0: ADR 0067).
 * `inventoryValue` is today's stock at cost, null unless every on-hand row is
 * costed (ADR 0051).
 */
export function tillFigures(input: {
  sales: TillSalesRead | null;
  cost: TillCostRead | null;
  inventoryValue: number | null;
  labor: number;
  now: Date;
  windowDays: number;
}): TillFigures {
  const { sales, cost, inventoryValue, labor, now, windowDays } = input;

  // ---- cost of what sold -------------------------------------------------
  let cogs: number | null = null;
  let settledAfterSale: number | null = null;
  let settledOnEarlierSales: number | null = null;
  let costOfCostedItems: TillFigures["costOfCostedItems"] = null;
  let cogsCoverage: CogsCoverage | null = null;
  let cogsBasis: string;
  const firstMoveAt = cost?.first_move_at ?? null;
  if (cost == null) {
    cogsBasis =
      "cost of what the till sold — null: the till's movements could not be read";
  } else {
    cogsCoverage = cogsCoverageOf(cost);
    const c = cogsCoverage;
    // An absent field is a read from before the function named it apart: 0
    // would be a claim, so it stays null.
    const earlier = num(cost.settled_on_earlier_sales);
    settledOnEarlierSales = Number.isFinite(earlier) ? round2(earlier) : null;
    if (c.itemsMoved === 0) {
      cogsBasis = `cost of what the till sold (${windowDays}d) — null: the till moved no stocked item in the window, and $0 would claim it sold nothing`;
    } else if (c.itemsCosted < c.itemsMoved) {
      const why: string[] = [];
      if (c.rowsUnstamped > 0)
        why.push(
          `${plural(c.rowsUnstamped, "till movement")} carried no cost (sold before costs were stamped, or a glass pour)`,
        );
      if (c.bottlesBackUncosted > 0)
        why.push(
          `${plural(c.bottlesBackUncosted, "bottle")} a void gave back named no sale to take its cost from`,
        );
      cogsBasis =
        `cost of what the till sold (${windowDays}d) — withheld: cost known for ${c.itemsCosted} of ${plural(c.itemsMoved, "item")} sold; ` +
        `${plural(c.bottlesUncosted, "bottle")} left or came back with no invoice cost yet` +
        (why.length ? ` (${why.join("; ")})` : "") +
        ". A smaller number under this label would be a guess.";
      if (c.itemsCosted > 0 && c.costedItemsCost != null) {
        costOfCostedItems = {
          amount: round2(c.costedItemsCost),
          items: c.itemsCosted,
          of: c.itemsMoved,
        };
        cogsBasis += ` The ${plural(c.itemsCosted, "item")} whose every bottle carries its cost cost ${costOfCostedItems.amount.toFixed(2)} (costOfCostedItems): exact for those items, not the cost of goods, and divided by nothing.`;
      }
    } else {
      const total = num(cost.cost);
      if (!Number.isFinite(total)) {
        cogsBasis =
          "cost of what the till sold — null: the cost total did not read as a number";
      } else {
        cogs = round2(total);
        const settled = num(cost.settled_after_sale);
        settledAfterSale = Number.isFinite(settled) ? round2(settled) : null;
        cogsBasis =
          `cost of what the till sold (${windowDays}d): each bottle at the cost it carried when it left its lot, voids given back at their sale's cost — ` +
          `${plural(c.itemsMoved, "item")}, ${plural(c.bottlesOut - c.bottlesBack, "bottle")} net` +
          (settledAfterSale != null && settledAfterSale !== 0
            ? `, of which ${settledAfterSale.toFixed(2)} is late prices on these sales, settled by invoices verified after the bottles sold`
            : "") +
          ". Waste, breakage, count corrections and off-till sales are not in it.";
      }
    }
    if (settledOnEarlierSales != null && settledOnEarlierSales !== 0)
      cogsBasis += ` Late prices settled in the window on bottles sold before it, ${settledOnEarlierSales.toFixed(2)}, are named apart (settledOnEarlierSales) and are not in it: those sales are not in this window's net sales.`;
  }

  // ---- net sales of stocked items ---------------------------------------
  let revenue: number | null = null;
  let salesCoverage: SalesCoverage | null = null;
  let revenueBasis: string;
  if (sales == null) {
    revenueBasis = "net till sales of stocked items — null: the till could not be read";
  } else {
    const items = sales.items ?? [];
    const mine = items.filter((i) => i.in_house !== false);
    salesCoverage = {
      checks: num(sales.checks) || 0,
      lines: num(sales.lines) || 0,
      unmappedLines: num(sales.unmapped_lines) || 0,
      unreadableLines: num(sales.unreadable_lines) || 0,
      itemsNotInHouse: items.length - mine.length,
    };
    const total = mine.reduce((s, i) => s + num(i.sales), 0);
    if (salesCoverage.checks === 0) {
      revenueBasis = `net till sales of stocked items (${windowDays}d) — null: no closed check in the window`;
    } else if (salesCoverage.unreadableLines > 0) {
      revenueBasis = `net till sales of stocked items (${windowDays}d) — null: ${plural(salesCoverage.unreadableLines, "till line")} could not be read, so a total would be a floor`;
    } else if (!Number.isFinite(total)) {
      revenueBasis = `net till sales of stocked items (${windowDays}d) — null: a line's sales did not read as a number`;
    } else {
      revenue = round2(total);
      revenueBasis =
        `net till sales of stocked items (${windowDays}d), before tax and surcharge — ${plural(salesCoverage.checks, "check")}` +
        (salesCoverage.unmappedLines > 0
          ? `; ${plural(salesCoverage.unmappedLines, "line")} naming no stocked item (food, unmapped) not in it`
          : "") +
        ". A glass from a bottle opened before the window sells with no bottle moving.";
    }
  }

  // ---- what divides by what ---------------------------------------------
  const both = cogs != null && revenue != null && revenue > 0;
  const grossMarginDollars =
    cogs != null && revenue != null ? round2(revenue - cogs) : null;
  // The engine's own functions, so the metric registry's engineFns stay true.
  const grossMargin = both ? E.finance.grossMargin(cogs!, revenue!) : null;
  const cogsRatio = both ? E.finance.cogsRatio(cogs!, revenue!) : null;
  const primeCostRatio = both
    ? E.finance.primeCostRatio(cogs!, labor || 0, revenue!)
    : null;

  // Turnover, DIO and GMROI annualise the span the till actually covers.
  let spanDays: number | null = null;
  if (firstMoveAt) {
    const t = Date.parse(firstMoveAt);
    if (Number.isFinite(t))
      spanDays = Math.min(
        windowDays,
        Math.max(0, Math.floor((now.getTime() - t) / 86400000) + 1),
      );
  }
  const spanOk = spanDays != null && spanDays >= MIN_SPAN_DAYS;
  const annual = (x: number) => (x * 365) / (spanDays as number);
  const inventoryTurnover =
    spanOk && cogs != null && inventoryValue != null
      ? E.inventory.inventoryTurnover(annual(cogs), inventoryValue)
      : null;
  const daysInventoryOutstanding =
    spanOk && cogs != null && inventoryValue != null
      ? E.inventory.daysInventoryOutstanding(cogs, inventoryValue, spanDays as number)
      : null;
  const gmroi =
    spanOk && grossMarginDollars != null && inventoryValue != null
      ? E.inventory.gmroi(annual(grossMarginDollars), inventoryValue)
      : null;

  return {
    cogs,
    settledAfterSale,
    settledOnEarlierSales,
    costOfCostedItems,
    revenue,
    grossMarginDollars,
    grossMargin,
    cogsRatio,
    primeCostRatio,
    inventoryTurnover,
    daysInventoryOutstanding,
    gmroi,
    cogsCoverage,
    salesCoverage,
    cogsWindow: { firstMoveAt, spanDays },
    basis: {
      cogs: cogsBasis,
      revenue: revenueBasis,
      costDerived:
        "grossMarginDollars, grossMargin, cogsRatio and primeCostRatio divide the cost of what the till sold by its net sales of the same items, and are null when either is; " +
        `inventoryTurnover, daysInventoryOutstanding and gmroi annualise the span the till covers (null under ${MIN_SPAN_DAYS} days) against today's stock at cost, which is null unless every bottle on hand carries a recorded cost (ADR 0051). ` +
        "settledOnEarlierSales (late prices settled in the window on bottles sold before it), costOfCostedItems, deliveredPurchases and shelfValueAtMenuPrice keep their own names and feed no ratio.",
    },
  };
}

/** The same figures withheld, for a caller who does not see sales (ADR 0298 d9). */
export function withheldTillFigures(windowDays: number): TillFigures {
  const w = "withheld: the till's figures reach owners and managers only";
  return {
    cogs: null,
    settledAfterSale: null,
    settledOnEarlierSales: null,
    costOfCostedItems: null,
    revenue: null,
    grossMarginDollars: null,
    grossMargin: null,
    cogsRatio: null,
    primeCostRatio: null,
    inventoryTurnover: null,
    daysInventoryOutstanding: null,
    gmroi: null,
    cogsCoverage: null,
    salesCoverage: null,
    cogsWindow: { firstMoveAt: null, spanDays: null },
    basis: {
      cogs: `cost of what the till sold (${windowDays}d) — ${w}`,
      revenue: `net till sales of stocked items (${windowDays}d) — ${w}`,
      costDerived: `every figure divided by sales or by the cost of what sold — ${w}`,
    },
  };
}
