/**
 * "Spend pacing" draws no window that rests on an order with no recorded cost.
 *
 * Browser check, 2026-11-12: the card drew last month's bars and a
 * projection while the purchases goal refused to score the same window over
 * one uncosted order. The cashflow lens now withholds that window (null) with
 * the goal's own sentence in `unread`; the card says it instead of drawing.
 */
import { describe, expect, it } from 'vitest';
import { CATALOGUE } from './rp-catalogue';

const WHY =
  'Purchasing spend could not be summed: 1 of the 2 delivered orders in this window carries no recorded cost, so a total would be short rather than true. Record what that order cost to read it.';

const PACING = {
  basis: { outflow: 'delivered procurement_orders' },
  spendLast30d: 1200,
  spendPrev30d: 900,
  paceDeltaPct: 0.3333,
  projectedNext4Weeks: [300, 310, 320, 330],
  committedOpenOrders: 400,
  openOrderCount: 2,
};

const view = (raw: unknown) => {
  const spec = CATALOGUE.pacing;
  return spec.view(spec.select(raw), { days: 30 } as any);
};

describe('Spend pacing: an uncosted order is unknown, never $0', () => {
  it('every window costed: the two bars are drawn', () => {
    const v = view(PACING);
    expect(v.cats?.data.map((d) => d.value)).toEqual([900, 1200]);
    expect(v.say).toBeUndefined();
  });

  it('a withheld window: no bars, the goal’s sentence, and no "nothing bought"', () => {
    const v = view({
      ...PACING,
      spendLast30d: null,
      paceDeltaPct: null,
      projectedNext4Weeks: null,
      unread: { spendLast30d: WHY, spendPrev30d: null, projectedNext4Weeks: WHY, committedOpenOrders: null },
    });
    expect(v.cats).toBeUndefined();
    expect(v.say).toBe(WHY);
    expect(JSON.stringify(v)).not.toMatch(/No delivered purchase order falls/);
  });

  it('an open order with no price says so beside the committed figure', () => {
    const v = view({
      ...PACING,
      committedOpenOrders: null,
      unread: {
        spendLast30d: null,
        spendPrev30d: null,
        projectedNext4Weeks: null,
        committedOpenOrders: '1 of the 2 open orders carries no price yet, so what is committed is not summed short. Record the price to read it.',
      },
    });
    const committed = v.figures.find((f: any) => f.label === 'Committed, not yet delivered') as any;
    expect(committed.note).toMatch(/no price yet/);
  });

  it('a payload from before the field (no `unread`) still draws as it did', () => {
    const v = view({ ...PACING, spendLast30d: 0, spendPrev30d: 0 });
    expect(v.say).toMatch(/No delivered purchase order falls in either 30-day window/);
  });
});
