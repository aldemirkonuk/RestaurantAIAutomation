/**
 * The 7-day average and the week/month grain together (r110 reports-r110-2).
 *
 * The rule: "Average a trading day, last 7" is a DAILY trail. It is offered
 * only at Day grain. A Week or Month bar is that bucket's Σ takings, and its
 * line choices are Σ checks and Σ takings ÷ Σ checks; a daily trail laid over
 * weekly buckets is meaningless, so it is never one of them, nor a pick a link
 * or a stored cutting can bring back.
 */

import { describe, expect, it } from 'vitest';
import { till, daysBetween, type TillWindow } from './rp-registers-trade';
import { planCombo } from './rp-combo';

// 90 house days to Fri 2026-11-27, every one rang up 7 checks for 700.
const span = daysBetween('2026-08-30', '2026-11-27');
const raw = (extra: object = {}) => ({
  posConnected: true,
  from: span[0],
  to: span[span.length - 1],
  days: 90,
  timezone: 'Europe/Istanbul',
  zoneUnset: false,
  revenue: 63000,
  checkCount: 630,
  dailySeries: span.map((date) => ({ date, revenue: 700, checks: 7 })),
  ...extra,
});
const read = (r: unknown) => till.select(r) as TillWindow;
const keys = (grain?: string, extra: object = {}) =>
  till.view(read(raw(extra)), { days: 90, currency: 'TRY', ...(grain ? { grain } : {}) }).cats?.measures?.map((m) => m.key);

describe('the 7-day average is a Day-grain measure only', () => {
  it('[REVERT-FAILS] at Day the same window offers it, so the rule below is not vacuous', () => {
    expect(keys()).toEqual(['checks', 'avg', 'trail7']);
    expect(keys('day')).toEqual(['checks', 'avg', 'trail7']);
  });

  it('[REVERT-FAILS] at Week and at Month it is not offered; the line choices are the bucket sums', () => {
    expect(keys('week')).toEqual(['checks', 'avg']);
    expect(keys('month')).toEqual(['checks', 'avg']);
  });

  it('[REVERT-FAILS] with no check counts, Week offers no second measure at all, not the trail', () => {
    const uncounted = { dailySeries: span.map((date) => ({ date, revenue: 700 })) };
    expect(keys(undefined, uncounted)).toEqual(['trail7']);
    expect(keys('week', uncounted)).toBeUndefined();
    expect(keys('month', uncounted)).toBeUndefined();
  });

  it('[REVERT-FAILS] a stored pick naming the trail falls back at Week instead of drawing it', () => {
    const view = till.view(read(raw()), { days: 90, currency: 'TRY', grain: 'week' });
    const plan = planCombo(view.cats!, { bars: 'value', line: 'trail7' })!;
    expect(plan.measures.map((m) => m.key)).not.toContain('trail7');
    expect(plan.pick.line).not.toBe('trail7');
  });

  it('a grain the window does not offer draws days, and the trail with them', () => {
    // 30 days offers Day and Week only: a ?grain=month link reads as Day.
    const days30 = span.slice(-30);
    const at30 = till.view(
      read(raw({ from: days30[0], days: 30, dailySeries: days30.map((date) => ({ date, revenue: 700, checks: 7 })) })),
      { days: 30, currency: 'TRY', grain: 'month' },
    );
    expect(at30.cats!.xLabel).toBe('day');
    expect(at30.cats!.measures!.map((m) => m.key)).toContain('trail7');
  });

  it('a staff reader at Week is offered neither measure: the till is withheld before any drawing', () => {
    const view = till.view(read(raw({ salesWithheld: true, dailySeries: [] })), {
      days: 90,
      currency: 'TRY',
      grain: 'week',
    });
    expect(view.withheld).toBe(true);
    expect(view.cats).toBeUndefined();
  });
});
