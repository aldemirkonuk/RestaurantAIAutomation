import { describe, expect, it } from 'vitest';
import { hueOf, initialsOf, monogramOf, SPARK_WEEKS, weeklyOrderCounts } from './vendor-face';

describe('a vendor\'s monogram', () => {
  it('takes the first letters of the first two words', () => {
    expect(initialsOf('Skurnik Wines')).toBe('SW');
    expect(initialsOf('Kermit Lynch')).toBe('KL');
    expect(initialsOf('Winebow')).toBe('W');
  });
  it('skips articles and keeps a name of only articles', () => {
    expect(initialsOf('The Wine Merchant')).toBe('WM');
    expect(initialsOf('Fish & Sons')).toBe('FS');
    expect(initialsOf('The')).toBe('T');
    expect(initialsOf('   ')).toBe('·');
  });
  it('capitalises by letter, not by byte', () => {
    expect(initialsOf('école vins')).toBe('ÉV');
  });
  it('gives the same name the same hue every time, in range, ignoring case and edge spaces', () => {
    expect(hueOf('Skurnik')).toBe(hueOf('  skurnik '));
    for (const n of ['a', 'Skurnik', 'Winebow', 'Kermit Lynch', 'Éa']) {
      const h = hueOf(n);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
    expect(hueOf('Skurnik')).not.toBe(hueOf('Winebow'));
  });
  it('draws an oklch ground and ink from that hue', () => {
    const m = monogramOf('Skurnik');
    expect(m.ground).toBe(`oklch(0.92 0.045 ${hueOf('Skurnik')})`);
    expect(m.ink).toBe(`oklch(0.36 0.07 ${hueOf('Skurnik')})`);
  });
});

describe('the twelve-week tally', () => {
  const now = new Date('2026-11-19T12:00:00Z');
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  it('is twelve slots, oldest first, this week last', () => {
    const w = weeklyOrderCounts([ago(1), ago(2), ago(8)], now);
    expect(w).toHaveLength(SPARK_WEEKS);
    expect(w[11]).toBe(2);
    expect(w[10]).toBe(1);
  });
  it('drops an order past twelve weeks, undated, unreadable or in the future', () => {
    const w = weeklyOrderCounts([ago(7 * 12 + 1), undefined, null, 'soon', ago(-3), ago(0)], now);
    expect(w.reduce((a, b) => a + b, 0)).toBe(1);
  });
  it('counts the last day of week twelve and not the first of week thirteen', () => {
    expect(weeklyOrderCounts([ago(7 * 12 - 0.5)], now)[0]).toBe(1);
    expect(weeklyOrderCounts([ago(7 * 12)], now).reduce((a, b) => a + b, 0)).toBe(0);
  });
});
