import { describe, expect, it } from 'vitest';
import { COST_NOT_READ, valuationColumns } from './iv-export';
import type { InvRow } from './useInventoryNextData';

const row = (over: Partial<InvRow>): InvRow => ({ id: 'a', name: 'Alpha', rollupReadable: true, wac: null, value: null, ...over }) as InvRow;
const cell = (header: string, r: InvRow) => valuationColumns('USD').find((c) => c.header === header)!.value(r);

describe('the valuation CSV says when a cost could not be read', () => {
  it('writes the marker, not a blank, for a cost whose read failed', () => {
    const r = row({ rollupReadable: false, wac: 0, value: 0 });
    expect(cell('WAC', r)).toBe(COST_NOT_READ);
    expect(cell('Value at cost', r)).toBe(COST_NOT_READ);
  });
  it('keeps a known cost a number and a title with no cost blank', () => {
    expect(cell('WAC', row({ wac: 12.5, value: 50 }))).toBe(12.5);
    expect(cell('Value at cost', row({ wac: 12.5, value: 50 }))).toBe('50.00');
    expect(cell('WAC', row({}))).toBe('');
    expect(cell('Value at cost', row({}))).toBe('');
  });
});
