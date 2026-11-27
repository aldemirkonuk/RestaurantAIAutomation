/**
 * Has a line's cost moved against the good's last invoiced cost? (r104 g4)
 *
 * Until now a line was checked for price only against its purchase order
 * (`invoice-match.ts`, `price_variance`), so a paper with no PO (a distributor
 * feed, an emailed paper) booked a cost that jumped 18 percent with no warning.
 * This is the comparison and the sentence, nothing else: it is information, it
 * never blocks a verification and it never changes a cost.
 *
 * Refuses to compare rather than guess: no previous cost, no new price, a unit
 * that differs (a case against a bottle) or a previous cost of zero all answer
 * `compared: false` with the reason, so a screen never says "unchanged" for a
 * comparison it did not make (ADR 0020).
 */
export const DEFAULT_MOVE_THRESHOLD_PCT = 10;

export interface CostSeen {
  cost: number | null;
  /** What one unit of `cost` is, e.g. "bottle". Compared case-insensitively. */
  unit: string | null;
}

export type PriceMove =
  | { compared: false; reason: "no_previous" | "no_price" | "unit_differs" | "previous_is_zero" | "currency_differs" | "currency_unknown" }
  | {
      compared: true;
      /** Signed percent against the previous cost. */
      pct: number;
      /** Over the threshold, either way. */
      moved: boolean;
      sentence: string | null;
    };

/** Spoken to the stored precision (up to 6 places), never fewer than 2. */
const money = (v: number) => {
  const t = v.toFixed(6).replace(/0+$/, "");
  const [i, f = ""] = t.split(".");
  return `${i}.${f.padEnd(2, "0")}`;
};

/**
 * Whole percent, but one decimal near the threshold so "up 10 percent" never
 * names a moved 10.4. A moved percent is never spoken AS the threshold: 10.04
 * rounds to "10.0", which under a 10 percent rule reads as not over the line,
 * so it is spoken to two places, and if even that rounds onto the threshold it
 * is "just over".
 */
const speakPct = (pct: number, thresholdPct: number, moved: boolean) => {
  const a = Math.abs(pct);
  if (Math.abs(a - thresholdPct) >= 1) return String(Math.round(a));
  const one = a.toFixed(1);
  if (!moved || Number(one) !== thresholdPct) return one;
  const two = a.toFixed(2);
  return Number(two) !== thresholdPct ? two : `just over ${thresholdPct}`;
};

const MICRO = 1e6;

export function priceMove(
  prev: CostSeen | null | undefined,
  next: CostSeen,
  thresholdPct: number = DEFAULT_MOVE_THRESHOLD_PCT,
): PriceMove {
  if (next.cost == null || !Number.isFinite(next.cost)) return { compared: false, reason: "no_price" };
  if (!prev || prev.cost == null || !Number.isFinite(prev.cost))
    return { compared: false, reason: "no_previous" };
  const a = (prev.unit ?? "").trim().toLowerCase();
  const b = (next.unit ?? "").trim().toLowerCase();
  if (!a || !b || a !== b) return { compared: false, reason: "unit_differs" };
  if (prev.cost === 0) return { compared: false, reason: "previous_is_zero" };

  // Compare in integer micro-units with a cross-multiplied test: dividing in
  // binary floats made 1.00 -> 1.10 (exactly 10 percent) read 10.000000000000009.
  const a0 = Math.round(prev.cost * MICRO);
  const b0 = Math.round(next.cost * MICRO);
  if (a0 === 0) return { compared: false, reason: "previous_is_zero" };
  const pct = ((b0 - a0) / a0) * 100;
  const moved = Math.abs(b0 - a0) * 100 > thresholdPct * Math.abs(a0);
  return {
    compared: true,
    pct,
    moved,
    sentence: moved
      ? `was ${money(prev.cost)}, now ${money(next.cost)}, ${pct > 0 ? "up" : "down"} ${speakPct(pct, thresholdPct, moved)} percent`
      : null,
  };
}
