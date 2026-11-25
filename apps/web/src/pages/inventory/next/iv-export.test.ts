/** The valuation file carries what uses each good, never a 0 for a count nobody read (r106 g5). */
import { describe, expect, it } from 'vitest';
import { valuationColumns } from './iv-export';
import type { InvRow } from './useInventoryNextData';

const col = valuationColumns('EUR').find((c) => c.header === 'Used in (recipes)');
const cell = (usedIn: number | null | undefined) => col?.value({ usedIn } as unknown as InvRow);

describe('Used in (recipes) column', () => {
  it('is in the file', () => {
    expect(col).toBeDefined();
  });
  it('writes the number, and 0 for a good that was counted and unused', () => {
    expect(cell(4)).toBe(4);
    expect(cell(0)).toBe(0);
  });
  it('writes words, never 0, when the count could not be read or is not read yet', () => {
    expect(cell(null)).toBe('could not be read');
    expect(cell(undefined)).toBe('not read yet');
  });
});
