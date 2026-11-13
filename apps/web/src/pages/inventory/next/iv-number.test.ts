/**
 * Inventory r28 audit, gap 7: counts, weights, paces, recipe measures and
 * nutrition figures on /inventory are written in the house's form, as its
 * money already is. "₺1.240,50 · 1,240 bottles · 12.4 kg" was two decimal
 * marks on one line.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { inventoryNumberLocale, ivNumber, setInventoryNumberCurrency } from './iv-number';
import { fmtCount, fmtPace } from './useInventoryNextData';
import { fmtQty } from './ItemCards';
import { fmtRecipeQty } from './ItemUsedIn';
import { figureWords } from './nutrition-words';

afterEach(() => setInventoryNumberCurrency(null));

describe('the page writes its plain numbers in the house’s form', () => {
  it('writes a lira house’s counts, weights and paces the Turkish way', () => {
    setInventoryNumberCurrency('TRY');
    expect(inventoryNumberLocale()).toMatch(/^tr\b/);
    expect(fmtCount(1240)).toBe('1.240');
    expect(fmtCount(2.5)).toBe('2,5');
    expect(fmtQty(12400, 'g')).toBe('12,4 kg');
    expect(fmtQty(1755, 'ml')).toBe('1,755 l');
    expect(fmtQty(1240, 'bottle')).toBe('1.240 bottles');
    expect(fmtPace(0.033)).toBe('0,03');
    expect(fmtPace(12.4)).toBe('12,4');
    expect(fmtRecipeQty(29.5735295625)).toBe('29,57');
    expect(figureWords(12.5, 'g')).toBe('12,5 g');
    expect(figureWords(1234, 'kcal')).toBe('1.234 kcal');
  });

  it('writes a pound house’s numbers the British way', () => {
    setInventoryNumberCurrency('GBP');
    expect(fmtCount(1240)).toBe('1,240');
    expect(fmtQty(12400, 'g')).toBe('12.4 kg');
    expect(fmtPace(0.033)).toBe('0.03');
  });

  it('keeps en-GB while the money is unread or none is recorded, as before', () => {
    setInventoryNumberCurrency('TRY');
    setInventoryNumberCurrency(null);
    expect(inventoryNumberLocale()).toBe('en-GB');
    expect(fmtCount(1240)).toBe('1,240');
    expect(fmtQty(12400, 'g')).toBe('12.4 kg');
  });

  it('uses the reader’s own locale for a money no one country owns, as the money does', () => {
    setInventoryNumberCurrency('EUR');
    expect(inventoryNumberLocale()).toBeUndefined();
    expect(ivNumber(1240.5, { max: 1 })).toBe(new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(1240.5));
  });

  it('keeps a true zero pace as "0" and fixed places where asked', () => {
    setInventoryNumberCurrency('TRY');
    expect(fmtPace(0)).toBe('0');
    expect(ivNumber(3, { digits: 2 })).toBe('3,00');
  });
});
