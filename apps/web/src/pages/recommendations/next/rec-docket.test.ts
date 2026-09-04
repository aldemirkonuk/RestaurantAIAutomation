/**
 * The docket's filing — the third axis, checked against the rules themselves.
 *
 * These are not "does the map have a key" tests. The one that matters is the
 * LAST one: every rule the gateway can fire has a heading, and any rule it
 * cannot recognise lands in `unfiled` rather than being absorbed into a
 * section it was never sorted into. A silent default here would file a new
 * rule under whatever heading happened to be first, and nobody would ever see
 * that it had not been classified.
 */

import { describe, expect, it } from 'vitest';
import { ACT_LABEL, ACT_ORDER, ACT_SAY, CHANGE_A_RULE, MONEY_WITHHELD, actOf } from './rec-docket';

/** The twelve named rules in `recommendations.service.ts`, plus the family. */
const RULES = [
  'sales_below_weekday_baseline',
  'weekly_demand_slide',
  'stockout_imminent',
  'dead_stock_capital',
  'plowhorse_repricing',
  'puzzle_activation',
  'vendor_concentration',
  'revenue_concentration',
  'weekday_gap',
  'spend_acceleration',
  'staff_spread',
  'pairing_promotion',
];

describe('the docket — filing by the act', () => {
  it('files a stockout as an order and a server spread as a pre-shift', () => {
    expect(actOf('stockout_imminent').act).toBe('order');
    expect(actOf('staff_spread').act).toBe('floor');
  });

  it('files the Wednesday shortfall by what a person DOES, not by where the hand sends them', () => {
    // Its `hand` is /reports, because the hand keys on the rule's category.
    // The act is a pre-shift, and the filing says so in its own words.
    const filed = actOf('sales_below_weekday_baseline');
    expect(filed.act).toBe('floor');
    expect(filed.why).toMatch(/hand is Reports/);
  });

  it('states the judgement where the act and the surface disagree', () => {
    const pairing = actOf('pairing_promotion');
    expect(pairing.act).toBe('price');
    expect(pairing.why).toMatch(/judgement, stated/);
  });

  it('leaves a goal_behind entry unfiled rather than pushing it under a heading', () => {
    const filed = actOf('goal_behind_550e8400-e29b-41d4-a716-446655440000');
    expect(filed.act).toBe('unfiled');
    expect(filed.why).toMatch(/a choice, not an act/);
  });

  it('files an unrecognised rule as unfiled, and names it', () => {
    const filed = actOf('some_rule_shipped_next_week');
    expect(filed.act).toBe('unfiled');
    expect(filed.why).toContain('some_rule_shipped_next_week');
  });

  it('gives every rule the engine fires a heading, and a reason read off its own prescription', () => {
    for (const key of RULES) {
      const filed = actOf(key);
      expect(filed.act, key).not.toBe('unfiled');
      expect(ACT_ORDER, key).toContain(filed.act);
      // the basis quotes the rule's own recommendation sentence
      expect(filed.why, key).toMatch(/The rule says/);
    }
  });

  it('has a heading and a sitting described for every act, including unfiled', () => {
    for (const act of ACT_ORDER) {
      expect(ACT_LABEL[act]).toBeTruthy();
      expect(ACT_SAY[act].length).toBeGreaterThan(40);
    }
  });

  it('withholds the money in words, and never in a figure', () => {
    expect(MONEY_WITHHELD).toContain('not carried');
    expect(MONEY_WITHHELD).not.toMatch(/\d/);
  });

  it('keeps the founder’s fifth heading dark rather than dropping it', () => {
    expect(CHANGE_A_RULE.label).toBe('Change a rule');
    expect(CHANGE_A_RULE.why).toMatch(/thresholds are constants/);
  });
});
