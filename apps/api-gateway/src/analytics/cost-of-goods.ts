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
    /** A mapping of this house points at the item (listed even if it never sold). */
    mapped?: boolean;
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
 * Today's stock at cost of the goods the till reaches (reports lane r2,
 * 2026-11-11; the #1088 residual "turns and days of stock compare unlike
 * bases").
 *
 * Turns, days of stock and GMROI divide the cost of what the till sold by the
 * stock it sold from. The cost of what sold holds only goods the till reaches:
 * a sale on a line that names no stocked good moves no bottle and carries no
 * cost. Divided into the whole cellar, every good the till cannot sell (a wine
 * not mapped to a till item, a kitchen good) added days of stock that no sale
 * could ever take away, so an unmapped wine read as idle stock.
 *
 * A good the till reaches: one the sales read lists for this house (a mapping
 * points at it, or a line named it, or the till moved it in the window), or
 * one the cost read lists. The rest are named apart, with their value at cost,
 * and feed no ratio. The invariant ADR 0051 set for the whole cellar holds
 * here: the value is null unless every on-hand good the till reaches carries a
 * recorded cost, never a total of the costed part. An unpriced good the till
 * does not reach no longer withholds it.
 *
 * Null when the sales read failed: without it the mapped goods that did not
 * sell are unknown, and a smaller stock would shorten days of stock.
 */
export interface TillStock {
  value: number | null;
  /** On-hand goods (rows holding a bottle or more). */
  goodsOnHand: number;
  /** Of those, the goods the till reaches. */
  goodsOnTill: number;
  /** Of those the till reaches, how many carry no recorded cost. */
  uncostedOnTill: number;
  /**
   * Of those the till reaches, how many sold nothing in the window (a mapped
   * item no line named with a sale, no bottle moved). They stay in the base:
   * a slow or idle seller is stock the till can sell, and leaving it out
   * would shorten days of stock. Named so the reader can tell them apart.
   */
  idleOnTill: number;
  /** Their value at cost, or null when one of them has no recorded cost. */
  idleOnTillValue: number | null;
  /** On-hand goods the till does not reach: left out of every ratio. */
  goodsOffTill: number;
  /** Their value at cost, or null when one of them has no recorded cost. */
  offTillValue: number | null;
}

export function tillStockOf(input: {
  onHand: Array<{ id: string; inventoryValue: number | null }>;
  sales: TillSalesRead | null;
  cost: TillCostRead | null;
}): TillStock | null {
  const { onHand, sales, cost } = input;
  if (sales == null) return null;
  const reached = new Set<string>();
  for (const i of sales.items ?? []) if (i.in_house !== false) reached.add(String(i.inventory_id));
  for (const i of cost?.items ?? []) if (i.in_house !== false) reached.add(String(i.inventory_id));
  const on = onHand.filter((g) => reached.has(String(g.id)));
  const off = onHand.filter((g) => !reached.has(String(g.id)));
  const known = (v: number | null): v is number => typeof v === "number" && Number.isFinite(v);
  const uncostedOnTill = on.filter((g) => !known(g.inventoryValue)).length;
  const sum = (gs: typeof onHand) =>
    gs.reduce((a, g) => a + (g.inventoryValue as number), 0);
  // Sold in the window: a sale on the till, or a bottle the till moved.
  const sold = new Set<string>();
  for (const i of sales.items ?? []) if (num(i.sales) > 0) sold.add(String(i.inventory_id));
  for (const i of cost?.items ?? [])
    if (num(i.bottles_out) > 0 || num(i.bottles_back) > 0) sold.add(String(i.inventory_id));
  const idle = on.filter((g) => !sold.has(String(g.id)));
  return {
    // No on-hand good the till reaches is "none, or no answer" (the loader
    // degrades a failed read to []), so null, never 0 days.
    value: on.length > 0 && uncostedOnTill === 0 ? sum(on) : null,
    goodsOnHand: onHand.length,
    goodsOnTill: on.length,
    uncostedOnTill,
    idleOnTill: idle.length,
    idleOnTillValue: idle.every((g) => known(g.inventoryValue)) ? round2(sum(idle)) : null,
    goodsOffTill: off.length,
    offTillValue: off.every((g) => known(g.inventoryValue)) ? round2(sum(off)) : null,
  };
}

/** What the stock base of turns, days of stock and GMROI covered. */
/*
 * The working the house reads under "Show the working" and in the report
 * export (which prints it verbatim). It names each figure by the label the
 * page gives it, never by its field name, and says "left blank" for an
 * unknown: no camelCase, no `null`, no `$`, no "365d" (r11, 2026-11-12).
 */
function days(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}
const COST_DERIVED_RATIOS =
  "Kept, kept of sales, cost of sales and prime cost divide the cost of what the till sold by its net sales of the same items, and are left blank when either is. ";
const COST_DERIVED_APART =
  "Late prices settled in the window on bottles sold before it, the cost of the items whose cost is known, what was bought, and the shelf at menu price are each shown apart and feed no ratio.";

function tillStockSentence(t: TillStock | null): string {
  if (t == null) return ": left blank, since the till's sales could not be read and the goods it reaches are unknown";
  const parts = [`: ${t.goodsOnTill} of ${plural(t.goodsOnHand, "good")} on hand`];
  if (t.uncostedOnTill > 0)
    parts.push(`, ${t.uncostedOnTill} of them with no recorded cost`);
  if (t.idleOnTill > 0)
    parts.push(
      `, ${t.idleOnTill} of them sold nothing in the window` +
        (t.idleOnTillValue != null ? ` (${t.idleOnTillValue.toFixed(2)} at cost)` : "") +
        ` and ${t.idleOnTill === 1 ? "stays" : "stay"} in, since the till can sell ${t.idleOnTill === 1 ? "it" : "them"}`,
    );
  if (t.goodsOffTill > 0)
    parts.push(
      `; the ${plural(t.goodsOffTill, "good")} the till does not reach` +
        (t.offTillValue != null ? `, ${t.offTillValue.toFixed(2)} at cost,` : "") +
        " are left out, since nothing they sell reaches the cost of what sold",
    );
  return parts.join("");
}

/**
 * The till's figures for one house. `sales` / `cost` are the two reads, or
 * `null` when that read failed (a failed read is null, never 0: ADR 0067).
 * `tillStock` is today's stock at cost of the goods the till reaches
 * (`tillStockOf`), the base turns, days of stock and GMROI divide by.
 */
export function tillFigures(input: {
  sales: TillSalesRead | null;
  cost: TillCostRead | null;
  tillStock: TillStock | null;
  labor: number;
  now: Date;
  windowDays: number;
}): TillFigures {
  const { sales, cost, tillStock, labor, now, windowDays } = input;
  const inventoryValue = tillStock?.value ?? null;

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
      "Cost of what the till sold — left blank: the till's movements could not be read";
  } else {
    cogsCoverage = cogsCoverageOf(cost);
    const c = cogsCoverage;
    // An absent field is a read from before the function named it apart: 0
    // would be a claim, so it stays null.
    const earlier = num(cost.settled_on_earlier_sales);
    settledOnEarlierSales = Number.isFinite(earlier) ? round2(earlier) : null;
    if (c.itemsMoved === 0) {
      cogsBasis = `Cost of what the till sold (${days(windowDays)}) — left blank: the till moved no stocked item in the window, and a zero would claim it sold nothing`;
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
        `Cost of what the till sold (${days(windowDays)}) — left blank: cost known for ${c.itemsCosted} of ${plural(c.itemsMoved, "item")} sold; ` +
        `${plural(c.bottlesUncosted, "bottle")} left or came back with no invoice cost yet` +
        (why.length ? ` (${why.join("; ")})` : "") +
        ". A smaller number under this label would be a guess.";
      if (c.itemsCosted > 0 && c.costedItemsCost != null) {
        costOfCostedItems = {
          amount: round2(c.costedItemsCost),
          items: c.itemsCosted,
          of: c.itemsMoved,
        };
        cogsBasis += ` The ${plural(c.itemsCosted, "item")} whose every bottle carries its cost came to ${costOfCostedItems.amount.toFixed(2)} at cost: exact for those items, not the cost of goods, and divided by nothing.`;
      }
    } else {
      const total = num(cost.cost);
      if (!Number.isFinite(total)) {
        cogsBasis =
          "Cost of what the till sold — left blank: the cost total did not read as a number";
      } else {
        cogs = round2(total);
        const settled = num(cost.settled_after_sale);
        settledAfterSale = Number.isFinite(settled) ? round2(settled) : null;
        cogsBasis =
          `Cost of what the till sold (${days(windowDays)}): each bottle at the cost it carried when it left its lot, voids given back at their sale's cost — ` +
          `${plural(c.itemsMoved, "item")}, ${plural(c.bottlesOut - c.bottlesBack, "bottle")} net` +
          (settledAfterSale != null && settledAfterSale !== 0
            ? `, of which ${settledAfterSale.toFixed(2)} is late prices on these sales, settled by invoices verified after the bottles sold`
            : "") +
          ". Waste, breakage, count corrections and off-till sales are not in it.";
      }
    }
    if (settledOnEarlierSales != null && settledOnEarlierSales !== 0)
      cogsBasis += ` Late prices settled in the window on bottles sold before it, ${settledOnEarlierSales.toFixed(2)}, are named apart and are not in it: those sales are not in this window's net sales.`;
  }

  // ---- net sales of stocked items ---------------------------------------
  let revenue: number | null = null;
  let salesCoverage: SalesCoverage | null = null;
  let revenueBasis: string;
  if (sales == null) {
    revenueBasis = "Net till sales of stocked items — left blank: the till could not be read";
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
      revenueBasis = `Net till sales of stocked items (${days(windowDays)}) — left blank: no closed check in the window`;
    } else if (salesCoverage.unreadableLines > 0) {
      revenueBasis = `Net till sales of stocked items (${days(windowDays)}) — left blank: ${plural(salesCoverage.unreadableLines, "till line")} could not be read, so a total would be a floor`;
    } else if (!Number.isFinite(total)) {
      revenueBasis = `Net till sales of stocked items (${days(windowDays)}) — left blank: a line's sales did not read as a number`;
    } else {
      revenue = round2(total);
      revenueBasis =
        `Net till sales of stocked items (${days(windowDays)}), before tax and surcharge — ${plural(salesCoverage.checks, "check")}` +
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
        COST_DERIVED_RATIOS +
        `Inventory turns, days of inventory and the return on stock scale the days the till covers to a year (left blank under ${MIN_SPAN_DAYS} days) and set that against today's stock at cost of the goods the till reaches (mapped to a till item, or sold or moved by it in the window), which is left blank unless every one of them on hand carries a recorded cost (a row whose invoiced cost covers only part of its bottles is valued at that cost, as the cellar's working says)` +
        tillStockSentence(tillStock) +
        ". " +
        COST_DERIVED_APART,
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
      cogs: `Cost of what the till sold (${days(windowDays)}) — ${w}`,
      revenue: `Net till sales of stocked items (${days(windowDays)}) — ${w}`,
      costDerived: `Every figure divided by sales or by the cost of what sold — ${w}`,
    },
  };
}
