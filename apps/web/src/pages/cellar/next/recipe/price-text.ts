/**
 * A price typed as text, read the same way on /dishes and /cocktails.
 *
 * A number field reads "12,50" as empty in a browser whose locale writes a
 * point, and the form then saved the item with no price and said nothing.
 * The box is text; this reads it.
 */

/** Said when a typed price cannot be read. */
export const PRICE_UNREAD = 'Type the price as a number, like 12.50 or 12,50.';

/**
 * A typed price: blank is "no price" (null), "12,50" and "12.50" are 12.5.
 * At most two decimals and one separator, so "1.250" or "1,250" (a thousand,
 * or one and a quarter?) is refused rather than guessed. `bad` when unread.
 */
export function readPrice(text: string): { price: number | null; bad: boolean } {
  const t = text.trim().replace(/\s+/g, '');
  if (t === '') return { price: null, bad: false };
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(t)) return { price: null, bad: true };
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 9_999_999_999 ? { price: n, bad: false } : { price: null, bad: true };
}

/** A stored price as the box shows it; no price is an empty box. */
export const priceText = (n: number | null | undefined) => (n == null ? '' : String(n));
