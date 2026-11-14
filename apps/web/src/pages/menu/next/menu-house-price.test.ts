/**
 * r28 G11 (r21 defect 7): /menu showed only the printed price, so a price
 * changed on Inventory after the menu, held by a lock, or never carried read as
 * the house's own price. The page now says the house's price beside the line
 * when it is not the menu's.
 */
import { describe, expect, it } from 'vitest';
import { housePriceBesideWords } from './menu-price-note';

const money = (n: number) => `₺${n.toFixed(2)}`;

describe('housePriceBesideWords (r28 G11)', () => {
  it('says nothing for a line with no link, and nothing when every printed price is the house price', () => {
    expect(housePriceBesideWords({ bottle_price: 48, by_glass_price: 12 }, money)).toBeNull();
    expect(
      housePriceBesideWords({ bottle_price: 48, by_glass_price: 12, house_price: { bottle: 48, glass: 12.004, removed: false } }, money),
    ).toBeNull();
  });

  it('names each kind the house holds at another price, and a kind it holds no price for', () => {
    expect(
      housePriceBesideWords({ bottle_price: 48, by_glass_price: 12, house_price: { bottle: 55, glass: null, removed: false } }, money),
    ).toBe("The house's own price on Inventory (Your price) is not the menu's: bottle ₺55.00; no glass price of its own.");
    expect(
      housePriceBesideWords({ bottle_price: 48, by_glass_price: 12, house_price: { bottle: 48, glass: 12.01, removed: false } }, money),
    ).toBe("The house's own price on Inventory (Your price) is not the menu's: glass ₺12.01.");
  });

  it('leaves a kind the menu prints no price for to the price flag', () => {
    expect(
      housePriceBesideWords({ bottle_price: null, by_glass_price: 12, house_price: { bottle: 90, glass: 12, removed: false } }, money),
    ).toBeNull();
  });

  it('says a good removed on Inventory before any price', () => {
    expect(
      housePriceBesideWords({ bottle_price: 48, by_glass_price: null, house_price: { bottle: 30, glass: null, removed: true } }, money),
    ).toBe('The good this line sells is removed on Inventory, so the house no longer lists it. Bring it back on Inventory, or discard this line.');
  });
});
