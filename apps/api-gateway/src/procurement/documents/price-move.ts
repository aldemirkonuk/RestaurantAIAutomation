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

const money = (v: number) => v.toFixed(2);

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

  const pct = ((next.cost - prev.cost) / prev.cost) * 100;
  const moved = Math.abs(pct) > thresholdPct;
  return {
    compared: true,
    pct,
    moved,
    sentence: moved
      ? `was ${money(prev.cost)}, now ${money(next.cost)}, ${pct > 0 ? "up" : "down"} ${Math.round(Math.abs(pct))} percent`
      : null,
  };
}
