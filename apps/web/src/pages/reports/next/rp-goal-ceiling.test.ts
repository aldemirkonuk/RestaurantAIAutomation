/**
 * r34 walk w3, R-F6: a ceiling goal ("keep at most") whose trend runs over the
 * limit read "The trend projects $28.4K by the deadline — short." The gateway's
 * `projectionHitsTarget` is false for a ceiling when the projection is OVER it,
 * so the caption now says within or over the limit, and a ceiling's pace is
 * the schedule the limit allows. A floor ("reach at least") reads as before.
 */
import { describe, expect, it } from 'vitest';
import { goals, paceCaption, type GoalsRegister } from './rp-registers-goals';

const entry = (direction: 'at_least' | 'at_most', over: Record<string, unknown> = {}) => ({
  goal: { id: 'g1', name: 'Purchasing', metric_key: 'bottles_sold', direction, deadline: '2026-12-31', period: 'custom' },
  metricLabel: 'Bottles sold',
  unit: 'count',
  current: 120,
  target: 300,
  progressPct: 0.4,
  expectedByNow: 110,
  onTrack: true,
  daysLeft: 20,
  paceUnread: null,
  projectedAtDeadline: 340,
  projectionHitsTarget: false,
  ...over,
});
const row = (e: unknown) =>
  (goals.select({ status: 'active', goals: [e], total: 1 }) as GoalsRegister).goals[0];

describe('a ceiling goal is read in a ceiling’s words (R-F6)', () => {
  it('[REVERT-FAILS] a trend over the ceiling is "over the limit", never "short"', () => {
    const said = paceCaption(row(entry('at_most', { onTrack: false })));
    expect(said).toBe('Over the schedule this limit allows, 20 days left. The trend projects 340 by the deadline — over the limit.');
    expect(said).not.toMatch(/short|enough/);
  });

  it('a trend under the ceiling is "within the limit"', () => {
    expect(paceCaption(row(entry('at_most', { projectedAtDeadline: 250, projectionHitsTarget: true })))).toBe(
      'Within the schedule this limit allows, 20 days left. The trend projects 250 by the deadline — within the limit.',
    );
  });

  it('when the schedule and the trend disagree, the projection says it reads the trend apart', () => {
    expect(paceCaption(row(entry('at_most')))).toBe(
      'Within the schedule this limit allows, 20 days left. The recent trend, read apart from the schedule, projects 340 by the deadline — over the limit.',
    );
    expect(paceCaption(row(entry('at_least', { onTrack: false, projectionHitsTarget: true })))).toBe(
      'Behind the pace this goal needs, 20 days left. The recent trend, read apart from the schedule, projects 340 by the deadline — enough.',
    );
  });

  it('a floor goal still reads enough or short, with its own pace words', () => {
    expect(paceCaption(row(entry('at_least', { projectionHitsTarget: true })))).toBe(
      'On the pace this goal needs, 20 days left. The trend projects 340 by the deadline — enough.',
    );
    expect(paceCaption(row(entry('at_least', { onTrack: false, projectedAtDeadline: 200 })))).toBe(
      'Behind the pace this goal needs, 20 days left. The trend projects 200 by the deadline — short.',
    );
  });

  it('with no verdict on the projection, no verdict and no "apart" clause is said, and the sentence ends', () => {
    expect(paceCaption(row(entry('at_most', { projectionHitsTarget: null })))).toBe(
      'Within the schedule this limit allows, 20 days left. The trend projects 340 by the deadline.',
    );
  });
});
