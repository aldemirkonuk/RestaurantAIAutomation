/**
 * The two doors added 2026-09-04 — the day-book draft, and the slipping goal.
 *
 * The tests that matter here are the refusals. A draft never invents a date
 * out of the rule's prose; the goal link never claims a query parameter that
 * `/reports` does not read; and a goal whose row could not be read names NO
 * lever rather than naming all of them, because "we could not look" and "there
 * are none" are different facts.
 */

import { describe, expect, it } from 'vitest';
import {
  DAYBOOK_LANDING,
  METRIC_CATEGORIES,
  daybookBasis,
  daybookDraftFor,
  daybookHref,
  goalIdOf,
  goalSlipFor,
  leverWords,
  leversFor,
} from './rec-daybook';
import type { EntryVM, GoalRow } from './useRecommendationsNextData';

const entry = (over: Partial<EntryVM> = {}): EntryVM =>
  ({
    ruleKey: 'weekday_gap',
    observation: 'Friday is reliably your strongest day; Tuesday the weakest.',
    recommendation:
      'Move staff training, deliveries, and inventory counts to Tuesday; test a Tuesday-only offer.',
    rationale: null,
    category: 'sales',
    urgency: 'this_week',
    stake: 'money',
    hand: { href: '/promotions', label: 'Draft the offer', where: 'Promotions' },
    score: 1.5,
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
  id: 'g-77',
  name: 'Lift wine revenue',
  metricKey: 'wine_revenue',
  targetValue: 9000,
  currentValue: 2000,
  deadline: '2026-09-30',
  status: 'active',
  sourceRuleKey: null,
  ...over,
});

describe('the day-book draft', () => {
  it('gives a named calendar object its own type, and names the basis', () => {
    const d = daybookDraftFor(entry({ ruleKey: 'weekly_demand_slide' }), '2026-09-09');
    expect(d.type).toBe('tasting');
    expect(daybookBasis('weekly_demand_slide')).toMatch(/only rule on the page whose type is not a judgement/);
  });

  it('refuses to pick one of three, and says why it is `custom`', () => {
    const d = daybookDraftFor(entry(), '2026-09-09');
    expect(d.type).toBe('custom');
    expect(daybookBasis('weekday_gap')).toMatch(/rather than this page choosing/);
  });

  it('opens on the day it was given — never a weekday scraped out of the sentence', () => {
    // The observation literally contains "Tuesday". Reading it back out would
    // be parsing prose the gateway can rewrite without telling anyone.
    const d = daybookDraftFor(entry(), '2026-09-09');
    expect(d.date).toBe('2026-09-09');
    expect(d.title).not.toMatch(/Tuesday/);
  });

  it('names the rule in the note, so the calendar line says where it came from', () => {
    const d = daybookDraftFor(entry(), '2026-09-09');
    expect(d.note).toContain('weekday_gap');
    expect(d.note).toContain('Move staff training');
  });

  it('builds a link a person can read, and one a router cannot mangle', () => {
    const href = daybookHref(daybookDraftFor(entry(), '2026-09-09'));
    expect(href.startsWith('/calendar?new=')).toBe(true);
    const back = JSON.parse(decodeURIComponent(href.slice('/calendar?new='.length)));
    expect(back).toMatchObject({ date: '2026-09-09', type: 'custom' });
  });

  it('promises what the calendar now does: the entry arrives filled in', () => {
    // The calendar reads `?new=` since 2026-09-04 (CalendarNext.tsx:66-106,
    // :233-250), so the old hedge would now UNDERSTATE the page. What it must
    // still not claim is that anything is written: the manager saves it.
    expect(DAYBOOK_LANDING).toMatch(/already filled in/);
    expect(DAYBOOK_LANDING).not.toMatch(/does not read/);
    expect(DAYBOOK_LANDING).toMatch(/check and save/);
  });

  it('still drafts for a rule it has no spec for, rather than returning nothing', () => {
    const d = daybookDraftFor(entry({ ruleKey: 'a_rule_from_next_week' }), '2026-09-09');
    expect(d.type).toBe('custom');
    expect(d.title).toContain('a_rule_from_next_week');
    expect(daybookBasis('a_rule_from_next_week')).toBeNull();
  });
});

describe('the slipping goal', () => {
  const slipping = entry({
    ruleKey: 'goal_behind_g-77',
    category: 'goals',
    observation: 'Goal "Lift wine revenue" is behind its linear pace (22% done).',
  });

  it('reads the goal id out of the rule key the engine minted', () => {
    expect(goalIdOf('goal_behind_g-77')).toBe('g-77');
    expect(goalIdOf('stockout_imminent')).toBeNull();
    expect(goalIdOf('goal_behind_')).toBeNull();
  });

  it('is null for every rule that is not a goal-behind', () => {
    expect(goalSlipFor(entry(), [goal()])).toBeNull();
  });

  it('links to /reports and NAMES THE GOAL, because the sheet reads no query', () => {
    const slip = goalSlipFor(slipping, [goal()])!;
    expect(slip.href).toContain('/reports?');
    expect(slip.href).toContain('goal=g-77');
    expect(slip.landing).toMatch(/does not read this link’s query yet/);
    expect(slip.landing).toContain('Lift wine revenue');
  });

  it('when the goal list could not be read, says so instead of naming a row', () => {
    for (const goals of [null, undefined] as const) {
      const slip = goalSlipFor(slipping, goals)!;
      expect(slip.name).toBeNull();
      expect(slip.landing).toMatch(/could not read your goal list/);
    }
  });

  it('names the levers by the GATEWAY’S own metric→category table', () => {
    // wine_revenue → sales, efficiency (goals.service.ts SUPPORTED_METRICS)
    expect(METRIC_CATEGORIES.wine_revenue).toEqual(['sales', 'efficiency']);
    const slip = goalSlipFor(slipping, [goal()])!;
    const standing = [
      entry({ ruleKey: 'weekday_gap', category: 'sales' }),
      entry({ ruleKey: 'plowhorse_repricing', category: 'efficiency' }),
      entry({ ruleKey: 'vendor_concentration', category: 'risk' }),
      slipping,
    ];
    const levers = leversFor(slip, standing)!;
    expect(levers.map((l) => l.ruleKey)).toEqual(['weekday_gap', 'plowhorse_repricing']);
    expect(leverWords(slip, levers)).toMatch(/sales and efficiency categories/);
    expect(leverWords(slip, levers)).toMatch(/asks for ONE of them/);
  });

  it('names NO lever when the goal could not be read — not every lever', () => {
    const slip = goalSlipFor(slipping, null)!;
    expect(leversFor(slip, [entry({ category: 'sales' })])).toBeNull();
    expect(leverWords(slip, null)).toMatch(/cannot say which category that is/);
  });

  it('says the feed is empty when it is, and does not call that an absence of levers', () => {
    const slip = goalSlipFor(slipping, [goal()])!;
    const levers = leversFor(slip, [entry({ category: 'risk' })])!;
    expect(levers).toEqual([]);
    expect(leverWords(slip, levers)).toMatch(/not on the book/);
  });

  it('refuses a metric the gateway does not map to any category', () => {
    const slip = goalSlipFor(slipping, [goal({ metricKey: 'something_new' })])!;
    expect(leversFor(slip, [])).toBeNull();
    expect(leverWords(slip, null)).toMatch(/not one of the six metrics/);
  });
});
