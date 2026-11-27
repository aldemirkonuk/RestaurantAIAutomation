/**
 * Which line drives a serve's cost (r107 drinks-g5): each costed line's share
 * of the cost, in whole percent, by the largest-remainder rule so the shares
 * total exactly 100 (rounding each one alone gives 33+33+33 for thirds).
 * Ties go to the earlier line. A line with no price has no share, and when
 * any line has none the others are shares of the PRICED part only, never a
 * figure that reads as the whole serve (ADR 0051). No money is summed here for
 * display: the shares are ratios of the lines' own exact costs.
 */
export interface ShareInput {
  /** What names the line in the answer (its position in the list given). */
  label: string;
  /** The line's own cost a serve, exact when known; null when it has no price. */
  cost: number | null;
  /** False for a line the recipe leaves out of the cost (not counted): it is not a gap. */
  counted: boolean;
}

export interface LineShare {
  label: string;
  /** Whole percent; null when the line is not priced (or no total to share). */
  pct: number | null;
}

export interface LineShares {
  lines: LineShare[];
  /** True when a counted line has no price: the shares are of the priced part. */
  ofPricedPart: boolean;
}

export function lineShares(inputs: ShareInput[]): LineShares | null {
  const counted = inputs.filter((i) => i.counted);
  const priced = counted.filter((i) => i.cost != null && Number.isFinite(i.cost) && i.cost >= 0);
  const total = priced.reduce((a, i) => a + (i.cost as number), 0);
  if (!(total > 0)) return null;
  const exact = priced.map((i) => ((i.cost as number) / total) * 100);
  const base = exact.map(Math.floor);
  let left = 100 - base.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    base[i] += 1;
    left -= 1;
  }
  let k = 0;
  return {
    lines: counted.map((i) =>
      i.cost != null && Number.isFinite(i.cost) && i.cost >= 0 ? { label: i.label, pct: base[k++] } : { label: i.label, pct: null },
    ),
    ofPricedPart: priced.length < counted.length,
  };
}
