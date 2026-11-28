import { AXIS_KEYS, bandWord, validateAxes } from './taste-axes';

describe('validateAxes', () => {
  it('lists the 25 axes: 12 intensities and 13 aroma families, heat and alcohol apart', () => {
    expect(AXIS_KEYS).toHaveLength(25);
    expect(AXIS_KEYS).toContain('heat');
    expect(AXIS_KEYS).toContain('alcohol');
    expect(AXIS_KEYS as readonly string[]).not.toContain('burn');
  });

  it('rejects a key outside the list', () => {
    const r = validateAxes({ spiciness: { v: 3 } });
    expect(r.ok).toBe(false);
  });

  it.each([[-0.1], [10.1], [NaN], [Infinity], ['5'], [null], [undefined]])('rejects v = %p', (v) => {
    expect(validateAxes({ sweet: { v } }).ok).toBe(false);
  });

  it('rejects a spread that is not above zero', () => {
    expect(validateAxes({ sweet: { v: 4, sd: 0 } }).ok).toBe(false);
    expect(validateAxes({ sweet: { v: 4, sd: '1' } }).ok).toBe(false);
  });

  it('rejects an axes value that is not an object', () => {
    expect(validateAxes([]).ok).toBe(false);
    expect(validateAxes(null).ok).toBe(false);
    expect(validateAxes({ sweet: 4 }).ok).toBe(false);
  });

  it('accepts a typed 0 and keeps it; an absent axis stays absent', () => {
    const r = validateAxes({ sour: { v: 0 }, sweet: { v: 10, sd: 0.5 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.axes.sour).toEqual({ v: 0 });
      expect(Object.keys(r.axes)).toEqual(['sour', 'sweet']);
      expect('bitter' in r.axes).toBe(false);
    }
  });
});

describe('bandWord', () => {
  it('breaks at 0.5 / 2 / 4 / 6 / 8', () => {
    expect([0, 0.49, 0.5, 1.99, 2, 3.99, 4, 5.99, 6, 7.99, 8, 10].map(bandWord)).toEqual([
      'none', 'none', 'hint', 'hint', 'light', 'light', 'medium', 'medium',
      'pronounced', 'pronounced', 'dominant', 'dominant',
    ]);
  });
});
