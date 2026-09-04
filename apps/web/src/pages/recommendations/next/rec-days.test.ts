/**
 * The ribbon's day model — and the four states a blank day can be in.
 *
 * The load-bearing tests here are the ones that refuse to draw something:
 * a day the till window holds nothing for is `none` (hatched), a day nobody
 * could read is `unknown` (drawn plain), a day that has not happened is
 * `future`, and an entry with no first-fired date is on NO day at all rather
 * than on today. "Wednesday sales came in 100% lower" was a closure being read
 * as a measurement; this model is where that distinction is kept.
 */

import { describe, expect, it } from 'vitest';
import { barHeight, buildDays, businessDate, fmtLongDay, touchesDay } from './rec-days';
import type { EntryVM, GoalRow } from './useRecommendationsNextData';

const NOW = new Date('2026-09-03T18:00:00.000Z');
const day = (back: number) =>
  new Date(NOW.getTime() - back * 86_400_000).toISOString().substring(0, 10);

const entry = (over: Partial<EntryVM> = {}): EntryVM =>
  ({
    ruleKey: 'stockout_imminent',
    observation: '',
    recommendation: '',
    rationale: null,
    category: 'inventory',
    urgency: 'now',
    stake: 'stock',
    hand: { href: '/orders', label: 'Draft the PO', where: 'Orders' },
    score: 3,
    pinned: false,
    acted: false,
    status: 'active',
    reason: null,
    snoozeUntil: null,
    feedback: null,
    assignedTo: null,
    assignedName: null,
    updatedAt: null,
    firstSeenAt: null,
    subject: null,
    periodKey: null,
    suppression: null,
    ...over,
  }) as EntryVM;

const goal = (over: Partial<GoalRow> = {}): GoalRow => ({
  id: 'g1',
  name: 'Hold purchasing spend',
  metricKey: 'purchase_spend',
  targetValue: 9000,
  currentValue: 1000,
  deadline: null,
  status: 'active',
  sourceRuleKey: null,
  ...over,
});

const base = {
  entries: [],
  goals: [],
  pos: { connected: true, from: day(21), to: day(0), byDay: {} },
  exclusions: [],
  now: NOW,
};

describe('buildDays — what the strip may claim about a day', () => {
  it('is always the same length: 21 behind, today, and the 7 a deadline can fall in', () => {
    const cells = buildDays(base);
    expect(cells).toHaveLength(29);
    expect(cells[0].date).toBe(day(21));
    expect(cells[21].isToday).toBe(true);
    expect(cells[28].isFuture).toBe(true);
  });

  it('marks a day the window holds a record for, with the money that went through the till', () => {
    const cells = buildDays({ ...base, pos: { ...base.pos, byDay: { [day(3)]: 612 } } });
    const hit = cells.find((c) => c.date === day(3))!;
    expect(hit.records).toBe('yes');
    expect(hit.revenue).toBe(612);
  });

  it('a day ABSENT from the sparse series carries no record — and no zero', () => {
    const cells = buildDays({ ...base, pos: { ...base.pos, byDay: { [day(3)]: 612 } } });
    const blank = cells.find((c) => c.date === day(4))!;
    expect(blank.records).toBe('none');
    // null, never 0: "we wrote nothing down" is not "they took nothing".
    expect(blank.revenue).toBeNull();
  });

  it('claims nothing about any day when the window could not be read', () => {
    for (const pos of [null, undefined] as const) {
      const cells = buildDays({ ...base, pos });
      expect(cells.every((c) => c.records === 'unknown' || c.isFuture)).toBe(true);
    }
  });

  it('claims nothing about any day when no till is connected', () => {
    const cells = buildDays({ ...base, pos: { connected: false, from: '', to: '', byDay: {} } });
    expect(cells.some((c) => c.records === 'none')).toBe(false);
  });

  it('never calls a day outside the window read “none”', () => {
    // The window the endpoint answered for is 21 days; a strip cell older than
    // its `from` was never asked about, and absence of an answer is not an
    // answer.
    const cells = buildDays({
      ...base,
      pos: { connected: true, from: day(5), to: day(0), byDay: { [day(2)]: 100 } },
    });
    expect(cells.find((c) => c.date === day(10))!.records).toBe('unknown');
    expect(cells.find((c) => c.date === day(4))!.records).toBe('none');
  });

  it('a future day is neither hatched nor counted', () => {
    const cells = buildDays(base);
    const ahead = cells[25];
    expect(ahead.isFuture).toBe(true);
    expect(ahead.records).toBe('future');
  });

  it('puts an entry on the day it FIRST FIRED, and an undated one on no day at all', () => {
    const cells = buildDays({
      ...base,
      entries: [
        entry({ firstSeenAt: `${day(6)}T10:00:00.000Z` }),
        entry({ ruleKey: 'staff_spread', firstSeenAt: null }),
      ],
    });
    expect(cells.find((c) => c.date === day(6))!.fired).toEqual(['stockout_imminent']);
    expect(cells.flatMap((c) => c.fired)).not.toContain('staff_spread');
    // and above all: not on today
    expect(cells.find((c) => c.isToday)!.fired).toEqual([]);
  });

  it('draws a goal deadline as falls-due, read as a business date and not through a timezone', () => {
    const cells = buildDays({
      ...base,
      goals: [goal({ deadline: day(-4), sourceRuleKey: 'spend_acceleration' })],
    });
    const due = cells.find((c) => c.date === day(-4))!;
    expect(due.due).toHaveLength(1);
    expect(due.due[0].kind).toBe('goal');
    expect(due.due[0].ruleKey).toBe('spend_acceleration');
  });

  it('draws a snoozed entry’s wake date as falls-due', () => {
    const cells = buildDays({
      ...base,
      entries: [entry({ snoozeUntil: `${day(-2)}T08:00:00.000Z` })],
    });
    expect(cells.find((c) => c.date === day(-2))!.due[0].kind).toBe('snooze');
  });

  it('strikes a day the manager ruled out, and carries the reason they gave', () => {
    const cells = buildDays({
      ...base,
      exclusions: [{ businessDate: day(9), reason: 'closed, kitchen refit' }],
    });
    const struck = cells.find((c) => c.date === day(9))!;
    expect(struck.excluded).toBe(true);
    expect(struck.excludedReason).toBe('closed, kitchen refit');
  });
});

describe('touchesDay — what a selection may narrow to', () => {
  const e = entry({ ruleKey: 'spend_acceleration', firstSeenAt: `${day(6)}T10:00:00.000Z` });

  it('is true on the day it first fired', () => {
    expect(touchesDay(e, day(6), [])).toBe(true);
    expect(touchesDay(e, day(5), [])).toBe(false);
  });

  it('is true on the day a goal that NAMES THIS RULE falls due', () => {
    const goals = [goal({ deadline: day(-3), sourceRuleKey: 'spend_acceleration' })];
    expect(touchesDay(e, day(-3), goals)).toBe(true);
  });

  it('is false for a hand-set goal on the same day — a goal with no source watches nothing', () => {
    const goals = [goal({ deadline: day(-3), sourceRuleKey: null })];
    expect(touchesDay(e, day(-3), goals)).toBe(false);
  });

  it('is false everywhere for an entry nothing recorded a first sighting of', () => {
    const blind = entry({ firstSeenAt: null });
    expect(buildDays(base).every((c) => !touchesDay(blind, c.date, []))).toBe(true);
  });
});

describe('the strip’s small helpers', () => {
  it('reads a business date in UTC, and refuses one that will not parse', () => {
    expect(businessDate('2026-09-02T23:30:00.000Z')).toBe('2026-09-02');
    expect(businessDate('not a date')).toBeNull();
    expect(businessDate(null)).toBeNull();
  });

  it('draws no bar for a count of zero, and caps the tallest', () => {
    expect(barHeight(0)).toBe(0);
    expect(barHeight(1)).toBe(5);
    expect(barHeight(99)).toBe(18);
  });

  it('writes the long day out rather than trusting the runtime’s ICU', () => {
    expect(fmtLongDay('2026-09-02')).toBe('Wednesday 2 September');
    expect(fmtLongDay('nope')).toBe('nope');
  });
});
