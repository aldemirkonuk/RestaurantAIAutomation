/**
 * "Draw only these days" (r110 g1), the pure half: a zoom is one slice of the
 * one series, so the bars, every measure, the dashed prior and the stretch
 * readout inside the zoom name the same days they named outside it.
 */
import { describe, expect, it } from 'vitest';
import { daysBetween, till, type TillWindow } from './rp-registers-trade';
import { zoomAllLabel, zoomKey, zoomNote, zoomOffered, zoomSeries, zoomSpan } from './rp-zoom';

const DAYS = daysBetween('2025-11-28', '2026-11-27');
/** 60 days and the 60 before them: a compare read. */
const PAIR = daysBetween('2026-07-31', '2026-11-27');
const row = (date: string, i: number) => ({ date, revenue: 100 + ((i * 37) % 500), checks: 1 + (i % 20) });

function tillOf(days: string[], extra: Partial<TillWindow> = {}): TillWindow {
  return {
    posConnected: true,
    revenue: 1,
    checkCount: 1,
    from: days[0],
    to: days[days.length - 1],
    days: days.length,
    timezone: 'Europe/Istanbul',
    dailySeries: days.map(row),
    ...extra,
  } as TillWindow;
}
const year = () => till.view(till.select(tillOf(DAYS)) as TillWindow, { days: 365, currency: 'USD' }).cats!;

describe('zoomSeries', () => {
  it('[REVERT-FAILS] slots 10..50 of 365 days are 41 days, the same days, every measure sliced with them', () => {
    const all = year();
    expect(all.data).toHaveLength(365);
    const z = zoomSeries(all, 10, 50);
    expect(z.data).toHaveLength(41);
    expect(z.data.map((d) => d.label)).toEqual(all.data.slice(10, 51).map((d) => d.label));
    expect(z.data.map((d) => d.value)).toEqual(all.data.slice(10, 51).map((d) => d.value));
    expect(all.measures!.length).toBeGreaterThan(0);
    z.measures!.forEach((m, k) => {
      expect(m.values).toHaveLength(41);
      expect(m.values).toEqual(all.measures![k].values.slice(10, 51));
    });
  });

  it('[REVERT-FAILS] the stretch inside a zoom names the same days as outside it (re-indexed by +a)', () => {
    const all = year();
    const z = zoomSeries(all, 10, 50);
    expect(z.stretch!(0, 40)).toBe(all.stretch!(10, 50));
    expect(z.stretch!(3, 7)).toBe(all.stretch!(13, 17));
    expect(z.stretchFrom!(0)).toBe(all.stretchFrom!(10));
  });

  it('keeps prior on each day, so the compare stays aligned', () => {
    const read = tillOf(PAIR);
    const all = till.view(till.select(read) as TillWindow, { days: 60, compare: true, currency: 'USD' }).cats!;
    expect(all.data).toHaveLength(60);
    expect(all.data.some((d) => d.prior != null)).toBe(true);
    const z = zoomSeries(all, 10, 50);
    expect(z.data.map((d) => d.prior)).toEqual(all.data.slice(10, 51).map((d) => d.prior));
    expect(z.priorLabel).toBe(all.priorLabel);
  });

  it('drops a rule that names a day outside the zoom and keeps one across the plot', () => {
    const all = { ...year(), refs: [{ x: year().data[5].label, label: 'seam' }, { x: year().data[20].label, label: 'in' }, { y: 300, label: 'target' }] };
    expect(zoomSeries(all, 10, 50).refs!.map((r) => r.label)).toEqual(['in', 'target']);
  });
});

describe('zoom words and offers', () => {
  it('[REVERT-FAILS] the caption says how many of the window and which days', () => {
    const all = year();
    expect(zoomNote(all, 10, 50)).toBe(`41 of 365 days, ${all.data[10].label} to ${all.data[50].label}`);
    expect(zoomAllLabel(all)).toBe('All 365 days');
  });

  it('a stretch of two days or more is offered; one day is not; either order, clamped', () => {
    const all = year();
    expect(zoomSpan(all, 50, 10)).toEqual([10, 50]);
    expect(zoomSpan(all, 7, 8)).toEqual([7, 8]);
    expect(zoomSpan(all, 7, 7)).toBeNull();
    expect(zoomSpan(all, 360, 400)).toEqual([360, 364]);
  });

  it('[REVERT-FAILS] not offered on a withheld read, at week or month grain, or with no stretch', () => {
    const all = year();
    expect(zoomOffered(all)).toBe(true);
    const withheld = till.view(till.select(tillOf(DAYS, { salesWithheld: true } as never)) as TillWindow, { days: 365, currency: 'USD' });
    expect(withheld.cats?.stretch).toBeUndefined();
    if (withheld.cats) expect(zoomOffered(withheld.cats)).toBe(false);
    expect(zoomOffered({ ...all, xLabel: 'week' })).toBe(false);
    expect(zoomOffered({ ...all, xLabel: 'month' })).toBe(false);
    const { stretch: _s, ...plain } = all;
    expect(zoomOffered(plain)).toBe(false);
  });

  it('a window, a grain or a Draw as is another zoom key', () => {
    const all = year();
    const k = zoomKey(all, 'bars');
    expect(zoomKey(all, 'bars')).toBe(k);
    expect(zoomKey(all, 'line')).not.toBe(k);
    expect(zoomKey({ ...all, xLabel: 'week' }, 'bars')).not.toBe(k);
    expect(zoomKey({ ...all, data: all.data.slice(-90) }, 'bars')).not.toBe(k);
  });
});
