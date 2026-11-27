/**
 * Make N (r107 drinks-g4): the recipe card's amounts times a count, for batch
 * prep. Only arithmetic: an amount times N in the line's OWN unit (no unit is
 * converted, so 50 ml stays ml), trimmed the way every other amount is
 * (`qtyText`, three decimals at most). The stored recipe is never changed.
 *
 * Ruling: an amount is shown to the precision it works out to, never as
 * "about": 12 x 0.1 piece is 1.2, 12 x 1234.5678 is 14814.814. The cost to
 * make N is N times the serve's cost taken at its exact figure, rounded to the
 * cent once at the end (rounding the serve first would carry the error N times).
 */
import { amountWithUnit } from './units';

export const MAKE_MIN = 1;
export const MAKE_MAX = 200;
export const MAKE_SAID = 'Make takes a whole number from 1 to 200.';

/** The count typed, or null when it is not a whole number from 1 to 200. */
export function readMake(text: string): number | null {
  const s = text.trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= MAKE_MIN && n <= MAKE_MAX ? n : null;
}

/**
 * One line's amount for N serves, in its own unit: "600 ml". The stored lines
 * are for the WHOLE recipe, which makes `yieldServes` serves, so N serves is
 * the line times N / yieldServes (r107f: a 4-serve recipe at Make 2 is half the lines).
 */
export function scaledAmount(qty: number, n: number, unit: string | null | undefined, yieldServes = 1): string {
  return amountWithUnit((qty * n) / (yieldServes > 0 ? yieldServes : 1), unit as never);
}

/** N serves at a serve's exact cost, to the cent once. */
export function scaledCost(perServeExact: number, n: number): number {
  return Math.round(perServeExact * n * 100) / 100;
}
