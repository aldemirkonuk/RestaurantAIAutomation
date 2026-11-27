/**
 * A ceiling goal says within or over its limit, never "short" (r109
 * reports-r109-7, re-deriving #1594 on the reports chain).
 *
 * For a "keep at most" goal the gateway sets `projectionHitsTarget` false when
 * the trend runs OVER the limit (`projected <= target`, goals.service.ts), and
 * `paceCaption` read false as " — short." for every direction. A goal heading
 * over its limit read as one falling short of a target.
 *
 * The last case pairs the wording with the staff read (r108 #2209): a goal
 * kept from staff is still counted in the same sentence, and the ceiling goal
 * staff may read is worded as a ceiling.
 */

import { describe, expect, it } from 'vitest';
import { goals, paceCaption, type GoalsRegister } from './rp-registers-goals';

const entry = (direction: 'at_least' | 'at_most', over: Partial<Record<string, unknown>>) => ({
  goal: { id: `g-${direction}`, name: 'Days of stock', metric_key: 'days_of_inventory', target_value: 20, direction, deadline: '2026-12-31', period: 'custom' },
  metricLabel: 'Days of stock',
  unit: 'count',
  current: 12,
  target: 20,
  progressPct: 0.6,
  expectedByNow: 10,
  daysLeft: 34,
  paceUnread: null,
  ...over,
});

const row = (direction: 'at_least' | 'at_most', over: Partial<Record<string, unknown>>) =>
  (goals.select({ goals: [entry(direction, over)], total: 1 }) as GoalsRegister).goals[0];

describe('a ceiling goal is read in a ceiling\'s words', () => {
  it('[REVERT-FAILS] a ceiling whose trend runs over its limit says "over the limit", never "short"', () => {
    const text = paceCaption(row('at_most', { onTrack: false, projectedAtDeadline: 28, projectionHitsTarget: false }));
    expect(text).toBe('Over the schedule this limit allows, 34 days left. The trend projects 28 by the deadline — over the limit.');
    expect(text).not.toMatch(/short|behind the pace|this goal needs/i);
  });

  it('a ceiling inside its limit says "within the limit"', () => {
    const text = paceCaption(row('at_most', { onTrack: true, projectedAtDeadline: 18, projectionHitsTarget: true }));
    expect(text).toBe('Within the schedule this limit allows, 34 days left. The trend projects 18 by the deadline — within the limit.');
  });

  it('a floor reads as it always did: enough or short', () => {
    expect(paceCaption(row('at_least', { onTrack: true, projectedAtDeadline: 22, projectionHitsTarget: true }))).toBe(
      'On the pace this goal needs, 34 days left. The trend projects 22 by the deadline — enough.',
    );
    expect(paceCaption(row('at_least', { onTrack: false, projectedAtDeadline: 15, projectionHitsTarget: false }))).toBe(
      'Behind the pace this goal needs, 34 days left. The trend projects 15 by the deadline — short.',
    );
  });

  it('when the schedule and the trend disagree, the projection says it reads the trend apart', () => {
    const text = paceCaption(row('at_most', { onTrack: true, projectedAtDeadline: 26, projectionHitsTarget: false }));
    expect(text).toBe(
      'Within the schedule this limit allows, 34 days left. The recent trend, read apart from the schedule, projects 26 by the deadline — over the limit.',
    );
  });

  it('a projection with no verdict ends its sentence', () => {
    expect(paceCaption(row('at_most', { onTrack: true, projectedAtDeadline: 18, projectionHitsTarget: null }))).toMatch(
      /by the deadline\.$/,
    );
  });

  it('[REVERT-FAILS] staff: the kept-back goal is still counted in the same words, and the ceiling they read is a ceiling', () => {
    const reg = goals.select({
      goals: [
        entry('at_most', { onTrack: false, projectedAtDeadline: 28, projectionHitsTarget: false }),
        { goal: { id: 'g2', withheldForRole: true }, withheldForRole: true },
      ],
      total: 2,
      withheldForRole: 1,
    }) as GoalsRegister;
    expect(reg.withheld).toBe(1);
    expect(reg.goals).toHaveLength(1);
    const view = goals.view(reg, { days: 30 });
    expect(view.notes.join(' ')).toContain(
      '1 goal is about the till, money or suppliers, kept to owners and managers. Nothing about it is claimed here.',
    );
    expect(paceCaption(reg.goals[0])).toContain('— over the limit.');
  });
});
