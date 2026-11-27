/**
 * The week's shape with fewer than two weekdays measured (r109 reports-r109-7).
 *
 * The gateway now leaves a weekday with no counted line out of the profile
 * (weekdays-recorded.ts), so a house that records only Saturdays sends one
 * weekday. One weekday shares nothing with another: the page says there is
 * nothing to rank, not that "more than one weekday shares the extreme".
 */

import { describe, expect, it } from 'vitest';
import { week } from './rp-registers-trade';

const read = (profile: Array<{ day: string; mean: number }>, tie: boolean) =>
  week.select({
    weekdayProfile: profile.map((p) => ({ ...p, stdev: 0, n: 13 })),
    bestDay: null,
    worstDay: null,
    tie,
    trendPerDayPct: null,
    zoneUnset: false,
    basis: { weekday: 'w', extremes: 'e' },
  });

describe('a week with one weekday measured', () => {
  it('[REVERT-FAILS] says fewer than two weekdays have a reading, never a shared extreme', () => {
    const view = week.view(read([{ day: 'Saturday', mean: 8 }], true), { days: 90 });
    const text = [...view.figures.map((f) => f.note ?? ''), ...view.notes].join(' ');
    expect(text).toContain('Fewer than two weekdays have a reading');
    expect(view.notes).toEqual([
      'Busiest and quietest are left blank because fewer than two weekdays have a reading in this window, so there is nothing to rank.',
    ]);
    expect(text).not.toMatch(/shares/);
  });

  it('a real tie among measured weekdays still says the extreme is shared', () => {
    const view = week.view(
      read([
        { day: 'Friday', mean: 4 },
        { day: 'Saturday', mean: 4 },
      ], true),
      { days: 90 },
    );
    expect(view.notes.join(' ')).toMatch(/more than one weekday shares the extreme/);
  });
});
