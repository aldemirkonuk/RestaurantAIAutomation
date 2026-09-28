/**
 * Shared normalisation for the shelf-price parsers (Iowa, Oregon).
 *
 * Kept identical to `scripts/fetch_price_sightings.py` on purpose: a second
 * definition of "how big is 1.75 L" or "how far may a case price disagree" is a
 * second answer, and the two would drift. The Python script remains the
 * independent full-file proof; this is the pipeline; they must agree.
 */

/**
 * How far a bottle price times the pack may sit from the published case price
 * before the row is treated as internally inconsistent. Iowa's own file
 * contains a row (item 920301) where the two disagree by a factor of ~31, so
 * this is not hypothetical.
 */
export const CASE_CONSISTENCY_TOLERANCE = 0.02;

const SIZE_RE = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(ML|L|LITER|LITRE)\s*$/i;

/**
 * '750 ML' -> 750, '1.75 L' -> 1750, anything else -> null.
 *
 * null means "not stated", which is a fact. Zero would mean "a bottle of no
 * volume", which is not — and eleven Iowa rows would otherwise assert exactly
 * that.
 */
export function parseSizeToMl(size: string | null | undefined): number | null {
  if (!size) return null;
  const m = SIZE_RE.exec(size);
  if (!m) return null;
  const value = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const ml = unit === "ML" ? value : value * 1000;
  const mlInt = Math.round(ml);
  return mlInt > 0 ? mlInt : null;
}
