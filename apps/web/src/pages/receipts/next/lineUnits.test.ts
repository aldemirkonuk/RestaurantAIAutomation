import { describe, expect, it } from 'vitest';
import { qtyUnitWord, takesPackSize } from './lineUnits';

describe('takesPackSize', () => {
  it('is true for the units that count containers', () => {
    for (const u of ['case', 'pack', 'split_case']) expect(takesPackSize(u)).toBe(true);
  });
  it('is false for everything else, and for no unit', () => {
    for (const u of ['bottle', 'each', 'liter', 'keg', '', null, undefined]) expect(takesPackSize(u)).toBe(false);
  });
});

describe('qtyUnitWord', () => {
  it('agrees with the count', () => {
    expect(qtyUnitWord('case', 1)).toBe('case');
    expect(qtyUnitWord('case', 2)).toBe('cases');
    expect(qtyUnitWord('bottle', 6)).toBe('bottles');
    expect(qtyUnitWord('each', 3)).toBe('each');
    expect(qtyUnitWord('liter', 1)).toBe('liter');
    expect(qtyUnitWord('keg', 2)).toBe('kegs');
    expect(qtyUnitWord('pack', 2)).toBe('packs');
  });
  it('prints an unknown unit as it came, and nothing for none', () => {
    expect(qtyUnitWord('crate', 2)).toBe('crate');
    expect(qtyUnitWord(null, 2)).toBe('');
  });
});
