/**
 * The "Value on hand" card's menu line never counts an unpriced wine as $0.
 *
 * It summed `menuPrice ?? 0` × bottles, where `menuPrice` is the library's
 * figure (absent for almost every wine), so an unpriced wine read as free and
 * the house's own bottle price (`menuPriceBottle`, ADR 0193) was never read.
 */
import { describe, expect, it } from 'vitest';
import { menuPriceOf, totalMenuValue, totalMenuValueText } from './stock-value';

const fmt = (n: number) => `TRY ${n.toLocaleString('en-US')}`;
const wine = (menuPriceBottle: number | undefined, liveStock = 2, shadowStock = 0) =>
  ({ menuPriceBottle, liveStock, shadowStock, wac: undefined }) as any;

describe('menu value on hand', () => {
  it('reads the house bottle price, never the library price or 0', () => {
    expect(menuPriceOf({ menuPriceBottle: 40 } as any)).toBe(40);
    expect(menuPriceOf({ menuPriceBottle: undefined } as any)).toBeNull();
    expect(menuPriceOf({ menuPriceBottle: 0 } as any)).toBeNull();
    expect(menuPriceOf({ menuPriceBottle: NaN } as any)).toBeNull();
    // The library's `menuPrice` is not the house's price.
    expect(menuPriceOf({ menuPrice: 99 } as any)).toBeNull();
  });

  it('every wine priced: the total', () => {
    const t = totalMenuValue([wine(40, 2), wine(25, 1, 1)]);
    expect(t).toEqual({ known: 130, unknownItems: 0 });
    expect(totalMenuValueText(t, fmt)).toBe('TRY 130 menu');
  });

  it('an unpriced wine with bottles is counted, not summed as $0', () => {
    const t = totalMenuValue([wine(40, 2), wine(undefined, 3)]);
    expect(t).toEqual({ known: 80, unknownItems: 1 });
    expect(totalMenuValueText(t, fmt)).toBe('TRY 80 menu + 1 drink with no bottle price');
  });

  it('no price anywhere says so, never "$0 menu"', () => {
    const t = totalMenuValue([wine(undefined, 3), wine(undefined, 1)]);
    expect(totalMenuValueText(t, fmt)).toBe('no bottle price set (2 drinks)');
  });

  it('a wine with no bottles on hand adds nothing and is not "unpriced"', () => {
    expect(totalMenuValue([wine(undefined, 0, 0)])).toEqual({ known: 0, unknownItems: 0 });
    expect(totalMenuValueText({ known: 0, unknownItems: 0 }, fmt)).toBe('cost basis');
  });

  it('food and supplies are neither summed nor counted as unpriced', () => {
    const good = (kind: string | undefined, menuPriceBottle?: number) =>
      ({ kind, menuPriceBottle, liveStock: 4, shadowStock: 0, wac: undefined }) as any;
    const t = totalMenuValue([
      good('wine', 50),
      good('food'),
      good('supply'),
      good('spirit'),
      good(undefined),
    ]);
    // 4 × 50 from the wine; the spirit and the row with no kind are unpriced drinks.
    expect(t).toEqual({ known: 200, unknownItems: 2 });
    expect(totalMenuValueText(t, fmt)).toBe('TRY 200 menu + 2 drinks with no bottle price');
  });
});
