import type { TillCostRead } from "./cost-of-goods";

/**
 * WHICH GOODS HOLD BACK THE COST OF WHAT SOLD (r36 invoices audit R2).
 *
 * The figures of record withhold "what it cost" while any item the till moved
 * left with no cost, and said only "cost known for N of M items sold". The
 * owner could not tell which goods to fix: the read already carried each
 * item's `uncosted_out`, but the page kept counts only. This names them.
 *
 * Rules:
 *  - The same per-item rule as `cogsCoverageOf`: an item of another house is
 *    left out; a field that does not read as a number is an unknown, so that
 *    item is named; an item with nothing uncosted is not.
 *  - Names come from the house's own inventory. A good no longer on it (made
 *    inactive since the sale) is named as such, never by its id.
 *  - At most `cap` goods are named, alphabetically; the rest are counted.
 *    They are NOT ranked by how much is uncosted: that count is in each
 *    good's own unit (bottles for a wine, grams for flour), so "most" across
 *    goods would compare grams with bottles. Every named good holds the
 *    figure back on its own; fixing any one is not enough.
 *
 * Feeds no figure. Null when nothing is held back.
 */
export interface HeldBackGood {
  inventoryId: string;
  /** The house's name for it, or null when it is no longer on the house's list. */
  name: string | null;
}

export interface CogsHeldBack {
  goods: HeldBackGood[];
  /** Goods held back beyond the ones named. */
  more: number;
}

export const HELD_BACK_NAMED = 8;

const num = (v: unknown): number => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : NaN;
};

export function cogsHeldBackOf(
  read: TillCostRead,
  names: ReadonlyMap<string, string | null>,
  cap = HELD_BACK_NAMED,
): CogsHeldBack | null {
  const held: HeldBackGood[] = [];
  const seen = new Set<string>();
  for (const i of read.items ?? []) {
    if (i.in_house === false) continue;
    if (seen.has(i.inventory_id)) continue;
    const unc = num(i.uncosted_out) + num(i.uncosted_back);
    // An unreadable count is an unknown, never 0: the item is named.
    if (Number.isFinite(unc) && unc <= 0) continue;
    seen.add(i.inventory_id);
    const name = names.get(i.inventory_id);
    held.push({ inventoryId: i.inventory_id, name: typeof name === "string" && name.trim() !== "" ? name : null });
  }
  if (held.length === 0) return null;
  held.sort((a, b) => {
    // Named goods first, alphabetically; goods off the list last, by id so
    // the order is stable between reads.
    if (a.name === null && b.name !== null) return 1;
    if (b.name === null && a.name !== null) return -1;
    const byName = (a.name ?? "").localeCompare(b.name ?? "");
    return byName !== 0 ? byName : a.inventoryId.localeCompare(b.inventoryId);
  });
  const n = Math.max(0, Math.floor(cap));
  return { goods: held.slice(0, n), more: Math.max(0, held.length - n) };
}
