/**
 * `pct` — a signed change the engine returns as a 0–1 fraction.
 *
 * The analytics walk on 2026-10-03 (A-020) read `rp-seasonality.trendPerDayPct
 * = 0.20689655` off production — slope ÷ |mean|, so +20.7% a day — and the page
 * printed it as "+0.21%", because this helper assumed the engine had already
 * multiplied by 100. Every case below fails on that helper.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { setHouseLocale } from '@/lib/houseCurrency';
import { EM, countOf, figure, pct, ratioPct } from './rp-format';

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

describe('counts, ratios and turns in the house’s marks, beside its money (F-992)', () => {
  afterEach(() => setHouseLocale(null));

  it('a lira house groups with "." and marks decimals with ","', () => {
    setHouseLocale('tr-TR');
    expect(figure(1250)).toBe('1.250');
    expect(figure(3.25)).toBe('3,25');
    expect(ratioPct(0.625)).toBe('62,5%');
    expect(pct(0.20689655)).toBe('+20,7%');
    expect(pct(0)).toBe('0,0%');
    expect(countOf(1250, 'bottle', 'bottles')).toBe('1.250 bottles');
  });

  it('an en-US house reads as before', () => {
    expect(figure(1250)).toBe('1,250');
    expect(figure(3.25)).toBe('3.25');
    expect(ratioPct(0.625)).toBe('62.5%');
    expect(pct(-0.004)).toBe('-0.4%');
  });
});
