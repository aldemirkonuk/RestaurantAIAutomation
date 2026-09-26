import { describe, expect, it } from 'vitest';
import {
  deltaSince,
  fillOf,
  inUnit,
  paceOf,
  quietTierWords,
  suggestGoal,
  toGoalBook,
  toProgressRow,
} from './rec-masthead';
import type { EntryVM, GoalRow } from './useRecommendationsNextData';

const e = (ruleKey: string, over: Partial<EntryVM> = {}) =>
  ({ ruleKey, category: 'sales', urgency: 'now', subject: null, ...over }) as EntryVM;
const goal = (metricKey: string): GoalRow => ({
  id: metricKey,
  name: metricKey,
  metricKey,
  targetValue: 1,
  currentValue: 0,
  deadline: null,
  status: 'active',
  sourceRuleKey: null,
});

describe('the margin, read from the progress endpoint', () => {
  it('reads a goal and its pace; an unread one keeps its target and loses every measured figure', () => {
    const ok = toProgressRow({
      goal: { id: 'g', name: 'Spend', metric_key: 'purchase_spend', direction: 'at_most' },
      unit: 'currency',
      current: '6180',
      target: 9500,
      progressPct: 0.65,
      onTrack: false,
      daysLeft: 14,
    });
    expect(ok).toMatchObject({ current: 6180, target: 9500, direction: 'at_most', unreadable: null });
    expect(paceOf(ok)).toBe('Behind');
    expect(fillOf(ok)).toBeCloseTo(0.65);

    const bad = toProgressRow({ goal: { id: 'b', target_value: '12' }, unreadable: true });
    expect(bad).toMatchObject({ current: null, target: 12, progressPct: null, onTrack: null, unreadable: 'no reason given' });
    expect(paceOf(bad)).toBe('Not read');
    expect(fillOf(bad)).toBeNull();
  });

  it('a goal with no deadline has no pace — said, not guessed; an over-target bar is clamped', () => {
    const r = toProgressRow({ goal: { id: 'x' }, current: 20, target: 10, progressPct: 2, onTrack: null });
    expect(paceOf(r)).toBe('No deadline');
    expect(fillOf(r)).toBe(1);
  });

  it('a response with no goals array is unreadable (null), not an empty book', () => {
    expect(toGoalBook({ nope: true })).toBeNull();
    expect(toGoalBook(null)).toBeNull();
    expect(toGoalBook({ goals: [], total: 0 })).toEqual({ goals: [], total: 0, truncated: false });
  });

  it('prints a figure in its own unit and never invents a currency symbol', () => {
    expect(inUnit(6180, 'currency')).toBe('6,180');
    expect(inUnit(0.6, 'percent')).toBe('60%');
    expect(inUnit(null, 'units')).toBe('—');
  });
});

describe('the suggestion', () => {
  it('names the first entry whose rule maps to a figure no goal watches', () => {
    const s = suggestGoal([e('stockout_imminent'), e('weekday_gap')], []);
    expect(s?.entry.ruleKey).toBe('weekday_gap');
    expect(s?.plan.metricKey).toBe('wine_revenue');
  });
  it('skips a figure already held, and suggests nothing from an unread goal list', () => {
    expect(suggestGoal([e('weekday_gap')], [goal('wine_revenue')])).toBeNull();
    expect(suggestGoal([e('weekday_gap')], null)).toBeNull();
    expect(suggestGoal([e('weekday_gap')], undefined)).toBeNull();
  });
});

describe('the quiet tier, as its substitute (Q4)', () => {
  it('names the sources that did not answer', () => {
    expect(quietTierWords(['goals'])).toBe(
      'The engine could not read one of its sources (goals), so entries that depend on it could not fire.',
    );
    expect(quietTierWords(['a', 'b', 'c'])).toMatch(/3 of its sources \(a, b and c\)/);
  });
  it('says "not stated" for an absent field, and "every source answered" only for an empty list', () => {
    expect(quietTierWords(null)).toMatch(/does not say/);
    expect(quietTierWords(undefined)).toMatch(/does not say/);
    expect(quietTierWords([])).toMatch(/Every source/);
  });
});

describe('the delta, per reader (Q9)', () => {
  it('counts what stands that the letter did not carry, and what it carried that no longer stands', () => {
    const d = deltaSince([e('a'), e('b')], ['a', 'z', 'y']);
    expect(d.notCarried.map((x) => x.ruleKey)).toEqual(['b']);
    expect(d.gone).toBe(2);
  });
});
