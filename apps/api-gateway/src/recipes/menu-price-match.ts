import { isKitchenLine } from "../menus/menu-line-view";
import { foldName } from "./name-fold";

/**
 * The price the house's current menu gives a dish or a drink of the same name,
 * set beside the price on its recipe row (r28 recipes audit, gap 2, slice 1).
 *
 * WHY. A house uploads its menu, then types every dish and drink again on
 * /dishes and /cocktails with a second price, and the food and pour cost
 * shares divide by that second price. Nothing showed when the two disagreed.
 * This slice only SHOWS the menu's price and whether it agrees; nothing is
 * written or linked (menu lines are per upload, so a stored link would be
 * lost on the next upload).
 *
 * THE MATCH. By name under `foldName` (case, the dotless ı, accents, spaces).
 * A dish looks first at the menu's kitchen lines and a drink at the rest, so a
 * "Margarita" pizza and a "Margarita" cocktail each find their own line; when
 * its own side has no line of that name, every line of that name is used.
 * Several lines that state the same prices (the same menu kept current twice)
 * are one answer. Several that disagree are "several", never a guess.
 */

/** The columns read from a current-menu line. */
export interface MenuLine {
  name: unknown;
  category: unknown;
  bottle_price: unknown;
  by_glass_price: unknown;
}

export type MenuPrice =
  /**
   * One answer. `prices` are the line's distinct prices, lowest first (a line
   * can state a bottle and a glass price). `agrees` is null when either side
   * has no price; otherwise whether the row's price is one of them, to the cent.
   */
  | { found: "one"; prices: number[]; agrees: boolean | null }
  | { found: "none" }
  /** Lines of this name that state different prices. */
  | { found: "several"; lines: number };

type Indexed = { kitchen: boolean; prices: number[] };
export type MenuIndex = Map<string, Indexed[]>;

const cents = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

/** The menu's lines, by folded name. A line with no name is left out. */
export function menuIndex(lines: MenuLine[]): MenuIndex {
  const out: MenuIndex = new Map();
  for (const l of lines) {
    if (typeof l.name !== "string") continue;
    const key = foldName(l.name);
    if (!key) continue;
    const prices = [...new Set([cents(l.bottle_price), cents(l.by_glass_price)].filter((p): p is number => p !== null))].sort(
      (a, b) => a - b,
    );
    out.set(key, [...(out.get(key) ?? []), { kitchen: isKitchenLine(l.category, null), prices }]);
  }
  return out;
}

/**
 * What the menu says for one row. `names` are tried in order (a drink's shown
 * name, then its own name); the first that names a line answers.
 */
export function menuPriceFor(names: Array<string | null | undefined>, side: "dish" | "drink", rowPrice: unknown, index: MenuIndex): MenuPrice {
  for (const name of names) {
    if (typeof name !== "string") continue;
    const all = index.get(foldName(name)) ?? [];
    if (all.length === 0) continue;
    const own = all.filter((l) => l.kitchen === (side === "dish"));
    const hits = own.length > 0 ? own : all;
    const first = hits[0].prices.join("|");
    if (!hits.every((h) => h.prices.join("|") === first)) return { found: "several", lines: hits.length };
    const prices = hits[0].prices;
    const row = cents(rowPrice);
    return {
      found: "one",
      prices,
      agrees: row === null || prices.length === 0 ? null : prices.some((p) => Math.abs(p - row) < 0.005),
    };
  }
  return { found: "none" };
}
