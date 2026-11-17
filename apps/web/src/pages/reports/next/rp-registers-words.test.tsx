/**
 * Three cards say what they are made from (r39 walk, F1-F3).
 *
 * F1: the restock, week and forecast cards headed themselves "the last 90
 * days" / "120 days of history" in a young house whose basis named a shorter
 * window. The window line now reads the payload's `observed` block.
 * F2: the week's `basis.trend` sentence, which says why the trend is withheld,
 * was never shown; the trend read a bare dash.
 * F3: "Lead time assumed 7" is untrue once each good takes its vendor's lead
 * (the restock reads it per good): the figure now says where the lead is from.
 */
import { describe, expect, it } from 'vitest';
import { ahead, week } from './rp-registers-trade';
import { restock } from './rp-registers-house';
import { observedSince, readObserved } from './rp-format';

const YOUNG = { windowDays: 90, observedDays: 12, rateDays: 12, since: '2026-11-05', young: true, firstRecord: 'read' };
const OLD = { windowDays: 90, observedDays: 90, rateDays: 90, since: null, young: false, firstRecord: 'read' };

describe('the observed block, read', () => {
  it('names the days and the day the house began, or nothing', () => {
    expect(observedSince(readObserved(YOUNG))).toEqual({ days: 12, date: 'Nov 5' });
    expect(observedSince(readObserved(OLD))).toBeNull();
    expect(observedSince(readObserved(undefined))).toBeNull();
    expect(observedSince(readObserved({ since: 'not a date', observedDays: 4 }))).toBeNull();
    expect(observedSince(readObserved({ since: '2026-11-05', observedDays: null }))).toBeNull();
  });
});

describe('F1: the window line says the days the house has', () => {
  const restockOf = (observed: unknown) =>
    restock.select({ params: { serviceLevel: 0.95, leadTimeDays: 7 }, basis: {}, skuCount: 3, reorderList: [], observed });
  const weekOf = (observed: unknown) => week.select({ weekdayProfile: [], basis: {}, observed });
  const aheadOf = (observed: unknown) => ahead.select({ history: {}, forecast: [], observed });

  it('restock', () => {
    expect(restock.window({ days: 30 }, restockOf(YOUNG))).toBe(
      'demand over 12 days since Nov 5, at the service level in the params',
    );
    expect(restock.window({ days: 30 }, restockOf(OLD))).toBe('demand over the last 90 days, at the service level in the params');
    expect(restock.window({ days: 30 })).toBe('demand over the last 90 days, at the service level in the params');
  });

  it('week', () => {
    expect(week.window({ days: 30 }, weekOf(YOUNG))).toBe('the consumption log, 12 days since Nov 5');
    expect(week.window({ days: 30 }, weekOf(OLD))).toBe('the last 90 days of the consumption log');
  });

  it('forecast', () => {
    expect(ahead.window({ days: 30 }, aheadOf(YOUNG))).toBe('12 days of history since Nov 5, 14 days ahead');
    expect(ahead.window({ days: 30 }, aheadOf(OLD))).toBe('120 days of history, 14 days ahead');
  });

  it('the week names the same days where it says nothing is recorded', () => {
    const v = week.view(weekOf(YOUNG), { days: 30 });
    expect(v.say).toBe('No consumption is recorded in the 12 days since Nov 5, so the week has no shape yet.');
  });
});

describe('F2: the week says why its trend is withheld', () => {
  const profile = ['Monday', 'Tuesday'].map((day) => ({ day, mean: 2, stdev: 1, n: 3 }));
  const TREND = 'No trend is drawn: the house has 12 days of records and a trend needs 14, two of each weekday.';

  it('puts the sentence in the working and on the dash itself', () => {
    const w = week.select({ weekdayProfile: profile, bestDay: null, worstDay: null, tie: true, trendPerDayPct: null, basis: { weekday: 'w', trend: TREND }, observed: YOUNG });
    const v = week.view(w, { days: 30 });
    expect(v.basis).toContain(TREND);
    const trend = v.figures.find((f) => f.label === '28-day trend, per day')!;
    expect(trend.value).toBe('—');
    expect(trend.note).toBe(TREND);
  });

  it('a house with a trend has no such sentence', () => {
    const w = week.select({ weekdayProfile: profile, trendPerDayPct: 0.02, basis: { weekday: 'w' } });
    const v = week.view(w, { days: 30 });
    expect(v.figures.find((f) => f.label === '28-day trend, per day')!.note).toBeUndefined();
  });
});

describe('F3: the lead time says where it comes from', () => {
  const lead = (params: Record<string, unknown>, skuCount = 40) =>
    restock
      .view(restock.select({ params: { serviceLevel: 0.95, leadTimeDays: 7, ...params }, basis: {}, skuCount, reorderList: [] }), { days: 30 })
      .figures.find((f) => f.label === 'Lead time')!.value;

  it("each vendor's own, and how many fell back to the assumption", () => {
    expect(lead({ leadTimeSource: 'vendor', leadTimeAssumed: 0 })).toBe("Each vendor's own");
    expect(lead({ leadTimeSource: 'vendor', leadTimeAssumed: 12 })).toBe("Each vendor's own; 7 days for 12 of 40");
    expect(lead({ leadTimeSource: 'vendor', leadTimeAssumed: 40 })).toBe('7 days for every wine; no vendor lead is recorded');
  });

  it('a lead the reader asked for is theirs', () => {
    expect(lead({ leadTimeSource: 'requested', leadTimeAssumed: 0, leadTimeDays: 5 })).toBe('5 days, as asked');
  });

  it('a gateway that does not say keeps the plain assumption, never "per vendor"', () => {
    expect(lead({})).toBe('7 days where no lead is known');
    expect(lead({ leadTimeSource: 'vendor' })).toBe('7 days where no lead is known');
  });
});
