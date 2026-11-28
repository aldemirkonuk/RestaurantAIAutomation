import { FusionLayer, fuse, tasteSummary } from './taste-fusion';

const layer = (source: FusionLayer['source'], axes: FusionLayer['axes'], statedBy: string | null = null): FusionLayer =>
  ({ source, axes, statedBy });

describe('fuse', () => {
  it('no layers is null, never zeros', () => {
    expect(fuse([])).toBeNull();
  });

  it('a layer with no axes leaves every axis absent', () => {
    const e = fuse([{ source: 'house', axes: {}, descriptors: ['rich'] }]);
    expect(e?.axes).toEqual({});
    expect(e?.descriptors).toEqual(['rich']);
    expect(e?.summary).toBeNull();
  });

  it('weights by precision: recipe 6.2 (sd 0.6) with a staff 7 (sd 1.2) gives about 6.36', () => {
    const e = fuse([
      layer('recipe', { sour: { v: 6.2, sd: 0.6, conf: 0.7 } }),
      layer('house', { sour: { v: 7, sd: 1.2, conf: 0.6 } }),
    ]);
    expect(e!.axes.sour.v).toBeCloseTo(6.36, 1);
    expect(Math.abs(e!.axes.sour.v - 6.36)).toBeLessThan(0.05);
    expect(e!.axes.sour.sd).toBeCloseTo(0.537, 2);
    expect(e!.conflicts).toEqual([]);
  });

  it('a measurement dominates a staff line', () => {
    const e = fuse([
      layer('measured', { sweet: { v: 2, conf: 1 } }),
      layer('house', { sweet: { v: 4, conf: 0.6 } }),
    ]);
    expect(e!.axes.sweet.v).toBeLessThan(2.2);
  });

  it('a conflict (gap > 2.5) is flagged, keeps the widest sd and is left out of the summary', () => {
    const e = fuse([
      layer('house', { sour: { v: 2, sd: 1.0, conf: 0.6 }, sweet: { v: 6, conf: 0.6 } }, 'u1'),
      layer('house', { sour: { v: 5, sd: 1.5, conf: 0.6 }, sweet: { v: 6, conf: 0.6 } }, 'u2'),
    ]);
    expect(e!.conflicts).toHaveLength(1);
    expect(e!.conflicts[0]).toMatchObject({ axis: 'sour', gap: 3 });
    expect(e!.axes.sour.sd).toBe(1.5);
    expect(e!.summary).not.toMatch(/sour/);
    expect(e!.summary).toMatch(/sweet/);
  });

  it('exactly 2.5 apart is not a conflict', () => {
    const e = fuse([
      layer('house', { sour: { v: 2, conf: 0.6 } }, 'u1'),
      layer('house', { sour: { v: 4.5, conf: 0.6 } }, 'u2'),
    ]);
    expect(e!.conflicts).toEqual([]);
  });

  it('two staff layers are two layers: agreeing lines narrow the spread but never below the floor', () => {
    const one = fuse([layer('house', { umami: { v: 5, conf: 0.6 } }, 'u1')])!;
    const two = fuse([
      layer('house', { umami: { v: 5, conf: 0.6 } }, 'u1'),
      layer('house', { umami: { v: 5, conf: 0.6 } }, 'u2'),
    ])!;
    expect(two.axes.umami.sd).toBeLessThan(one.axes.umami.sd);
    expect(two.axes.umami.sd).toBeGreaterThanOrEqual(0.3);
    expect(two.axes.umami.prov).toEqual([{ kind: 'staff_line', share: 1 }]);
  });

  it('confidence is the smaller of the source prior and 1 - sd/3 (sd 1.2 => 0.6)', () => {
    const e = fuse([layer('house', { fat: { v: 5, conf: 0.6 } })])!;
    expect(e.axes.fat.conf).toBe(0.6);
    const w = fuse([layer('ai_draft', { fat: { v: 5, conf: 0.35 } })])!;
    expect(w.axes.fat.conf).toBe(0.17); // sd 2.5 caps it below the 0.35 prior
  });

  it('never invents an axis nobody stated', () => {
    const e = fuse([layer('house', { fat: { v: 0, conf: 0.6 } })])!;
    expect(Object.keys(e.axes)).toEqual(['fat']);
    expect(e.axes.fat.v).toBe(0);
  });
});

describe('tasteSummary', () => {
  it('uses only axes with conf >= 0.4, strongest first, none-level words left out', () => {
    const base = { prov: [], lo: 0, hi: 10, sd: 1 };
    const s = tasteSummary({
      conflicts: [],
      axes: {
        sour: { ...base, v: 6.5, conf: 0.6 },
        sweet: { ...base, v: 3, conf: 0.6 },
        bitter: { ...base, v: 9, conf: 0.39 },
        salty: { ...base, v: 0.2, conf: 0.9 },
      },
    });
    expect(s).toBe('Pronounced sour, light sweet.');
  });

  it('is null when nothing qualifies', () => {
    expect(tasteSummary({ conflicts: [], axes: {} })).toBeNull();
  });
});
