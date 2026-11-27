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

/** Whole percent, but one decimal near the threshold so "up 10 percent" never names a moved 10.4. */
const speakPct = (pct: number, thresholdPct: number) => {
  const a = Math.abs(pct);
  return Math.abs(a - thresholdPct) < 1 ? a.toFixed(1) : String(Math.round(a));
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
      ? `was ${money(prev.cost)}, now ${money(next.cost)}, ${pct > 0 ? "up" : "down"} ${speakPct(pct, thresholdPct)} percent`
      : null,
  };
}

/**
 * A line's printed price per bottle (r108 g15), `line_total / bottles`, before
 * any landed charge, tax basis, FX or revaluation: papers compare like for
 * like. Kept as integer cents over milli-bottles so a move is cross-multiplied,
 * never divided (12 at 100.00 is 10000/12000, not 8.333333333333334).
 */
export interface PerBottle {
  cents: bigint;
  milliBottles: bigint;
  /** For speaking only, rounded to the line's own 4 places. Never compared. */
  value: number;
}

export interface PrintedLine {
  line_total: number | string | null;
  qty_bottles: number | string | null;
  qty?: number | string | null;
  pack_size?: number | string | null;
  uom?: string | null;
}

/** A keg, a liter or an "each" has no bottle count. */
const BOTTLE_UNITS = /^(bottle|btl|bt|case|pack|split_case)$/i;

export function perBottlePrinted(line: PrintedLine): PerBottle | "no_price" | "unit_differs" {
  const total = line.line_total == null || line.line_total === "" ? NaN : Number(line.line_total);
  if (!Number.isFinite(total) || total <= 0) return "no_price";
  let bottles = line.qty_bottles == null || line.qty_bottles === "" ? NaN : Number(line.qty_bottles);
  // qty_bottles is left at its 0 default on some papers: count qty x pack.
  if (!(bottles > 0) && BOTTLE_UNITS.test((line.uom ?? "").trim())) {
    const qty = Number(line.qty);
    const pack = line.pack_size == null ? 1 : Number(line.pack_size);
    bottles = Number.isFinite(qty) && Number.isFinite(pack) ? qty * pack : NaN;
  }
  if (!Number.isFinite(bottles) || bottles <= 0) return "unit_differs";
  const cents = BigInt(Math.round(total * 100));
  const milliBottles = BigInt(Math.round(bottles * 1000));
  if (cents <= 0n || milliBottles <= 0n) return "no_price";
  const value = Math.round((Number(cents) * 10 * 1e4) / Number(milliBottles)) / 1e4;
  return { cents, milliBottles, value };
}

/** Sums two printed figures of the same good on one paper (two lines of it). */
export function addPerBottle(a: PerBottle, b: PerBottle): PerBottle {
  const cents = a.cents + b.cents;
  const milliBottles = a.milliBottles + b.milliBottles;
  return { cents, milliBottles, value: Math.round((Number(cents) * 10 * 1e4) / Number(milliBottles)) / 1e4 };
}

/** `priceMove`'s verdict, exact: |n1*d0 - n0*d1| * 100 > t * n0 * d1 in BigInt (past 2^53). */
export function printedPriceMove(
  prev: PerBottle | null | undefined,
  next: PerBottle,
  thresholdPct: number = DEFAULT_MOVE_THRESHOLD_PCT,
): PriceMove {
  if (!prev) return { compared: false, reason: "no_previous" };
  if (prev.cents === 0n) return { compared: false, reason: "previous_is_zero" };
  const diff = next.cents * prev.milliBottles - prev.cents * next.milliBottles;
  const base = prev.cents * next.milliBottles;
  const t = BigInt(Math.round(thresholdPct * MICRO));
  const moved = (diff < 0n ? -diff : diff) * 100n * BigInt(MICRO) > t * base;
  const pct = (Number(diff) / Number(base)) * 100;
  return {
    compared: true,
    pct,
    moved,
    sentence: moved
      ? `was ${money(prev.value)}, now ${money(next.value)}, ${pct > 0 ? "up" : "down"} ${speakPct(pct, thresholdPct)} percent`
      : null,
  };
}
