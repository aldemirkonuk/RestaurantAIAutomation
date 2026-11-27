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

const BOTTLE = /^(bottle|btl|bt)$/i;

export interface PricedLine {
  uom: string | null;
  unit_price: number | string | null;
  /** The quantity the printed price is for (a price per 6), when the paper said. */
  price_base_qty?: number | string | null;
  /** The unit that quantity is in; null means the line's own unit. */
  price_base_uom?: string | null;
}

/**
 * The line's price per ONE bottle, or null when the price is not for bottles
 * (per case, per litre, a unit this does not know). A price printed per 6
 * bottles is divided by 6; it is never read as the price of one.
 */
export function perBottleCost(l: PricedLine): number | null {
  const base = (l.price_base_uom ?? l.uom ?? "").trim();
  if (!BOTTLE.test(base) || l.unit_price == null) return null;
  const qty = l.price_base_qty == null ? 1 : Number(l.price_base_qty);
  const price = Number(l.unit_price);
  if (!Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) return null;
  return price / qty;
}

/**
 * True when a line's raw `unit_price` IS a per-bottle cost: lots store the
 * invoice line's raw unit_price whatever its unit, so only a plain per-bottle
 * source line makes a lot's cost comparable with a per-bottle price.
 */
export function isPlainPerBottle(l: PricedLine): boolean {
  if (!BOTTLE.test((l.price_base_uom ?? l.uom ?? "").trim())) return false;
  return l.price_base_qty == null || Number(l.price_base_qty) === 1;
}
