import { describe, expect, it } from 'vitest';
import { reading, readingAge } from './rp-registers-trade';

/**
 * r36 reports audit, gap 4: "The reading" said "recomputed hourly". The
 * scheduler's default is once a day, and the page never showed when a
 * sentence was written, so the opening line could be a day older than the
 * live registers under it.
 */
const at = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).toISOString();
const NOW = new Date(2026, 10, 13, 15, 30);

describe('readingAge', () => {
  it('says today, yesterday, or the date, at the local time', () => {
    expect(readingAge([{ computedAt: at(2026, 11, 13, 6) }], NOW)).toBe('today at 6:00 AM');
    expect(readingAge([{ computedAt: at(2026, 11, 12, 6) }], NOW)).toBe('yesterday at 6:00 AM');
    expect(readingAge([{ computedAt: at(2026, 11, 9, 18, 5) }], NOW)).toBe('on Nov 9 at 6:05 PM');
  });

  it('dates the OLDEST sentence shown, never the newest', () => {
    expect(
      readingAge(
        [{ computedAt: at(2026, 11, 13, 14) }, { computedAt: at(2026, 11, 12, 6) }, { computedAt: null }],
        NOW,
      ),
    ).toBe('yesterday at 6:00 AM');
  });

  it('is null when no sentence carries a time, or the time is not one', () => {
    expect(readingAge([{ computedAt: null }], NOW)).toBeNull();
    expect(readingAge([{ computedAt: 'soon' }], NOW)).toBeNull();
    expect(readingAge([], NOW)).toBeNull();
  });
});

describe('the reading register says when it was computed', () => {
  const raw = {
    insights: [
      { candidate_key: 'a', sentence: 'Barolo sold 32% above its own average.', category: 'sales', score: 9, computed_at: at(2026, 11, 13, 6) },
      { candidate_key: 'b', sentence: 'Chianti is slowing.', category: 'sales', score: 3, computed_at: at(2026, 11, 12, 6) },
    ],
  };

  it('reads computed_at from the stored row', () => {
    const rows = reading.select(raw, { days: 30 });
    expect(rows.map((r) => r.computedAt)).toEqual([at(2026, 11, 13, 6), at(2026, 11, 12, 6)]);
  });

  it('prints the age as a figure and a note, and no longer claims an hourly cadence', () => {
    const rows = reading.select(raw, { days: 30 });
    const view = reading.view(rows, { days: 30 });
    const computed = view.figures.find((f) => f.label === 'Computed');
    expect(computed?.value).toMatch(/^(today|yesterday|on .+) at \d{1,2}:\d{2} [AP]M$/);
    expect(view.notes.join(' ')).toMatch(/The oldest sentence here was computed .+ read live/);
    expect(reading.window({ days: 30 })).not.toMatch(/hourly/);
    expect(String(reading.view([], { days: 30 }).say)).not.toMatch(/hourly/);
  });

  it('a live compute carries no time and says so', () => {
    const rows = reading.select({ insights: [{ candidate_key: 'a', sentence: 'x', score: 1 }] }, { days: 30 });
    expect(reading.view(rows, { days: 30 }).figures.find((f) => f.label === 'Computed')?.value).toBe(
      'as this page asked',
    );
  });
});
