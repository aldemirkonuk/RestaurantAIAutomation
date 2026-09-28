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

  it('gives a goal_behind entry its own heading — not “not yet filed”', () => {
    // Founder, 2026-09-04. "Not yet filed" means *this page does not recognise
    // the rule*, and this page recognises this family exactly; a heading whose
    // meaning is "unknown to us" cannot also hold the one family we know best.
    const filed = actOf('goal_behind_550e8400-e29b-41d4-a716-446655440000');
    expect(filed.act).toBe('goal');
    expect(ACT_LABEL.goal).toBe('Goals slipping');
    expect(filed.why).toMatch(/behind its own pace/);
  });

  it('files the two calendar acts under Schedule it, quoting the clause that put them there', () => {
    // The founder named `weekday_gap` himself and asked for a sweep of the
    // rest; `weekly_demand_slide`'s verb is literally "Schedule".
    const gap = actOf('weekday_gap');
    expect(gap.act).toBe('schedule');
    expect(gap.why).toMatch(/Move staff training, deliveries, and inventory counts/);
    const slide = actOf('weekly_demand_slide');
    expect(slide.act).toBe('schedule');
    expect(slide.why).toMatch(/Schedule a staff tasting/);
    // and it says whose call it was, because only one of the two was the founder's
    expect(slide.why).toMatch(/not by the founder’s hand/);
    expect(ACT_LABEL.schedule).toBe('Schedule it');
  });

  it('refuses the near misses: a date inside a sentence is not a calendar act', () => {
    // A review date and a cadence are attached to acts of another kind; a
    // pre-shift IS the briefing, not the arranging of one.
    expect(actOf('dead_stock_capital').act).toBe('stock');
    expect(actOf('dead_stock_capital').why).toMatch(/a date inside a sentence is not a calendar act/);
    expect(actOf('puzzle_activation').act).toBe('stock');
    expect(actOf('staff_spread').act).toBe('floor');
    expect(actOf('sales_below_weekday_baseline').act).toBe('floor');
  });

  it('keeps “not yet filed” for what it means — a rule this page does not know', () => {
    // Nothing the engine fires may land here any more: the goal family moved
    // out on 2026-09-04, so `unfiled` is once again reachable only by a rule
    // that did not exist when this file was written.
    for (const key of RULES) expect(actOf(key).act, key).not.toBe('unfiled');
    expect(actOf('goal_behind_x').act).not.toBe('unfiled');
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
      expect(filed.why, key).toMatch(/The rule( says| LEADS|’s verb)/);
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
