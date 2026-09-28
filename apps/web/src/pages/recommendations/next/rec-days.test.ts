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
import {
  barHeight,
  buildDays,
  businessDate,
  fmtLongDay,
  posDaysFor,
  recordWords,
  touchesDay,
} from './rec-days';
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
  // September 2026 — the month NOW falls in, thirty days long.
  month: '2026-09',
  entries: [],
  goals: [],
  pos: { connected: true, from: day(21), to: day(0), byDay: {} },
  exclusions: [],
  now: NOW,
};

describe('buildDays — what the strip may claim about a day', () => {
  it('is one whole calendar month: the 1st to the last, and nothing rolling', () => {
    const cells = buildDays(base);
    expect(cells).toHaveLength(30);
    expect(cells[0].date).toBe('2026-09-01');
    expect(cells[29].date).toBe('2026-09-30');
    expect(cells.find((c) => c.isToday)!.date).toBe('2026-09-03');
  });

  it('knows how long each month is, leap year included', () => {
    expect(buildDays({ ...base, month: '2026-02' })).toHaveLength(28);
    expect(buildDays({ ...base, month: '2028-02' })).toHaveLength(29);
    expect(buildDays({ ...base, month: '2026-04' })).toHaveLength(30);
  });

  it('marks a day the window holds a record for, with the money that went through the till', () => {
    const cells = buildDays({ ...base, pos: { ...base.pos, byDay: { '2026-09-01': 612 } } });
    const hit = cells.find((c) => c.date === '2026-09-01')!;
    expect(hit.records).toBe('yes');
    expect(hit.revenue).toBe(612);
  });

  it('a day ABSENT from the sparse series carries no record — and no zero', () => {
    const cells = buildDays({ ...base, pos: { ...base.pos, byDay: { '2026-09-01': 612 } } });
    const blank = cells.find((c) => c.date === '2026-09-02')!;
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
    // The window the endpoint answered for starts on the 2nd; the 1st was
    // never asked about, and absence of an answer is not an answer.
    const cells = buildDays({
      ...base,
      pos: { connected: true, from: '2026-09-02', to: day(0), byDay: { '2026-09-03': 100 } },
    });
    expect(cells.find((c) => c.date === '2026-09-01')!.records).toBe('unknown');
    expect(cells.find((c) => c.date === '2026-09-02')!.records).toBe('none');
  });

  it('the future half of the month is neither hatched nor counted', () => {
    const cells = buildDays(base);
    const ahead = cells.find((c) => c.date === '2026-09-20')!;
    expect(ahead.isFuture).toBe(true);
    expect(ahead.records).toBe('future');
    // and the words say what that means, rather than implying an absence
    expect(recordWords(ahead)).toBe(
      'this day has not happened yet — that is neither a record nor an absence',
    );
    // every day after today is future; none of them is `none`
    expect(cells.filter((c) => c.isFuture)).toHaveLength(27);
    expect(cells.some((c) => c.isFuture && c.records === 'none')).toBe(false);
  });

  it('a month walked back shows its own days, and today is in none of them', () => {
    const cells = buildDays({ ...base, month: '2026-08' });
    expect(cells).toHaveLength(31);
    expect(cells.some((c) => c.isToday)).toBe(false);
    expect(cells.some((c) => c.isFuture)).toBe(false);
  });

  it('puts an entry on the day it FIRST FIRED, and an undated one on no day at all', () => {
    const cells = buildDays({
      ...base,
      entries: [
        entry({ firstSeenAt: '2026-09-01T10:00:00.000Z' }),
        entry({ ruleKey: 'staff_spread', firstSeenAt: null }),
      ],
    });
    expect(cells.find((c) => c.date === '2026-09-01')!.fired).toEqual(['stockout_imminent']);
    expect(cells.flatMap((c) => c.fired)).not.toContain('staff_spread');
    // and above all: not on today
    expect(cells.find((c) => c.isToday)!.fired).toEqual([]);
  });

  it('draws a goal deadline as falls-due, read as a business date and not through a timezone', () => {
    const cells = buildDays({
      ...base,
      goals: [goal({ deadline: '2026-09-07', sourceRuleKey: 'spend_acceleration' })],
    });
    const due = cells.find((c) => c.date === '2026-09-07')!;
    expect(due.due).toHaveLength(1);
    expect(due.due[0].kind).toBe('goal');
    expect(due.due[0].ruleKey).toBe('spend_acceleration');
  });

  it('draws a snoozed entry’s wake date as falls-due', () => {
    const cells = buildDays({
      ...base,
      entries: [entry({ snoozeUntil: '2026-09-05T08:00:00.000Z' })],
    });
    expect(cells.find((c) => c.date === '2026-09-05')!.due[0].kind).toBe('snooze');
  });

  it('strikes a day the manager ruled out, and carries the reason they gave', () => {
    const cells = buildDays({
      ...base,
      exclusions: [{ businessDate: '2026-09-02', reason: 'closed, kitchen refit' }],
    });
    const struck = cells.find((c) => c.date === '2026-09-02')!;
    expect(struck.excluded).toBe(true);
    expect(struck.excludedReason).toBe('closed, kitchen refit');
  });
});

describe('posDaysFor — asking the till for a window that reaches the month', () => {
  it('asks back to the 1st of the month on screen', () => {
    expect(posDaysFor('2026-09', '2026-09-03')).toBe(3);
    expect(posDaysFor('2026-08', '2026-09-03')).toBe(34);
  });

  it('never asks for less than a day, or more than the gateway’s 365', () => {
    // a month entirely ahead of today — the endpoint still needs a legal span
    expect(posDaysFor('2026-11', '2026-09-03')).toBe(1);
    // a month more than a year back cannot be covered, and is not pretended to be
    expect(posDaysFor('2020-01', '2026-09-03')).toBe(365);
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
