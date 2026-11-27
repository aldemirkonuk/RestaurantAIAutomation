/**
 * DD-r108-37: a whole pack's figures are per100 x size / 100, an unknown size
 * shows no line, an unknown figure stays unknown, and figures per 100 g on a
 * bottle need a stated weight of one ml.
 */
import { describe, expect, it } from 'vitest';
import type { StoredNutrition } from '../../../services/api/inventory';
import { packNutrition, packSizeMl } from './pack-nutrition';

const wine = (over: Partial<StoredNutrition> = {}): StoredNutrition => ({
  basis: '100ml',
  energyKcal: 230,
  fatG: 0,
  saturatesG: null,
  carbohydrateG: 2.6,
  sugarsG: null,
  proteinG: 0.1,
  saltG: null,
  abvPct: 13.5,
  energyFromAbv: false,
  source: 'pack_label',
  sourceRef: null,
  statedByName: 'Ayşe',
  statedAt: '2026-11-07T10:00:00Z',
  ...over,
});

describe('packNutrition', () => {
  it('a 750 ml bottle at 230 kcal per 100 ml holds 1,725 kcal, each figure scaled the same way', () => {
    const p = packNutrition(wine(), 750);
    expect(p).toEqual({
      kind: 'figures',
      sizeMl: 750,
      figures: { energyKcal: 1725, proteinG: 0.75, fatG: 0, carbohydrateG: 19.5, sugarsG: null, saltG: null },
      energyFromAbv: false,
    });
  });

  it('keeps 6 decimals, not the display rounding', () => {
    const p = packNutrition(wine({ proteinG: 0.0333333333 }), 330);
    expect(p?.kind === 'figures' && p.figures.proteinG).toBe(0.11);
    const q = packNutrition(wine({ saltG: 0.0123456789 }), 700);
    expect(q?.kind === 'figures' && q.figures.saltG).toBe(0.08642);
  });

  it('an unknown size gives no line at all', () => {
    expect(packNutrition(wine(), null)).toBeNull();
    expect(packNutrition(wine(), 0)).toBeNull();
    expect(packNutrition(wine(), Number.NaN)).toBeNull();
  });

  it('an unknown figure stays unknown (null), never 0', () => {
    const p = packNutrition(wine({ energyKcal: null }), 750);
    expect(p?.kind === 'figures' && p.figures.energyKcal).toBeNull();
  });

  it('figures per 100 g on a bottle need a stated weight of one ml; with one they count through it', () => {
    expect(packNutrition(wine({ basis: '100g' }), 750)).toEqual({ kind: 'needs_weight', sizeMl: 750 });
    const p = packNutrition(wine({ basis: '100g', energyKcal: 100 }), 500, 1.03);
    expect(p?.kind === 'figures' && p.figures.energyKcal).toBe(515);
  });

  it('keeps the note that energy from the ABV is the alcohol alone', () => {
    const p = packNutrition(wine({ energyFromAbv: true }), 750);
    expect(p?.kind === 'figures' && p.energyFromAbv).toBe(true);
  });
});

describe('packSizeMl', () => {
  it('reads only the recorded size, never a filled one, and only for goods kept in bottles', () => {
    expect(packSizeMl({ bottleSizeRecordedMl: 750 }, { kind: 'wine', uom: 'bottle' })).toBe(750);
    expect(packSizeMl({ bottleSizeRecordedMl: null }, { kind: 'wine', uom: 'bottle' })).toBeNull();
    expect(packSizeMl({}, { kind: 'wine', uom: 'bottle' })).toBeNull();
    expect(packSizeMl({ bottleSizeRecordedMl: 750 }, { kind: 'food', uom: null })).toBeNull();
    expect(packSizeMl({ bottleSizeRecordedMl: 750 }, { kind: null, uom: 'g' })).toBeNull();
  });
});
