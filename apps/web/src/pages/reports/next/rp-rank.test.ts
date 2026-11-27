/**
 * Ranked bars (r110 g2), the pure half: n of N from either end, every tie
 * at the edge kept (ADR 0272, one part in a billion), never a tie at 0, and
 * the measures cut with the bars.
 */
import { describe, expect, it } from 'vitest';
import { rankCaption, rankSlice, ranked, same } from './rp-rank';
import type { Cat, Measure } from './rp-view';

/** 37 wines, highest margin first; bars 12 and 13 share one margin in the bit patterns a sum really returns. */
const margins = Array.from({ length: 37 }, (_, i) => 100 - i * 2);
margins[11] = 78 * (1 + 1e-12);
margins[12] = 78;
const wines: Cat[] = margins.map((v, i) => ({ label: `W${i}`, value: v, full: `Wine ${i}` }));
const sold: Measure = { key: 'sold', label: 'Sold', unit: 'bottles', format: String, values: margins.map((_, i) => 1000 + i) };

describe('rankSlice', () => {
  it('[REVERT-FAILS] 37 wines with a tie across bars 12 and 13 draw 13 and say "13 of 37"', () => {
    expect(same(margins[11], margins[12])).toBe(true);
    expect(margins[11]).not.toBe(margins[12]);
    const cut = rankSlice(wines, [sold], 12, 'high');
    expect(cut.shown).toBe(13);
    expect(cut.total).toBe(37);
    expect(cut.data.map((d) => d.label)).toEqual(wines.slice(0, 13).map((d) => d.label));
    expect(rankCaption(cut, { cap: 12, noun: 'wines', by: 'margin' }, 'high')).toBe('13 of 37 wines, highest margin first');
  });

  it('[REVERT-FAILS] Lowest gives the 12 smallest, ascending from the left', () => {
    const cut = rankSlice(wines, [sold], 12, 'low');
    expect(cut.shown).toBe(12);
    const values = cut.data.map((d) => d.value as number);
    expect(values).toEqual([...margins].sort((a, b) => a - b).slice(0, 12));
    expect(values[0]).toBe(Math.min(...margins));
    expect(rankCaption(cut, { cap: 12, noun: 'wines', by: 'margin' }, 'low')).toBe('12 of 37 wines, lowest margin first');
  });

  it('keeps a tie at the low end too', () => {
    const low = margins.map((v, i) => (i === 24 ? margins[25] * (1 + 1e-12) : v));
    const cut = rankSlice(low.map((v, i) => ({ label: `W${i}`, value: v })), undefined, 12, 'low');
    // The 12th smallest is bar 25; bar 24 is the same margin to one part in a billion.
    expect(cut.shown).toBe(13);
  });

  it('[REVERT-FAILS] a tie at 0 is not extended', () => {
    const rows: Cat[] = [5, 4, 3, ...Array(20).fill(0)].map((v, i) => ({ label: `R${i}`, value: v }));
    expect(rankSlice(rows, undefined, 5, 'high').shown).toBe(5);
    expect(rankSlice(rows, undefined, 5, 'low').shown).toBe(5);
  });

  it('two margins that merely print alike are not a tie', () => {
    const rows: Cat[] = [9, 8, 7, 26.89, 26.84].map((v, i) => ({ label: `R${i}`, value: v }));
    expect(rankSlice(rows, undefined, 4, 'high').shown).toBe(4);
  });

  it('[REVERT-FAILS] the combo values belong to the drawn bars, from either end', () => {
    const high = rankSlice(wines, [sold], 12, 'high');
    high.data.forEach((d, k) => expect(high.measures![0].values[k]).toBe(sold.values[wines.indexOf(d)]));
    const low = rankSlice(wines, [sold], 12, 'low');
    expect(low.measures![0].values).toHaveLength(12);
    low.data.forEach((d, k) => expect(low.measures![0].values[k]).toBe(sold.values[wines.indexOf(d)]));
  });

  it('a row with no value sits last from either end and is never a tie', () => {
    const rows: Cat[] = [3, null, 1, 2].map((v, i) => ({ label: `R${i}`, value: v }));
    expect(rankSlice(rows, undefined, 3, 'high').data.map((d) => d.value)).toEqual([3, 2, 1]);
    expect(rankSlice(rows, undefined, 3, 'low').data.map((d) => d.value)).toEqual([1, 2, 3]);
  });

  it('never draws more than the drawing carries, and says the tie ran on', () => {
    const rows: Cat[] = Array.from({ length: 200 }, (_, i) => ({ label: `R${i}`, value: 5 }));
    const cut = rankSlice(rows, undefined, 12, 'high', 150);
    expect(cut.shown).toBe(150);
    expect(cut.tieCut).toBe(true);
    expect(rankCaption(cut, { cap: 12, noun: 'wines', by: 'margin' }, 'high')).toBe(
      '150 of 200 wines, highest margin first; a tie runs on past the last bar',
    );
  });

  it('no caption when every row is drawn (full screen at 37)', () => {
    const r = ranked({ data: wines, rank: { cap: 12, noun: 'wines', by: 'margin', ends: true }, xLabel: 'wine', yLabel: 'm', unit: 'm', format: String }, 'high', 150, 150);
    expect(r.series.data).toHaveLength(37);
    expect(r.caption).toBeNull();
  });
});
