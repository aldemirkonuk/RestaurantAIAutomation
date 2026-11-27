/**
 * "Read a stretch" on the till (r108 g3). The sums are money of record, so
 * they are pinned here: a day the till could not state is never a 0, checks
 * and the average are said only when every day carries its count, and the
 * average is Σ taken ÷ Σ checks, never the mean of each day's average.
 */
import { describe, expect, it } from 'vitest';
import { moneyIn } from './rp-format';
import { daysBetween, till, type TillWindow } from './rp-registers-trade';
import {
  NO_STRETCH,
  readStretch,
  stretchSpan,
  stretchStep,
  stretchWords,
  type StretchEvent,
} from './rp-stretch';

const WEEK = daysBetween('2026-11-04', '2026-11-09'); // Wed 4 .. Mon 9

const win = (over: Partial<TillWindow> = {}): TillWindow => ({
  posConnected: true,
  salesWithheld: false,
  revenue: null,
  checkCount: null,
  from: WEEK[0],
  to: WEEK[WEEK.length - 1],
  days: WEEK.length,
  timezone: 'Europe/Istanbul',
  zoneUnset: false,
  dailySeries: [
    { date: '2026-11-04', revenue: 100, checks: 10 },
    { date: '2026-11-05', revenue: 900, checks: 30 },
    { date: '2026-11-06', revenue: 400, checks: 20 },
    { date: '2026-11-07', revenue: 1200, checks: 40 },
    { date: '2026-11-08', revenue: 1000, checks: 50 },
    { date: '2026-11-09', revenue: 520, checks: 62 },
  ],
  prior: null,
  ...over,
});

const usd = moneyIn('USD');

describe('read a stretch: the sums', () => {
  it('[REVERT-FAILS] takes the sum of the stretch and says its days, checks and average', () => {
    const r = readStretch(win(), WEEK, 0, 5)!;
    expect(r.taken).toBe(4120);
    expect(r.checks).toBe(212);
    expect(r.average).toBeCloseTo(4120 / 212, 10);
    expect(stretchWords(r, usd)).toBe(
      'Wed, Nov 4 – Mon, Nov 9 · 6 days · Taken $4,120 · 212 checks · average $19.43',
    );
  });

  it('[REVERT-FAILS] reads either direction of a drag the same', () => {
    expect(readStretch(win(), WEEK, 4, 1)).toEqual(readStretch(win(), WEEK, 1, 4));
  });

  it('[REVERT-FAILS] a day the till could not state is never a 0, and the line says so', () => {
    const w = win({
      dailySeries: win().dailySeries.map((d) => (d.date === '2026-11-06' ? { ...d, revenue: null } : d)),
    });
    const r = readStretch(w, WEEK, 0, 5)!;
    expect(r.taken).toBe(3720);
    expect(r.unknownDays).toBe(1);
    // An average over a sum with a hole in it would be a guess.
    expect(r.average).toBeNull();
    expect(stretchWords(r, usd)).toContain('Taken $3,720 over 5 of 6 days; 1 day the till could not state');
  });

  it('[REVERT-FAILS] a stretch of only days the till could not state has no figure at all', () => {
    const w = win({ dailySeries: [{ date: '2026-11-05', revenue: null, checks: null }] });
    const r = readStretch(w, WEEK, 1, 1)!;
    expect(r.taken).toBeNull();
    expect(stretchWords(r, usd)).toContain('Taken: the till could not state these days');
    expect(stretchWords(r, usd)).not.toContain('$0');
  });

  it('[REVERT-FAILS] a day absent from the sparse series rang no check: it adds nothing and is not unknown', () => {
    const w = win({ dailySeries: win().dailySeries.filter((d) => d.date !== '2026-11-06') });
    const r = readStretch(w, WEEK, 1, 3)!;
    expect(r).toMatchObject({ taken: 2100, unknownDays: 0, checks: 70 });
    expect(r.average).toBeCloseTo(30, 10);
  });

  it('[REVERT-FAILS] checks and the average only when every day carries its count', () => {
    const w = win({
      dailySeries: win().dailySeries.map((d) => (d.date === '2026-11-07' ? { ...d, checks: null } : d)),
    });
    const r = readStretch(w, WEEK, 0, 5)!;
    expect(r.taken).toBe(4120);
    expect(r.checks).toBeNull();
    expect(r.average).toBeNull();
    const words = stretchWords(r, usd);
    expect(words).toContain('checks a day are not read');
    expect(words).not.toContain('average');
    // The days outside the missing one still have their count.
    expect(readStretch(w, WEEK, 0, 2)!.checks).toBe(60);
  });

  it('[REVERT-FAILS] the average is the sum over the sum, not the mean of daily averages, on unequal days', () => {
    // 100/10 = 10 a check and 900/30 = 30 a check: the mean of the two is 20,
    // but 1000 taken over 40 checks is 25.
    const r = readStretch(win(), WEEK, 0, 1)!;
    expect(r.average).toBe(25);
    expect(stretchWords(r, usd)).toContain('average $25.00');
  });

  it('[REVERT-FAILS] money is the house’s: a TRY house reads lira, never a dollar', () => {
    const words = stretchWords(readStretch(win(), WEEK, 0, 5)!, moneyIn('TRY'));
    expect(words).toContain('Taken ₺4,120');
    expect(words).toContain('average ₺19.43');
    expect(words).not.toContain('$');
  });

  it('[REVERT-FAILS] a withheld read offers no stretch', () => {
    expect(readStretch(win({ salesWithheld: true }), WEEK, 0, 5)).toBeUndefined();
    expect(readStretch(win({ posConnected: false }), WEEK, 0, 5)).toBeUndefined();
    expect(readStretch(win({ zoneUnset: true }), WEEK, 0, 5)).toBeUndefined();
  });

  it('[REVERT-FAILS] the days are the gateway’s keys, read as sent', () => {
    // A 25-hour day is still one key; nothing is re-filed by timestamp.
    expect(readStretch(win(), WEEK, 2, 3)!.days).toEqual(['2026-11-06', '2026-11-07']);
  });
});

describe('read a stretch: with compare on', () => {
  const PRIOR = daysBetween('2026-10-29', '2026-11-03');
  const prior = (rows: Array<{ date: string; revenue: number | null }>) => ({
    from: PRIOR[0],
    to: PRIOR[PRIOR.length - 1],
    revenue: null,
    dailySeries: rows,
  });

  it('[REVERT-FAILS] says the aligned prior days and the change when every one is known', () => {
    const w = win({ prior: prior([{ date: '2026-10-29', revenue: 50 }, { date: '2026-10-30', revenue: 750 }]) });
    const r = readStretch(w, WEEK, 0, 1, PRIOR)!;
    expect(r.prior).toBe(800);
    expect(stretchWords(r, usd)).toContain('prior $800 (+25.0%)');
  });

  it('[REVERT-FAILS] says no prior when an aligned prior day is unknown', () => {
    const w = win({ prior: prior([{ date: '2026-10-29', revenue: 50 }, { date: '2026-10-30', revenue: null }]) });
    const r = readStretch(w, WEEK, 0, 1, PRIOR)!;
    expect(r.prior).toBeNull();
    expect(stretchWords(r, usd)).not.toContain('prior');
    // A stretch clear of the unknown prior day still has its prior.
    expect(readStretch(w, WEEK, 0, 0, PRIOR)!.prior).toBe(50);
  });

  it('[REVERT-FAILS] says no prior when the prior does not line up with the window', () => {
    const w = win({ prior: prior([{ date: '2026-10-29', revenue: 50 }]) });
    expect(readStretch(w, WEEK, 0, 1, PRIOR.slice(1))!.prior).toBeNull();
    expect(readStretch(w, WEEK, 0, 1, null)!.prior).toBeNull();
  });
});

describe('read a stretch: the picking', () => {
  const run = (events: StretchEvent[]) => events.reduce(stretchStep, NO_STRETCH);

  it('[REVERT-FAILS] a press-drag marks from where it went down to where it let go', () => {
    const s = run([{ type: 'down', at: 4 }, { type: 'move', at: 2 }, { type: 'move', at: 1 }, { type: 'up', at: 1 }]);
    expect(s.settled).toBe(true);
    expect(stretchSpan(s)).toEqual([1, 4]);
  });

  it('[REVERT-FAILS] a tap then a tap marks a first and a last day (the single-pointer path)', () => {
    const half = run([{ type: 'down', at: 1 }, { type: 'up', at: 1 }]);
    expect(half.settled).toBe(false);
    expect(stretchSpan(half)).toEqual([1, 1]);
    const done = run([{ type: 'down', at: 1 }, { type: 'up', at: 1 }, { type: 'down', at: 5 }, { type: 'up', at: 5 }]);
    expect(done.settled).toBe(true);
    expect(stretchSpan(done)).toEqual([1, 5]);
  });

  it('[REVERT-FAILS] a press on a settled stretch starts a new one; a clear leaves nothing marked', () => {
    const s = run([{ type: 'down', at: 0 }, { type: 'move', at: 3 }, { type: 'up' }, { type: 'down', at: 5 }]);
    expect(stretchSpan(s)).toEqual([5, 5]);
    expect(stretchSpan(stretchStep(s, { type: 'clear' }))).toBeNull();
  });

  it('[REVERT-FAILS] a move with no press down marks nothing', () => {
    expect(run([{ type: 'move', at: 3 }])).toEqual(NO_STRETCH);
  });
});

describe('the till offers the stretch', () => {
  const raw = {
    posConnected: true,
    revenue: 4120,
    checkCount: 212,
    from: WEEK[0],
    to: WEEK[WEEK.length - 1],
    days: 6,
    timezone: 'Europe/Istanbul',
    dailySeries: win().dailySeries,
  };

  it('[REVERT-FAILS] its drawing carries the stretch, read on the house’s money', () => {
    const view = till.view(till.select(raw) as TillWindow, { days: 6, currency: 'USD' });
    expect(view.cats!.stretch!(0, 5)).toBe(
      'Wed, Nov 4 – Mon, Nov 9 · 6 days · Taken $4,120 · 212 checks · average $19.43',
    );
    expect(view.cats!.stretchFrom!(2)).toContain('From Fri, Nov 6.');
  });

  it('[REVERT-FAILS] a withheld read has no drawing to stretch', () => {
    const view = till.view(till.select({ ...raw, salesWithheld: true }) as TillWindow, { days: 6, currency: 'USD' });
    expect(view.cats).toBeUndefined();
  });
});

describe('the keyboard step (DD-r108-41)', () => {
  it('[REVERT-FAILS] the first Shift+Arrow anchors where the keyboard was, and reads at once', () => {
    const s = stretchStep(NO_STRETCH, { type: 'key', from: 2, to: 3 });
    expect(stretchSpan(s)).toEqual([2, 3]);
    expect(s.settled).toBe(true);
    expect(s.down).toBe(false);
  });

  it('a day already marked stays the anchor; the key moves only the last day', () => {
    const tapped = [{ type: 'down', at: 5 }, { type: 'up', at: 5 }] as StretchEvent[];
    const s = [...tapped, { type: 'key', from: 5, to: 4 } as StretchEvent, { type: 'key', from: 4, to: 3 } as StretchEvent].reduce(
      stretchStep,
      NO_STRETCH,
    );
    expect(stretchSpan(s)).toEqual([3, 5]);
  });
});
