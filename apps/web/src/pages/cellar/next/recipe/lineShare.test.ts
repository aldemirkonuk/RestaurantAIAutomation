import { describe, expect, it } from 'vitest';
import { lineShares, type ShareInput } from './lineShare';

const L = (label: string, cost: number | null, counted = true): ShareInput => ({ label, cost, counted });
const pcts = (r: ReturnType<typeof lineShares>) => r?.lines.map((l) => l.pct);

describe('lineShares', () => {
  it('2.00 and 0.105 are 95 and 5', () => {
    expect(pcts(lineShares([L('Gin', 2), L('Tonic', 0.105)]))).toEqual([95, 5]);
  });
  it('three equal thirds are 34, 33, 33 and total 100', () => {
    const r = lineShares([L('a', 1), L('b', 1), L('c', 1)]);
    expect(pcts(r)).toEqual([34, 33, 33]);
    expect(r?.lines.reduce((a, l) => a + (l.pct as number), 0)).toBe(100);
  });
  it('a line with no price has no share and the rest are of the priced part', () => {
    const r = lineShares([L('Gin', 3), L('Campari', null), L('Soda', 1)]);
    expect(pcts(r)).toEqual([75, null, 25]);
    expect(r?.ofPricedPart).toBe(true);
  });
  it('a line left out of the cost is not a gap', () => {
    const r = lineShares([L('Gin', 3), L('Bitters', null, false)]);
    expect(pcts(r)).toEqual([100]);
    expect(r?.ofPricedPart).toBe(false);
  });
  it('a zero or empty total gives no shares', () => {
    expect(lineShares([L('a', 0), L('b', 0)])).toBeNull();
    expect(lineShares([])).toBeNull();
    expect(lineShares([L('a', null)])).toBeNull();
  });
});
