/**
 * Day / Week / Month grain for the till (r109 g3). Buckets come from the
 * house-day keys; takings are Σ known revenue; a day the till could not state
 * draws no bar; average check is Σ revenue ÷ Σ checks; an edge bucket that is
 * not whole is flagged and named.
 */

import { describe, expect, it } from 'vitest';
import { bucketPrior, bucketTill, grainOf, grainsOffered } from './rp-grain';
import { daysBetween } from './rp-registers-trade';

describe('the grains a window offers', () => {
  it('[REVERT-FAILS] none at 7, Week from 30, Month from 90', () => {
    expect(grainsOffered(7)).toEqual([]);
    expect(grainsOffered(30)).toEqual(['day', 'week']);
    expect(grainsOffered(90)).toEqual(['day', 'week', 'month']);
    expect(grainsOffered(365)).toEqual(['day', 'week', 'month']);
  });

  it('a grain the window does not offer, or none, reads as Day', () => {
    expect(grainOf('month', 30)).toBe('day');
    expect(grainOf('week', 7)).toBe('day');
    expect(grainOf('fortnight', 90)).toBe('day');
    expect(grainOf(null, 90)).toBe('day');
    expect(grainOf('week', 30)).toBe('week');
  });
});

describe('a week of the till', () => {
  // Mon 2026-11-02 .. Sun 2026-11-08: one whole week.
  const week = daysBetween('2026-11-02', '2026-11-08');

  it('[REVERT-FAILS] average check is Σ revenue ÷ Σ checks, never a mean of the daily averages', () => {
    const [b] = bucketTill(
      week,
      [
        { date: '2026-11-02', revenue: 100, checks: 1 },
        { date: '2026-11-05', revenue: 900, checks: 3 },
      ],
      'week',
    );
    expect(b.revenue).toBe(1000);
    expect(b.checks).toBe(4);
    expect(b.avg).toBe(250); // the mean of 100 and 300 would be 200
    expect(b.whole).toBe(true);
    expect(b.full).toBe('week of Nov 2');
  });

  it('[REVERT-FAILS] a day the till could not state draws no bar, and says so', () => {
    const [b] = bucketTill(
      week,
      [
        { date: '2026-11-02', revenue: 400, checks: 4 },
        { date: '2026-11-03', revenue: null, checks: 2 },
      ],
      'week',
    );
    expect(b.revenue).toBeNull();
    expect(b.avg).toBeNull();
    expect(b.unstated).toBe(1);
    expect(b.full).toBe('week of Nov 2 · the till could not state 1 day');
  });

  it('checks are summed only when every trading day carries them', () => {
    const [b] = bucketTill(
      week,
      [
        { date: '2026-11-02', revenue: 400, checks: 4 },
        { date: '2026-11-03', revenue: 600, checks: null },
      ],
      'week',
    );
    expect(b.revenue).toBe(1000);
    expect(b.checks).toBeNull();
    expect(b.avg).toBeNull();
  });

  it('a week in which nothing rang up is a gap, never a 0', () => {
    const [b] = bucketTill(week, [], 'week');
    expect(b.revenue).toBeNull();
    expect(b.full).toBe('week of Nov 2 · no check');
  });

  it('[REVERT-FAILS] an edge week that is not whole is flagged and named', () => {
    // Wed 2026-11-04 .. Sun 2026-11-15: a part week of 5 days, then a whole one.
    const b = bucketTill(daysBetween('2026-11-04', '2026-11-15'), [{ date: '2026-11-04', revenue: 50 }], 'week');
    expect(b.map((x) => x.key)).toEqual(['2026-11-02', '2026-11-09']);
    expect(b[0].whole).toBe(false);
    expect(b[0].slots).toHaveLength(5);
    expect(b[0].full).toBe('week of Nov 2 · part week: 5 days');
    expect(b[1].whole).toBe(true);
  });
});

describe('a year of the till by month', () => {
  const span = daysBetween('2025-11-28', '2026-11-27');
  const series = span.map((date, i) => ({ date, revenue: i % 5 === 0 ? null : (i % 7) * 100 + 13, checks: 3 }));

  it('[REVERT-FAILS] 365 days are 12 or 13 months, every day in one, summing to the known takings', () => {
    expect(span).toHaveLength(365);
    const known = series.map((d) => ({ ...d, revenue: d.revenue ?? 0 }));
    const b = bucketTill(span, known, 'month');
    expect(b.length).toBeGreaterThanOrEqual(12);
    expect(b.length).toBeLessThanOrEqual(13);
    expect(b.reduce((a, x) => a + x.slots.length, 0)).toBe(365);
    expect(b.reduce((a, x) => a + (x.revenue ?? 0), 0)).toBe(known.reduce((a, d) => a + d.revenue, 0));
    expect(b[0]).toMatchObject({ label: 'Nov 2025', whole: false });
    expect(b[0].full).toBe('Nov 2025 · part month: 3 days');
    expect(b[1]).toMatchObject({ label: 'Dec 2025', whole: true });
    expect(b[b.length - 1].full).toBe('Nov 2026 · part month: 27 days');
  });

  it('[REVERT-FAILS] a month holding an unstated day is not drawn, and never as its known part', () => {
    const b = bucketTill(span, series, 'month');
    expect(b.every((x) => x.revenue === null)).toBe(true);
    expect(b[1].full).toMatch(/the till could not state \d+ days/);
  });
});

describe('the prior window in the same buckets', () => {
  const span = daysBetween('2026-11-04', '2026-11-15');
  const priorSpan = daysBetween('2026-10-23', '2026-11-03');

  it('[REVERT-FAILS] bucket i sums the prior days at bucket i’s slots, so a part week meets a part week', () => {
    const b = bucketTill(span, [], 'week');
    const prior = bucketPrior(
      b,
      span,
      priorSpan,
      priorSpan.map((date) => ({ date, revenue: 10 })),
    );
    expect(prior).toEqual([50, 70]);
  });

  it('[REVERT-FAILS] a prior bucket with an unstated day is not drawn; a prior that does not line up is not drawn at all', () => {
    const b = bucketTill(span, [], 'week');
    const withNull = priorSpan.map((date, i) => ({ date, revenue: i === 0 ? null : 10 }));
    expect(bucketPrior(b, span, priorSpan, withNull)).toEqual([null, 70]);
    expect(bucketPrior(b, span, priorSpan.slice(1), withNull)).toEqual([null, null]);
  });
});
