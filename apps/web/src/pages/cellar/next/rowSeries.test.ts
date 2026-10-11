/**
 * The velocity and hours series, and the two faults they refuse to inherit
 * from `/inventory`'s equivalent.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { velocity, whenItSells, type TillLine } from './rowSeries';

const line = (at: string, qty: number): TillLine => ({ at, qty, unitPrice: 18 });

describe('velocity — clipped to the days there is evidence for', () => {
  it('covers only the span between the first and last till line', () => {
    const v = velocity([
      line('2026-08-20T18:00:00Z', 2),
      line('2026-08-22T19:00:00Z', 3),
    ]);
    expect(v.days.map((d) => d.date)).toEqual([
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
    ]);
    // A day inside the window with nothing rung up IS a zero: the till was
    // reading. A day outside it is not drawn at all.
    expect(v.days[1].qty).toBe(0);
    expect(v.clipped).toBe(false);
  });

  it('never zero-fills backwards to a fixed 14 days', () => {
    // The fault: `/inventory` pushes 14 dense days regardless, so a house with
    // one day of POS data sees thirteen zero-sales days it never had.
    const v = velocity([line('2026-08-24T17:33:00Z', 5)]);
    expect(v.days).toHaveLength(1);
    expect(v.days[0]).toEqual({ date: '2026-08-24', qty: 5 });
    expect(v.perDay).toBe(5);
  });

  it('caps at the window and says it was capped', () => {
    const lines = Array.from({ length: 40 }, (_, i) =>
      line(`2026-07-${String(i + 1).padStart(2, '0')}T12:00:00Z`, 1),
    ).slice(0, 30);
    const v = velocity(lines, 14);
    expect(v.days).toHaveLength(14);
    expect(v.clipped).toBe(true);
  });

  it('an undated line is not given an instant', () => {
    const v = velocity([{ at: null, qty: 9, unitPrice: 1 }]);
    expect(v.days).toHaveLength(0);
    expect(v.perDay).toBeNull();
  });

  it('no lines is no series — never a flat line at zero', () => {
    const v = velocity([]);
    expect(v).toEqual({ days: [], from: null, to: null, perDay: null, clipped: false });
  });
});

describe('when it sells — over the hours this house actually sells in', () => {
  it('places lines on their own weekday and hour, and finds the peak', () => {
    const w = whenItSells([
      line('2026-08-24T17:33:00Z', 2),
      line('2026-08-24T17:40:00Z', 3),
      line('2026-08-25T12:10:00Z', 1),
    ]);
    expect(w.peak?.qty).toBe(5);
    expect(w.buckets).toHaveLength(2);
  });

  it('keeps a lunch service — no fixed 16:00-23:00 window', () => {
    // `/inventory`'s heatmap is a 7x8 matrix of 16:00..23:00 only, which drops
    // every lunch and every café outright. A café is exactly the house the
    // fourth pass is about.
    const w = whenItSells([line('2026-08-25T09:15:00Z', 4)]);
    expect(w.buckets).toHaveLength(1);
    expect(w.hours.length).toBe(1);
    expect(w.peak?.qty).toBe(4);
  });

  it('drops a bucket that summed to nothing rather than drawing an empty cell', () => {
    const w = whenItSells([{ at: '2026-08-25T09:15:00Z', qty: 0, unitPrice: null }]);
    expect(w.buckets).toHaveLength(0);
    expect(w.peak).toBeNull();
  });
});

describe('one clock for the bars and the grid — an LA evening (F-327)', () => {
  // The suite runs in New York; the house here is in Los Angeles, where the UTC
  // date is already tomorrow from 17:00 on.
  let tz: string | undefined;
  beforeEach(() => {
    tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
  });
  afterEach(() => {
    process.env.TZ = tz;
  });

  it('puts a Friday 20:00 sale on Friday’s bar, the same day as its 8pm cell', () => {
    // Fri 2026-08-28 20:00 PDT is Sat 03:00 UTC.
    const sale = [line('2026-08-29T03:00:00Z', 2)];
    const v = velocity(sale);
    expect(v.days).toEqual([{ date: '2026-08-28', qty: 2 }]);
    expect(v.to).toBe('2026-08-28');
    const w = whenItSells(sale);
    expect(w.buckets).toEqual([{ dow: 4, hour: 20, qty: 2 }]);
  });

  it('draws one bar per day across the night the clocks go back', () => {
    // 2026-11-01 is 25 hours long in Los Angeles.
    const v = velocity([line('2026-10-31T19:00:00Z', 1), line('2026-11-02T20:00:00Z', 1)]);
    expect(v.days.map((d) => d.date)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
  });
});

describe('the house’s clock, not the reader’s (F-1222, rehit of F-327)', () => {
  // The reader is in Los Angeles; the house is in Istanbul.
  let tz: string | undefined;
  beforeEach(() => {
    tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
  });
  afterEach(() => {
    process.env.TZ = tz;
  });

  it('puts a Saturday 01:30 Istanbul sale on Saturday’s bar and 1am cell', () => {
    // Sat 2026-08-29 01:30 in Istanbul is Fri 2026-08-28 15:30 in Los Angeles.
    const sale = [line('2026-08-28T22:30:00Z', 3)];
    const v = velocity(sale, 14, 'Europe/Istanbul');
    expect(v.days).toEqual([{ date: '2026-08-29', qty: 3 }]);
    const w = whenItSells(sale, 'Europe/Istanbul');
    expect(w.buckets).toEqual([{ dow: 5, hour: 1, qty: 3 }]);
  });

  it('counts the 14-day window in the house’s days', () => {
    const lines = Array.from({ length: 20 }, (_, i) =>
      line(`2026-07-${String(i + 1).padStart(2, '0')}T22:30:00Z`, 1),
    );
    const v = velocity(lines, 14, 'Europe/Istanbul');
    expect(v.days).toHaveLength(14);
    expect(v.to).toBe('2026-07-21');
    expect(v.from).toBe('2026-07-08');
    expect(v.clipped).toBe(true);
  });
});
