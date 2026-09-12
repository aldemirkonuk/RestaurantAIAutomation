/**
 * The two forward mappings, pinned rule by rule.
 *
 * These are the claims the page makes on the manager's behalf — "a goal from
 * this entry is held on purchasing spend, at most" and "reports draws this as
 * Spend pacing" — so each one is asserted against the rule set the gateway
 * actually emits (`analytics/recommendations.service.ts:150-372`, thirteen
 * rules). A mapping that quietly drifts to the wrong metric would set a house
 * a target on the wrong figure, which is worse than no button at all.
 *
 * The load-bearing negatives are the refusals: three rules map to no metric,
 * four to no cutting, and one family (goal_behind_*) refuses BOTH. A test that
 * only checked the happy mappings would pass with every refusal replaced by a
 * plausible guess.
 */

import { describe, expect, it } from 'vitest';
import {
  METRICS,
  cuttingFor,
  deadlineFor,
  goalOfferFor,
  landingWords,
  periodFor,
  toStored,
  type ForwardEntry,
} from './rec-forward';

const e = (over: Partial<ForwardEntry> = {}): ForwardEntry => ({
  ruleKey: 'stockout_imminent',
  category: 'inventory',
  urgency: 'now',
  subject: null,
  ...over,
});

/** Every rule the gateway can emit, with the category it emits it under. */
const RULES: Array<[string, string, string]> = [
  ['sales_below_weekday_baseline', 'sales', 'now'],
  ['weekly_demand_slide', 'sales', 'this_week'],
  ['stockout_imminent', 'inventory', 'now'],
  ['dead_stock_capital', 'inventory', 'this_month'],
  ['plowhorse_repricing', 'efficiency', 'this_week'],
  ['puzzle_activation', 'efficiency', 'this_week'],
  ['vendor_concentration', 'risk', 'this_month'],
  ['revenue_concentration', 'risk', 'this_month'],
  ['weekday_gap', 'sales', 'this_week'],
  ['spend_acceleration', 'purchasing', 'this_week'],
  ['staff_spread', 'staff', 'this_week'],
  ['pairing_promotion', 'basket', 'this_week'],
  ['goal_behind_2f0c1a44-0000-4000-8000-000000000001', 'goals', 'this_week'],
];

describe('rec-forward — the goal door', () => {
  it('maps each rule to a metric the gateway will actually accept', () => {
    const expected: Record<string, [string, 'at_least' | 'at_most']> = {
      sales_below_weekday_baseline: ['wine_revenue', 'at_least'],
      weekly_demand_slide: ['wine_revenue', 'at_least'],
      weekday_gap: ['wine_revenue', 'at_least'],
      dead_stock_capital: ['bottles_sold', 'at_least'],
      plowhorse_repricing: ['wine_revenue', 'at_least'],
      puzzle_activation: ['bottles_sold', 'at_least'],
      spend_acceleration: ['purchase_spend', 'at_most'],
      staff_spread: ['avg_check', 'at_least'],
      pairing_promotion: ['wine_attach_rate', 'at_least'],
    };
    for (const [ruleKey, [metricKey, direction]] of Object.entries(expected)) {
      const offer = goalOfferFor(e({ ruleKey }));
      expect(offer.kind, ruleKey).toBe('plan');
      if (offer.kind !== 'plan') continue;
      expect(offer.plan.metricKey, ruleKey).toBe(metricKey);
      expect(offer.plan.direction, ruleKey).toBe(direction);
      // the label is the gateway's own, never a paraphrase
      expect(offer.plan.metricLabel).toBe(METRICS[offer.plan.metricKey].label);
      expect(offer.plan.basis.length).toBeGreaterThan(20);
    }
  });

  it('refuses — with a reason — every rule no supported metric can measure', () => {
    for (const ruleKey of [
      'stockout_imminent',
      'vendor_concentration',
      'revenue_concentration',
    ]) {
      const offer = goalOfferFor(e({ ruleKey }));
      expect(offer.kind, ruleKey).toBe('refused');
      if (offer.kind !== 'refused') continue;
      expect(offer.why.length).toBeGreaterThan(30);
    }
  });

  it('refuses to make a goal out of a rule that is already about a goal', () => {
    const offer = goalOfferFor(e({ ruleKey: 'goal_behind_abc', category: 'goals' }));
    expect(offer.kind).toBe('refused');
    if (offer.kind === 'refused') expect(offer.why).toMatch(/already about a goal/);
  });

  it('never guesses a metric for a rule it has never seen', () => {
    const offer = goalOfferFor(e({ ruleKey: 'some_rule_shipped_next_year' }));
    expect(offer.kind).toBe('refused');
    if (offer.kind === 'refused')
      expect(offer.why).toMatch(/some_rule_shipped_next_year/);
  });

  it('carries the subject into the goal name where the rule names one', () => {
    const offer = goalOfferFor(
      e({ ruleKey: 'sales_below_weekday_baseline', subject: 'Wednesday' }),
    );
    if (offer.kind !== 'plan') throw new Error('expected a plan');
    expect(offer.plan.name).toBe('Wednesday wine revenue back to baseline');
    const bare = goalOfferFor(e({ ruleKey: 'sales_below_weekday_baseline' }));
    if (bare.kind !== 'plan') throw new Error('expected a plan');
    expect(bare.plan.name).toBe('Wine revenue back to baseline');
  });

  it('derives the period from urgency — "tonight" is not a measurement window', () => {
    expect(periodFor('now')).toBe('week');
    expect(periodFor('this_week')).toBe('week');
    expect(periodFor('this_month')).toBe('month');
  });

  it('derives a deadline that is 7 or 30 days out, as a business date', () => {
    const now = new Date('2026-09-03T12:00:00Z');
    expect(deadlineFor('week', now)).toBe('2026-09-10');
    expect(deadlineFor('month', now)).toBe('2026-10-03');
  });

  it('stores a rate as a fraction — 60% is 0.6 on the wire, not 60', () => {
    expect(toStored('percent', 60)).toBe(0.6);
    expect(toStored('currency', 2500)).toBe(2500);
    expect(toStored('units', 40)).toBe(40);
  });
});

describe('rec-forward — the reports door', () => {
  it('sends each rule to the one cutting whose register answers it', () => {
    const expected: Record<string, [string, string]> = {
      sales_below_weekday_baseline: ['week', 'same-question'],
      weekly_demand_slide: ['till', 'same-question'],
      weekday_gap: ['week', 'same-register'],
      stockout_imminent: ['restock', 'same-register'],
      dead_stock_capital: ['ledger', 'same-register'],
      plowhorse_repricing: ['quadrants', 'same-register'],
      puzzle_activation: ['quadrants', 'same-register'],
      spend_acceleration: ['pacing', 'same-register'],
      staff_spread: ['service', 'same-question'],
    };
    for (const [ruleKey, [id, basis]] of Object.entries(expected)) {
      const offer = cuttingFor(e({ ruleKey }));
      expect(offer.kind, ruleKey).toBe('cutting');
      if (offer.kind !== 'cutting') continue;
      expect(offer.link.id, ruleKey).toBe(id);
      expect(offer.link.basis, ruleKey).toBe(basis);
      expect(offer.link.href).toBe(
        `/reports?cutting=${id}&rec=${encodeURIComponent(ruleKey)}&from=recommendations`,
      );
    }
  });

  it('says so, rather than guessing, where no cutting answers the rule', () => {
    for (const ruleKey of [
      'vendor_concentration',
      'revenue_concentration',
      'pairing_promotion',
      'goal_behind_abc',
    ]) {
      const offer = cuttingFor(e({ ruleKey }));
      expect(offer.kind, ruleKey).toBe('refused');
      if (offer.kind !== 'refused') continue;
      expect(offer.why).toMatch(/No cutting answers this one/);
    }
  });

  it('knows which cuttings are NOT on an unarranged sheet, and says to add them', () => {
    const restock = cuttingFor(e({ ruleKey: 'stockout_imminent' }));
    const pacing = cuttingFor(e({ ruleKey: 'spend_acceleration' }));
    if (restock.kind !== 'cutting' || pacing.kind !== 'cutting')
      throw new Error('expected cuttings');
    expect(restock.link.onDefaultSheet).toBe(false);
    expect(landingWords(restock.link)).toMatch(/Add a cutting/);
    expect(pacing.link.onDefaultSheet).toBe(true);
    expect(landingWords(pacing.link)).toMatch(/lies on the sheet already/);
  });

  it('every rule the gateway emits gets an answer from BOTH doors', () => {
    // No rule may fall through to undefined behaviour: each one either offers
    // or refuses, in words. This is the test that fails when a fourteenth rule
    // ships and nobody files it.
    for (const [ruleKey, category, urgency] of RULES) {
      const g = goalOfferFor(e({ ruleKey, category, urgency }));
      const c = cuttingFor(e({ ruleKey, category, urgency }));
      expect(['plan', 'refused'], ruleKey).toContain(g.kind);
      expect(['cutting', 'refused'], ruleKey).toContain(c.kind);
      const words = g.kind === 'plan' ? g.plan.basis : g.why;
      expect(words.trim().length, ruleKey).toBeGreaterThan(20);
    }
  });
});
