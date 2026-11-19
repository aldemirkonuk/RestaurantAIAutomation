import { describe, expect, it } from 'vitest';
import { AXIS_KEYS, PROV_KINDS, type AxisKey, type TasteAxis, type TasteEffective } from '../../../services/api/taste';
import {
  AXIS_ADJECTIVE,
  AXIS_LABEL,
  axisName,
  BAND_EDGES,
  bandOf,
  descriptorWord,
  DESCRIPTOR_GROUPS,
  footerFacts,
  knownAxes,
  nextAction,
  ORDINAL_STEPS,
  PROV_MARK,
  rangeWords,
  sourceWords,
  summaryLine,
} from './taste-words';

const ax = (v: number, over: Partial<TasteAxis> = {}): TasteAxis => ({ v, lo: null, hi: null, conf: 0.6, prov: [{ kind: 'staff_note', share: 1 }], bandOnly: false, ...over });
const eff = (axes: Partial<Record<AxisKey, TasteAxis>>, conflicts: TasteEffective['conflicts'] = []): TasteEffective => ({ axes, descriptors: [], texture: [], conflicts });

describe('the five-step level', () => {
  it('maps none 0, hint 1.5, light 3, medium 5, pronounced 7, dominant 9', () => {
    expect(ORDINAL_STEPS.map((s) => [s.word, s.v])).toEqual([['none', 0], ['hint', 1.5], ['light', 3], ['medium', 5], ['pronounced', 7], ['dominant', 9]]);
  });
  it('each step reads back as its own word', () => {
    for (const s of ORDINAL_STEPS) expect(bandOf(s.v)).toBe(s.word);
  });
});

describe('bands: edges at 0.5, 2, 4, 6, 8 (a value on an edge belongs to the stronger band)', () => {
  it('names the edges', () => expect([...BAND_EDGES]).toEqual([0.5, 2, 4, 6, 8]));
  it.each([
    [0, 'none'], [0.49, 'none'], [0.5, 'hint'], [1.99, 'hint'], [2, 'light'], [3.99, 'light'],
    [4, 'medium'], [5.99, 'medium'], [6, 'pronounced'], [7.99, 'pronounced'], [8, 'dominant'], [10, 'dominant'],
  ])('%s is %s', (v, w) => expect(bandOf(v)).toBe(w));
});

describe('no key reaches a screen', () => {
  it('every axis has a label, an adjective and a name, none of them the key itself', () => {
    for (const k of AXIS_KEYS) {
      expect(AXIS_LABEL[k], k).toBeTruthy();
      expect(AXIS_ADJECTIVE[k], k).toBeTruthy();
      expect(axisName(k), k).toBeTruthy();
      expect(AXIS_LABEL[k]).not.toContain('_');
      expect(axisName(k)).not.toContain('_');
    }
    expect(Object.keys(AXIS_LABEL).sort()).toEqual([...AXIS_KEYS].sort());
  });
  it('every provenance kind has a mark and words with no underscore', () => {
    for (const k of PROV_KINDS) {
      expect(PROV_MARK[k].shape, k).toBeTruthy();
      expect(PROV_MARK[k].words).not.toContain('_');
    }
  });
  it('an unknown source reads generically, never as its code', () => {
    expect(sourceWords('weird_new_source')).toBe('Another source');
    expect(sourceWords('house')).toBe('Described by the house');
  });
  it('a descriptor the form does not offer has no word', () => {
    expect(descriptorWord('savoury')).toBe('savoury');
    expect(descriptorWord('drop table')).toBeNull();
    expect(DESCRIPTOR_GROUPS.flatMap((g) => g.items).length).toBeGreaterThan(8);
  });
});

describe('marks', () => {
  it('solid measured, tick recipe and dataset, hatched class default, bubble staff', () => {
    expect([PROV_MARK.measured.shape, PROV_MARK.recipe.shape, PROV_MARK.dataset.shape, PROV_MARK.class_default.shape, PROV_MARK.staff_note.shape, PROV_MARK.staff_line.shape])
      .toEqual(['solid', 'tick', 'tick', 'hatched', 'bubble', 'bubble']);
  });
});

describe('summaryLine', () => {
  it('uses only axes with conf >= 0.4', () => {
    const s = summaryLine(eff({ salty: ax(8, { conf: 0.39, bandOnly: true }), sweet: ax(7), fat: ax(5, { conf: 0.4 }) }));
    expect(s).toBe('Mainly sweet, with some rich.');
  });
  it('is null when nothing is firm', () => {
    expect(summaryLine(eff({ salty: ax(8, { conf: 0.2, bandOnly: true }) }))).toBeNull();
    expect(summaryLine(eff({}))).toBeNull();
  });
  it('never holds a digit', () => {
    expect(summaryLine(eff({ salty: ax(6.36), sour: ax(2.2), umami: ax(9.9) }))).not.toMatch(/\d/);
  });
  it('withholds a conflicted axis', () => {
    expect(summaryLine(eff({ salty: ax(9), sweet: ax(7) }, [{ axis: 'salty', gap: 4 }]))).toBe('Mainly sweet.');
    expect(knownAxes(eff({ salty: ax(9), sweet: ax(7) }, [{ axis: 'salty', gap: 4 }])).map(([k]) => k)).toEqual(['sweet']);
  });
});

describe('rows and next steps', () => {
  it('sorts strongest first', () => {
    expect(knownAxes(eff({ sweet: ax(2), salty: ax(8), sour: ax(5) })).map(([k]) => k)).toEqual(['salty', 'sour', 'sweet']);
  });
  it('says a range in words, and not at all below conf 0.4', () => {
    expect(rangeWords(ax(5, { lo: 3, hi: 7 }))).toBe('Between light and pronounced.');
    expect(rangeWords(ax(5, { lo: 4.2, hi: 5.5 }))).toBe('Most likely medium.');
    expect(rangeWords(ax(5, { lo: 3, hi: 7, conf: 0.2, bandOnly: true }))).toBeNull();
  });
  it('a typical value or a guess asks for a tasting; a staff-stated one does not', () => {
    expect(nextAction('salty', eff({ salty: ax(5, { prov: [{ kind: 'class_default', share: 1 }] }) }))).toMatch(/Describe the taste/);
    expect(nextAction('salty', eff({ salty: ax(5) }))).toBeNull();
  });
});

describe('footer facts', () => {
  it('lists each person once, the latest time and the layer count', () => {
    const l = (name: string | null, at: string | null) => ({ source: 'house', version: 1, method: null, statedByName: name, statedAt: at, hasNote: false, noteText: null });
    expect(footerFacts({ effective: null, layers: [l('A', '2026-11-01T00:00:00Z'), l('B', '2026-11-05T00:00:00Z'), l('A', null)] }))
      .toEqual({ names: ['A', 'B'], latest: '2026-11-05T00:00:00Z', sources: 3 });
  });
});
