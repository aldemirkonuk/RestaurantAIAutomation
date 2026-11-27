/**
 * `pct` — a signed change the engine returns as a 0–1 fraction.
 *
 * The analytics walk on 2026-10-03 (A-020) read `rp-seasonality.trendPerDayPct
 * = 0.20689655` off production — slope ÷ |mean|, so +20.7% a day — and the page
 * printed it as "+0.21%", because this helper assumed the engine had already
 * multiplied by 100. Every case below fails on that helper.
 */

import { describe, expect, it, vi } from 'vitest';
import { EM, pct, shortDay } from './rp-format';

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

/**
 * Perf p8-2. The 90-day till view asks `shortDay` for 360 labels per draw, and
 * `toLocaleDateString(locale, options)` builds a new Intl formatter on every
 * call. The words must stay the same; only the building stops.
 */
describe('shortDay — the same words, without a formatter built per label', () => {
  const old = (s: string) =>
    new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

  it('reads every day of a leap year exactly as toLocaleDateString did', () => {
    for (let i = 0; i < 366; i += 1) {
      const d = new Date(2028, 0, 1 + i);
      const s = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
      expect(shortDay(s)).toBe(old(s));
    }
    expect(shortDay('2026-08-28')).toBe('Aug 28');
  });

  it('leaves a string that is not a date alone', () => {
    expect(shortDay('Aug 28')).toBe('Aug 28');
    expect(shortDay('')).toBe('');
  });

  it('never calls toLocaleDateString for a label', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleDateString');
    for (let i = 1; i <= 28; i += 1) shortDay(`2031-02-${`${i}`.padStart(2, '0')}`);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
