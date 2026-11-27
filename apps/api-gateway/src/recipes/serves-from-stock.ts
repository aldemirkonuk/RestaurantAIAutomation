/**
 * How many serves the stock on hand makes (r108 inventory g11): theoretical
 * consumption run in reverse. One serve takes, of this good, the sum of its
 * lines' amounts (grossed up to what is bought, as a line is costed) over the
 * recipe's yield; the stock on hand, turned into the same base units by the
 * factors a line's cost divides by, is divided by that. Pure: no I/O.
 *
 * A quantity is not money, so every role reads it. Unknown is null with the
 * reason, never 0: 0 is said only when the shelf holds nothing (or less).
 */
import { BaseUnit, CostItem, ShelfWhy, baseUnitsPerShelf, boughtPerUsed } from "./recipe-cost";

export type ServesWhy = ShelfWhy | "no_yield" | "stock_unread" | "never_counted";

export interface ServesFromStock {
  servesFromStock: number | null;
  servesWhy: ServesWhy | null;
}

export interface ServesLine {
  qtyBase: number | string;
  baseUnit: BaseUnit;
  usablePct?: number | string | null;
}

/** The on-hand count of the good, in its own unit, beside what the cost reads. */
export type StockItem = CostItem & {
  stock_live?: number | string | null;
  /**
   * stock_live is `integer DEFAULT 0 NOT NULL`, so a good never counted and
   * never delivered reads 0, the same as a shelf counted empty. These two say
   * which: a 0 with no count and no lot is "never counted", not "no stock".
   */
  last_counted_at?: string | null;
  has_lots?: boolean;
};

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const unknown = (why: ServesWhy | null): ServesFromStock => ({ servesFromStock: null, servesWhy: why });

export function servesFromStock(item: StockItem | null, lines: ServesLine[], yieldServes: number | null): ServesFromStock {
  if (!item || item.stock_live === null || item.stock_live === undefined || item.stock_live === "") return unknown("stock_unread");
  const onHand = Number(item.stock_live);
  if (!Number.isFinite(onHand)) return unknown("stock_unread");
  // The column's default 0 is not a count: no count and no lot is unknown, not an empty shelf.
  if (onHand <= 0 && item.last_counted_at === null && item.has_lots === false) return unknown("never_counted");
  // Nothing on the shelf (a count below zero included) makes no serve, whatever the recipe says.
  if (onHand <= 0) return { servesFromStock: 0, servesWhy: null };
  const serves = Number(yieldServes);
  if (!Number.isInteger(serves) || serves <= 0) return unknown("no_yield");

  // Shelf units one serve takes: each line in its own base unit, so a recipe
  // that weighs one line and pours another still adds up.
  let shelfPerServe = 0;
  for (const l of lines) {
    const f = baseUnitsPerShelf(item, l.baseUnit);
    if ("why" in f) return unknown(f.why);
    const bought = Number(l.qtyBase) * boughtPerUsed(l.usablePct);
    if (!Number.isFinite(bought) || bought < 0) return unknown(null);
    shelfPerServe += bought / f.perShelf / serves;
  }
  // A recipe that takes none of the good is not "enough for ever": not said.
  if (!(shelfPerServe > 0)) return unknown(null);
  // Six places of working precision, then whole serves only.
  return { servesFromStock: Math.floor(round6(onHand / shelfPerServe)), servesWhy: null };
}
