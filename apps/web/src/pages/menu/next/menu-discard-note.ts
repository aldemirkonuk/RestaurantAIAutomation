import type { MenuLine } from '../../../services/api/menus';

/**
 * What discarding a line from the current menu did, in the house's words
 * (r36 menu audit N5, r40).
 *
 * Discard only marks the menu line discarded: a drink's house price on
 * Inventory ("Your price") is not cleared, on purpose, since the tap can be
 * undone by adding the line again and is not a price change. The page said
 * only "Discard takes a line off the current menu", so an owner read the drink
 * as off sale while its price still stood. Since #1561 the next menu read
 * without the drink lists it under "Not on this file" and offers to take it
 * off sale; a manager can also change it on Inventory at any time.
 *
 * `money` writes a price in the house's money. A line whose house price could
 * not be read carries no `house_price`, and then nothing is claimed about it.
 */
export function discardedNote(
  line: Pick<MenuLine, 'name' | 'house_price'>,
  dish: boolean,
  money: (n: number) => string,
): string {
  const off = `${line.name} is off the current menu.`;
  if (dish) return off;
  const house = line.house_price;
  if (!house || house.removed) return off;
  const kept = [
    house.bottle !== null ? `bottle ${money(house.bottle)}` : null,
    house.glass !== null ? `glass ${money(house.glass)}` : null,
  ].filter((p): p is string => p !== null);
  if (kept.length === 0) return `${off} The house has no price for it, so no price changed.`;
  return `${off} Its house price (${kept.join(', ')}) stays on Inventory: change it there under Your price, or the next menu read without it offers to take it off sale.`;
}

/** The footer's sentence on discarding (r36 N5): a drink's house price stays. */
export const DISCARD_FOOTER =
  "Discard takes a line off the current menu. A drink's house price stays on Inventory until a manager changes it there; the next menu read without it offers to take it off sale.";
