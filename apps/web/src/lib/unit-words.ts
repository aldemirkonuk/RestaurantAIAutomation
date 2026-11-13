/**
 * The words every page says a stored unit in. One table for the whole web app.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The seven unit codes (`procurement_orders.unit_type`, `price_uom`, an invoice
 * line's `unit`, the gateway's `ORDER_UNIT_TYPES`: bottle, case, keg, pack,
 * split_case, each, liter) were turned into words by five separate tables:
 * documents (`canonical-format.ts`), the /orders price picker and counts
 * (`price-unit.ts`), the agreement sheet, the vendor's answers (`responses.ts`)
 * and the receiving door (`rc-format.ts`). They disagreed. The same order
 * was "2 each" and "liters" on its invoice, "2 items" and "litres" on /orders,
 * and "2 units" at the door. Each table was right on its own page.
 *
 * THE WORDS (the session's call under the 2026-11-07 /goal, 2026-11-13)
 * --------------------------------------------------------------------
 * - `each` reads "item" / "items". "per each" and "2 each" are not sentences,
 *   and "unit" collides with the word "unit" the pages use for the code itself
 *   ("the unit this price is for").
 * - `liter` reads "litre" / "litres", the spelling /orders and the door already
 *   used. The stored code keeps its database spelling; only the reading changes.
 * - A code outside the seven is printed as it came, never guessed into one.
 *
 * The gateway's vendor letter says its units in its own words
 * (`agreed-price.ts`). That letter goes to someone outside the house, and its
 * spelling is a separate decision, so it is not read from here.
 */

export const UNIT_WORDS = {
  bottle: ['bottle', 'bottles'],
  case: ['case', 'cases'],
  keg: ['keg', 'kegs'],
  pack: ['pack', 'packs'],
  split_case: ['split case', 'split cases'],
  each: ['item', 'items'],
  liter: ['litre', 'litres'],
} as const satisfies Record<string, readonly [string, string]>;

export type StoredUnit = keyof typeof UNIT_WORDS;

function wordsOf(unit: string): readonly [string, string] | null {
  return Object.prototype.hasOwnProperty.call(UNIT_WORDS, unit)
    ? UNIT_WORDS[unit as StoredUnit]
    : null;
}

/** One of a unit in words: "split case", "item", "litre". Unknown: as it came. */
export function unitOne(unit: string): string {
  return wordsOf(unit)?.[0] ?? unit;
}

/** Several of a unit in words: "split cases", "items", "litres". Unknown: as it came. */
export function unitMany(unit: string): string {
  return wordsOf(unit)?.[1] ?? unit;
}

/**
 * The word for `qty` of a unit: exactly the number 1 reads singular, anything
 * else (2, 0.5, an unknown quantity) plural. "1 bottle", "6 bottles".
 */
export function unitWord(unit: string, qty: unknown): string {
  return typeof qty === 'number' && qty === 1 ? unitOne(unit) : unitMany(unit);
}
