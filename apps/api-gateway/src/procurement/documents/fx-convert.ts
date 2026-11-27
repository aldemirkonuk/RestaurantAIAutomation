import type { DocumentMoney, LineMoney } from "./invoice-currency";

/**
 * Costing a paper in another currency than the house's (r104 g1). A manager
 * names a rate and the day it is from; this is the arithmetic only.
 *   - Unit prices keep six places; every other figure is whole cents.
 *   - A paper that ties out (lines + charges - discount = total) is made to tie
 *     to its converted total by largest remainder: floor each figure, give the
 *     missing cents to those that lost the most.
 *   - A paper that does not tie out is converted figure by figure, so the gap
 *     the tie-out reports afterwards is the vendor's own, not ours.
 */

/** Whole cents, as an integer, without a float landing on x.4999999. */
const cents = (v: number): number => Math.round(v * 100);
const EPS = 1e-9;

export function rateProblem(rate: unknown): string | null {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0)
    return "The exchange rate has to be a number above zero.";
  if (rate > 1_000_000) return "That exchange rate is too large to be a rate.";
  return null;
}

/** Six places, for a unit price. */
export function toSixPlaces(v: number, rate: number): number {
  return Math.round(v * rate * 1e6) / 1e6;
}

/**
 * Largest remainder over signed whole-cent figures.
 * `exact` are the converted figures in (fractional) cents; the answer sums to
 * `targetCents` exactly.
 */
export function apportionCents(exact: readonly number[], targetCents: number): number[] {
  const floors = exact.map((x) => Math.floor(x + EPS));
  let missing = targetCents - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = floors.slice();
  let k = 0;
  while (missing !== 0 && order.length) {
    const step = missing > 0 ? 1 : -1;
    out[order[k % order.length].i] += step;
    missing -= step;
    k++;
  }
  return out;
}

const CHARGES = [
  "freight",
  "fuel_surcharge",
  "split_case_fee",
  "delivery_fee",
  "deposit_total",
  "tax",
  "other_charges",
] as const;

/**
 * Convert a plan's money. Returns new objects; the tie-out fields are left
 * `null` for the caller to re-derive through `applyTieOut`.
 */
export function convertMoney(
  header: DocumentMoney,
  lines: readonly LineMoney[],
  rate: number,
): { header: DocumentMoney; lines: LineMoney[]; forcedToTie: boolean } {
  const bad = rateProblem(rate);
  if (bad) throw new Error(`BAD_RATE:${bad}`);

  const alone = (v: number | null): number | null =>
    v == null ? null : cents(v * rate) / 100;

  type Slot = { sign: 1 | -1; v: number; set: (c: number) => void };
  const out: DocumentMoney = {
    ...header,
    subtotal: alone(header.subtotal),
    freight: alone(header.freight),
    fuel_surcharge: alone(header.fuel_surcharge),
    split_case_fee: alone(header.split_case_fee),
    delivery_fee: alone(header.delivery_fee),
    deposit_total: alone(header.deposit_total),
    tax: alone(header.tax),
    other_charges: alone(header.other_charges),
    discount_total: alone(header.discount_total),
    total: alone(header.total),
    computed_lines_total: null,
    tie_out_delta: null,
    ties_out: null,
  };
  const outLines: LineMoney[] = lines.map((l) => ({
    line_no: l.line_no,
    unit_price: l.unit_price == null ? null : toSixPlaces(l.unit_price, rate),
    line_total: alone(l.line_total),
    allowance: alone(l.allowance),
    deposit: alone(l.deposit),
  }));

  const slots: Slot[] = [];
  lines.forEach((l, i) => {
    if (l.line_total != null)
      slots.push({ sign: 1, v: l.line_total, set: (c) => (outLines[i].line_total = c / 100) });
  });
  for (const k of CHARGES)
    if (header[k] != null)
      slots.push({ sign: 1, v: header[k] as number, set: (c) => (out[k] = c / 100) });
  if (header.discount_total != null)
    slots.push({ sign: -1, v: header.discount_total, set: (c) => (out.discount_total = c / 100) });

  let forcedToTie = false;
  if (header.total != null && slots.length > 0) {
    const originalCents = slots.reduce((a, s) => a + s.sign * cents(s.v), 0);
    if (originalCents === cents(header.total)) {
      const exact = slots.map((s) => s.sign * cents(s.v) * rate);
      const target = cents(header.total * rate);
      const done = apportionCents(exact, target);
      slots.forEach((s, i) => s.set(s.sign * done[i]));
      if (header.subtotal != null) {
        const lineSum = lines.reduce((a, l) => a + (l.line_total == null ? 0 : cents(l.line_total)), 0);
        if (lineSum === cents(header.subtotal))
          out.subtotal =
            outLines.reduce((a, l) => a + (l.line_total == null ? 0 : cents(l.line_total)), 0) / 100;
      }
      forcedToTie = true;
    }
  }
  return { header: out, lines: outLines, forcedToTie };
}

/** "1 EUR = 1.0840 USD on 20 Nov" — the card's sentence. */
export function filedAtSentence(
  from: string,
  to: string,
  rate: number,
  rateDate: string,
): string {
  const d = new Date(`${rateDate}T00:00:00Z`);
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `filed at 1 ${from} = ${rate.toFixed(4)} ${to} on ${day}`;
}
