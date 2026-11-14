/**
 * `pct` — a signed change the engine returns as a 0–1 fraction.
 *
 * The analytics walk on 2026-10-03 (A-020) read `rp-seasonality.trendPerDayPct
 * = 0.20689655` off production — slope ÷ |mean|, so +20.7% a day — and the page
 * printed it as "+0.21%", because this helper assumed the engine had already
 * multiplied by 100. Every case below fails on that helper.
 */

import { describe, expect, it } from 'vitest';
import { EM, READING, money, moneyIn, pct } from './rp-format';

describe('pct — a 0–1 fraction, printed as a signed percentage', () => {
  it('multiplies by 100: the measured trend reads +20.7%, not +0.21%', () => {
    expect(pct(0.20689655)).toBe('+20.7%');
    expect(pct(0.20689655, 2)).toBe('+20.69%');
  });

  it('keeps the sign of a fall', () => {
    expect(pct(-0.004)).toBe('-0.4%');
    expect(pct(1200 / 900 - 1)).toBe('+33.3%');
  });

  it('prints a change that rounds to zero unsigned, never "-0.0%"', () => {
    expect(pct(0.0004)).toBe('0.0%');
    expect(pct(-0.0004)).toBe('0.0%');
    expect(pct(0)).toBe('0.0%');
    expect(pct(-0.00004, 2)).toBe('0.00%');
  });

  it('prints an unknown as the dash, never as a zero', () => {
    expect(pct(null)).toBe(EM);
    expect(pct(undefined)).toBe(EM);
    expect(pct(Number.NaN)).toBe(EM);
    expect(pct('not a number')).toBe(EM);
  });
});

describe('money — in the house’s currency, never an assumed $ (audit G5)', () => {
  it('prints the house’s own mark', () => {
    // A lira house writes its money the Turkish way (r29 walk, finding 4):
    // "₺4,302" and "₺112,736.56" were English grouping beside /inventory's "₺545,10".
    expect(money(1234, 'full', 'TRY')).toBe('₺1.234');
    expect(money(4302, 'full', 'TRY')).toBe('₺4.302');
    expect(money(112736.56, 'table', 'TRY')).toBe('₺112.736,56');
    expect(money(1234.5, 'full', 'USD')).toBe('$1,234.50');
    // Compact keeps the page's English suffix with the house's marks: the
    // Turkish compact form "₺12,3 B" (bin) reads as billions on this page.
    expect(money(12345, 'compact', 'TRY')).toBe('₺12,3K');
    expect(money(12345678, 'compact', 'TRY')).toBe('₺12,3M');
    expect(money(12345, 'compact', 'EUR')).toBe('€12.3K');
    expect(money(4.5, 'table', 'GBP')).toBe('£4.50');
  });

  it('never prints a money with one decimal (r33 w2 F7)', () => {
    // Walked: "₺113,2 of ₺95" and "₺828,7 · ₺800,3" on the projection card.
    // Under a thousand there is no K to round to, so compact writes it in full.
    expect(money(113.2, 'compact', 'TRY')).toBe('₺113,20');
    expect(money(95, 'compact', 'TRY')).toBe('₺95');
    expect(money(828.7, 'compact', 'TRY')).toBe('₺828,70');
    expect(money(-800.3, 'compact', 'TRY')).toBe('-₺800,30');
    expect(money(999.99, 'compact', 'USD')).toBe('$999.99');
    // From a thousand up the compact form keeps its one decimal after the K.
    expect(money(1000, 'compact', 'TRY')).toBe('₺1K');
    expect(money(1500, 'compact', 'TRY')).toBe('₺1,5K');
    // Full: whole stays whole, anything else carries both decimals.
    expect(money(4.5, 'full', 'TRY')).toBe('₺4,50');
    expect(money(4470, 'full', 'TRY')).toBe('₺4.470');
    // A money without decimals (the yen) never grows any.
    expect(money(113.2, 'compact', 'JPY')).toBe('¥113');
  });

  it('prints a bare number when no currency is recorded or read', () => {
    expect(money(1234, 'full', undefined)).toBe('1,234');
    expect(money(1234, 'full', null)).toBe('1,234');
    expect(money(12345, 'compact', 'not-a-code')).toBe('12.3K');
    expect(money(4.5, 'table', null)).toBe('4.50');
  });

  it('prints the dash, never $ or a bare figure, while the currency is still being read', () => {
    expect(money(1234, 'full', READING)).toBe(EM);
    expect(money(12345, 'compact', READING)).toBe(EM);
    expect(moneyIn(READING)(4.5, 'table')).toBe(EM);
    expect(moneyIn(READING)(0)).toBe(EM);
  });

  it('keeps an unknown as the dash', () => {
    expect(money(null, 'full', 'USD')).toBe(EM);
    expect(moneyIn('USD')(undefined)).toBe(EM);
    expect(moneyIn('USD')(310, 'compact')).toBe('$310');
  });
});
