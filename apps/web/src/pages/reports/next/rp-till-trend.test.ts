/**
 * The till's 7-day average (r109 g2): point(d) = Σ revenue over the days in
 * [d-6, d] that rang up a check ÷ the count of those days. Trailing, never
 * centred; an absent day is in neither the sum nor the count; a day the till
 * could not state nulls the point; fewer than 3 trading days null it; a day
 * with no 7 behind it in the read is null.
 */

import { describe, expect, it } from 'vitest';
import { addDays, startsLate, trailingAverage, trendTip } from './rp-till-trend';

const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

describe('the 7-day average of a trading day', () => {
  it('[REVERT-FAILS] an absent day is in neither the sum nor the count (Σ/7 would read a closed Monday as a 0)', () => {
    // Nov 1-7; Nov 3 absent (closed). Six days of 700 average 700, not 600.
    const series = days('2026-11-01', 7)
      .filter((d) => d !== '2026-11-03')
      .map((date) => ({ date, revenue: 700 }));
    const [p] = trailingAverage(series, ['2026-11-07'], '2026-11-01');
    expect(p).toEqual({ value: 700, days: 6, why: 'ok' });
    expect(trendTip(p)).toBe('over 6 trading days');
  });

  it('[REVERT-FAILS] unequal open days average over the days that traded', () => {
    const series = [
      { date: '2026-11-02', revenue: 100 },
      { date: '2026-11-04', revenue: 200 },
      { date: '2026-11-06', revenue: 600 },
    ];
    const [p] = trailingAverage(series, ['2026-11-07'], '2026-11-01');
    expect(p.value).toBe(300);
    expect(p.days).toBe(3);
  });

  it('[REVERT-FAILS] a day present with no figure nulls the point, never computed around it', () => {
    const series = days('2026-11-01', 7).map((date) => ({ date, revenue: date === '2026-11-05' ? null : 500 }));
    const [p] = trailingAverage(series, ['2026-11-07'], '2026-11-01');
    expect(p.value).toBeNull();
    expect(p.why).toBe('unstated');
    expect(trendTip(p)).toBe('the till could not state a day in these 7');
    // A week later that day has left the trail, and the point returns.
    const later = trailingAverage(
      [...series, ...days('2026-11-08', 5).map((date) => ({ date, revenue: 500 }))],
      ['2026-11-12'],
      '2026-11-01',
    );
    expect(later[0]).toEqual({ value: 500, days: 7, why: 'ok' });
  });

  it('[REVERT-FAILS] two trading days in the 7 give no average', () => {
    const series = [
      { date: '2026-11-03', revenue: 900 },
      { date: '2026-11-06', revenue: 300 },
    ];
    const [p] = trailingAverage(series, ['2026-11-07'], '2026-11-01');
    expect(p).toEqual({ value: null, days: 2, why: 'few' });
    expect(trendTip(p)).toBe('only 2 trading days in these 7, fewer than 3');
    const [three] = trailingAverage([...series, { date: '2026-11-07', revenue: 0 }], ['2026-11-07'], '2026-11-01');
    expect(three.value).toBe(400);
  });

  it('[REVERT-FAILS] the window is trailing: a day after d never enters its point', () => {
    const series = [...days('2026-11-01', 7).map((date) => ({ date, revenue: 100 })), { date: '2026-11-08', revenue: 10000 }];
    expect(trailingAverage(series, ['2026-11-07'], '2026-11-01')[0].value).toBe(100);
  });

  it('[REVERT-FAILS] without the earlier days the first 6 are null and the line starts on the 7th', () => {
    const shown = days('2026-11-01', 10);
    const series = shown.map((date) => ({ date, revenue: 100 }));
    const pts = trailingAverage(series, shown, '2026-11-01');
    expect(pts.slice(0, 6).map((p) => p.value)).toEqual([null, null, null, null, null, null]);
    expect(pts.slice(0, 6).every((p) => p.why === 'no-trail')).toBe(true);
    expect(pts[6].value).toBe(100);
    expect(startsLate(pts)).toBe(true);
  });

  it('[REVERT-FAILS] with the doubled read the first 6 take their trail from its earlier days', () => {
    const shown = days('2026-11-11', 10);
    const series = days('2026-11-01', 20).map((date, i) => ({ date, revenue: i < 10 ? 50 : 100 }));
    const pts = trailingAverage(series, shown, '2026-11-01');
    expect(startsLate(pts)).toBe(false);
    // Nov 11: Nov 5-10 at 50 and Nov 11 at 100 → 400 / 7.
    expect(pts[0].value).toBeCloseTo(400 / 7, 9);
    expect(pts[0].days).toBe(7);
    expect(pts[9].value).toBe(100);
  });

  it('crosses a month and a year end by house day, and a DST Sunday is one day', () => {
    expect(addDays('2026-12-29', 6)).toBe('2027-01-04');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-03-29', -6)).toBe('2026-03-23');
  });

  it('an unusable key states nothing', () => {
    expect(trailingAverage([{ date: '2026-11-07', revenue: 1 }], ['Nov 7'], '2026-11-01')[0].value).toBeNull();
    expect(trailingAverage([{ date: '2026-11-07', revenue: 1 }], ['2026-11-07'], '')[0].value).toBeNull();
  });
});
