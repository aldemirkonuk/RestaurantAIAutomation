/**
 * This good's share of a serve's cost (r108 inventory g17): which recipes a
 * good drives, read from the good's side (meez/R365 costing by ingredient
 * contribution). Pure: no I/O.
 *
 * The same rule as the drink card's line share (DD-r107-44, not landed on
 * main, so it is written once here for the gateway): a share is a ratio of
 * the lines' own exact (six-place) costs, rounded once to a whole percent;
 * when a line of the serve has no price the share is of the PRICED part and
 * says so, never a figure that reads as the whole serve (ADR 0051); a line of
 * this good with no price gives no share at all, never 0 %.
 */

export interface PricedLine {
  inventoryId: string | null;
  /** The line's exact cost per serve; null when it is not priced. Untracked lines are not given. */
  exact: number | null;
}

export interface ItemShare {
  /** This good's lines' cost per serve, exact; null when one of them is not priced. */
  costPerServe: number | null;
  /** Whole percent of the serve's priced cost; null when not priced or nothing to share. */
  pct: number | null;
  /** True when the serve has a line with no price: the share is of the priced part. */
  ofPricedPart: boolean;
  priced: number;
  of: number;
  /** True when a line of this very good has no price: say "Not priced", never 0 %. */
  unpriced: boolean;
}

export function itemShareOfServe(lines: PricedLine[], itemId: string): ItemShare | null {
  const mine = lines.filter((l) => l.inventoryId === itemId);
  if (!mine.length) return null;
  const ok = (x: number | null): x is number => x !== null && Number.isFinite(x) && x >= 0;
  const priced = lines.filter((l) => ok(l.exact));
  const base = { priced: priced.length, of: lines.length, ofPricedPart: priced.length < lines.length };
  if (!mine.every((l) => ok(l.exact))) return { ...base, costPerServe: null, pct: null, unpriced: true };
  const good = mine.reduce((a, l) => a + (l.exact as number), 0);
  const total = priced.reduce((a, l) => a + (l.exact as number), 0);
  // Divided first, from the unrounded figures, and rounded once.
  const pct = total > 0 ? Math.round((good / total) * 100) : null;
  return { ...base, costPerServe: Math.round(good * 1e6) / 1e6, pct, unpriced: false };
}
