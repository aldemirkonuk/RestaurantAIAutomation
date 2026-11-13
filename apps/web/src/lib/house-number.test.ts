import { describe, expect, it } from 'vitest';
import { formatHouseNumber, formatHousePercent, houseNumberLocale, housePriceHint } from './house-number';

// The reader's runtime locale in this suite is whatever Node gives; every
// expectation below that names a house money must hold regardless of it.
const reader = (opts: Intl.NumberFormatOptions, n: number) => new Intl.NumberFormat(undefined, opts).format(n);

describe('houseNumberLocale', () => {
  it('writes a lira house in Turkish, a pound house in British, a dollar house in American', () => {
    expect(houseNumberLocale('TRY')).toBe('tr-Latn-TR');
    expect(houseNumberLocale('GBP')).toBe('en-Latn-GB');
    expect(houseNumberLocale('USD')).toBe('en-Latn-US');
  });

  it('leaves a money with no one home, an unknown code and no answer to the reader', () => {
    expect(houseNumberLocale('EUR')).toBeUndefined();
    expect(houseNumberLocale('XOF')).toBeUndefined();
    expect(houseNumberLocale(null)).toBeUndefined();
    expect(houseNumberLocale(undefined)).toBeUndefined();
    expect(houseNumberLocale('try')).toBeUndefined();
    expect(houseNumberLocale('TL')).toBeUndefined();
    // US is a country, but USN is not the money it prices in.
    expect(houseNumberLocale('USN')).toBeUndefined();
  });

  it('keeps Latin digits only: a yen house reads in the reader locale, not in Japanese script', () => {
    expect(houseNumberLocale('JPY')).toBeUndefined();
  });
});

describe('formatHousePercent', () => {
  it('writes the drink card share the Turkish way in a lira house (walk r23: "13.1%")', () => {
    expect(formatHousePercent(13.1, 'TRY')).toBe('%13,1');
  });

  it('writes it the English way in a pound house', () => {
    expect(formatHousePercent(13.1, 'GBP')).toBe('13.1%');
  });

  it('takes percent points, not a fraction', () => {
    expect(formatHousePercent(0.5, 'GBP')).toBe('0.5%');
    expect(formatHousePercent(100, 'GBP', { digits: 0 })).toBe('100%');
  });

  it('fixes the decimals it is asked for', () => {
    expect(formatHousePercent(18.75, 'TRY', { digits: 0 })).toBe('%19');
    expect(formatHousePercent(18, 'GBP', { digits: 1 })).toBe('18.0%');
  });

  it('signs a rise and a fall, never zero, when asked', () => {
    expect(formatHousePercent(12, 'GBP', { signed: true, digits: 0 })).toBe('+12%');
    expect(formatHousePercent(-12, 'GBP', { signed: true, digits: 0 })).toBe('-12%');
    expect(formatHousePercent(0, 'GBP', { signed: true, digits: 0 })).toBe('0%');
  });

  it('falls back to the reader locale with no currency', () => {
    expect(formatHousePercent(13.1, null)).toBe(reader({ style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }, 0.131));
  });
});

describe('formatHouseNumber', () => {
  it('groups and marks decimals the house way', () => {
    expect(formatHouseNumber(1250.5, 'TRY')).toBe('1.250,5');
    expect(formatHouseNumber(1250.5, 'GBP')).toBe('1,250.5');
  });

  it('fixes decimals with digits, drops trailing zeros without', () => {
    expect(formatHouseNumber(3, 'TRY', { digits: 1 })).toBe('3,0');
    expect(formatHouseNumber(3, 'TRY')).toBe('3');
    expect(formatHouseNumber(0.125, 'TRY', { max: 3 })).toBe('0,125');
  });
});

describe('housePriceHint', () => {
  it('hints a lira box with a comma and the lira decimals (walk r23: "14.00")', () => {
    expect(housePriceHint(14, 'TRY')).toBe('14,00');
  });

  it('never groups thousands, because a price box refuses "1.250" and "1,250"', () => {
    expect(housePriceHint(1250, 'TRY')).toBe('1250,00');
    expect(housePriceHint(1250, 'GBP')).toBe('1250.00');
  });

  it('uses the money own decimals', () => {
    expect(housePriceHint(1400, 'JPY')).toBe(reader({ useGrouping: false, maximumFractionDigits: 0 }, 1400));
    expect(housePriceHint(1.5, 'KWD')).toBe('1.500');
  });
});
