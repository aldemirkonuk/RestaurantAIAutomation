/**
 * kJ and % RI per 100 g/ml (r109 inventory-g5): EU 1169/2011 Annex XIII
 * Part B values, whole percent, "<1%" below a half, nothing for an unknown
 * figure, energy from the ABV alone, or a house outside the annex's countries.
 */
import { describe, expect, it } from 'vitest';
import { energyWords, kjFromKcal, referenceIntakes, riShare, RI_STATEMENT, usesReferenceIntakes } from './nutrition-ri';

const card = (over: Record<string, number | null | boolean> = {}) => ({
  energyKcal: 350,
  fatG: 4,
  saturatesG: null,
  carbohydrateG: null,
  sugarsG: 0.01,
  proteinG: 22,
  saltG: 0.2,
  energyFromAbv: false,
  ...over,
});

describe('kJ', () => {
  it('is round(kcal x 4.184), and not known when the kcal is not known', () => {
    expect(kjFromKcal(350)).toBe(1464);
    expect(kjFromKcal(1725)).toBe(7217);
    expect(kjFromKcal(0)).toBe(0);
    expect(kjFromKcal(null)).toBeNull();
    expect(energyWords(350)).toBe('1,464 kJ / 350 kcal');
    expect(energyWords(null)).toBe('not known');
  });
});

describe('% RI', () => {
  it('rounds to whole percent against the annex values', () => {
    expect(riShare(4, 'fatG')).toBe('6%');
    expect(riShare(0.2, 'saltG')).toBe('3%');
    expect(riShare(350, 'energyKcal')).toBe('18%');
    expect(riShare(5, 'saturatesG')).toBe('25%');
    expect(riShare(26, 'carbohydrateG')).toBe('10%');
    expect(riShare(9, 'sugarsG')).toBe('10%');
    expect(riShare(25, 'proteinG')).toBe('50%');
  });

  it('says <1% for a positive figure below 0.5%, 1% at 0.5%, and 0% for a stated 0', () => {
    expect(riShare(0.01, 'saltG')).toBe('<1%');
    expect(riShare(0.03, 'saltG')).toBe('1%');
    expect(riShare(0, 'fatG')).toBe('0%');
  });

  it('gives no % for an unknown figure', () => {
    expect(riShare(null, 'fatG')).toBeNull();
    expect(referenceIntakes(card({ carbohydrateG: null }), 'Türkiye')).not.toHaveProperty('carbohydrateG');
  });

  it('gives each known figure its % for a house in Türkiye, the UK or the EU', () => {
    expect(referenceIntakes(card(), 'Türkiye')).toEqual({ energyKcal: '18%', fatG: '6%', sugarsG: '<1%', proteinG: '44%', saltG: '3%' });
    expect(usesReferenceIntakes('United Kingdom')).toBe(true);
    expect(usesReferenceIntakes('Germany')).toBe(true);
    expect(usesReferenceIntakes('NO')).toBe(true);
  });

  it('gives no % for a US house, an unknown country or none', () => {
    expect(referenceIntakes(card(), 'United States')).toBeNull();
    expect(referenceIntakes(card(), 'Atlantis')).toBeNull();
    expect(referenceIntakes(card(), null)).toBeNull();
    expect(referenceIntakes(card(), undefined)).toBeNull();
  });

  it('gives energy worked out from the ABV alone no %, and keeps the others', () => {
    const ri = referenceIntakes(card({ energyFromAbv: true }), 'France');
    expect(ri).not.toHaveProperty('energyKcal');
    expect(ri).toHaveProperty('fatG', '6%');
  });

  it('carries the statement the annex requires', () => {
    expect(RI_STATEMENT).toBe('Reference intake of an average adult (8 400 kJ / 2 000 kcal)');
  });
});
