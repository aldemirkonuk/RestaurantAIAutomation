import { describe, expect, it } from 'vitest';
import { RECIPE_UNITS, amountWithUnit } from './units';
import { converts, inMeasure, mlText, ozText } from './measureDialect';

describe('measureDialect (r110 drinks-g2)', () => {
  it('reads ml in US oz to the nearest eighth, at the jigger ounce', () => {
    expect(inMeasure(30, 'ml', 'oz')).toBe('1 oz');
    expect(inMeasure(22.5, 'ml', 'oz')).toBe('¾ oz');
    expect(inMeasure(45, 'ml', 'oz')).toBe('1½ oz');
    expect(inMeasure(60, 'ml', 'oz')).toBe('2 oz');
    expect(inMeasure(3, 'cl', 'oz')).toBe('1 oz');
  });

  it('reads a batch at the true US ounce, so the error does not grow with the quantity', () => {
    // 45 ml x4 = 180 ml = 6.087 US fl oz: the nearest eighth is 6⅛, 1.1 ml off, so marked.
    expect(inMeasure(180, 'ml', 'oz', true)).toBe('≈ 6⅛ oz');
    // 60 ml x20 = 1.2 l = 40.58 US oz, not the jigger's 40.
    expect(inMeasure(1200, 'ml', 'oz', true)).toBe('≈ 40⅝ oz');
    expect(inMeasure(1000, 'ml', 'oz', true)).toBe('≈ 33⅞ oz');
    expect(inMeasure(500, 'ml', 'oz', true)).toBe('≈ 16⅞ oz');
    // One serve keeps the jigger's 30.
    expect(inMeasure(45, 'ml', 'oz')).toBe('1½ oz');
    expect(converts([{ qty: 180, unit: 'ml' }], 'oz', true)).toBe(true);
  });

  it('marks an eighth that moved the figure by more than 0.25 ml', () => {
    expect(inMeasure(20, 'ml', 'oz')).toBe('≈ ⅝ oz');
    expect(inMeasure(25, 'ml', 'oz')).toBe('≈ ⅞ oz');
    expect(ozText(3.75)).toBe('⅛ oz');
    expect(ozText(2)).toBe('≈ ⅛ oz');
  });

  it('reads a written US oz in ml, to one decimal with .0 dropped', () => {
    expect(inMeasure(1.5, 'oz', 'ml')).toBe('44.4 ml');
    expect(inMeasure(3, 'cl', 'ml')).toBe('30 ml');
    expect(inMeasure(0.7, 'l', 'ml')).toBe('700 ml');
    expect(mlText(22.5)).toBe('22.5 ml');
    // A written ounce stays its own eighths in oz.
    expect(inMeasure(1.25, 'oz', 'oz')).toBe('1¼ oz');
  });

  it('keeps a dash, barspoon, spoon, weight and piece as written', () => {
    for (const u of ['dash', 'barspoon', 'tsp', 'tbsp', 'g', 'kg', 'each'] as const) {
      for (const m of ['ml', 'oz'] as const) expect(inMeasure(2, u, m)).toBe(amountWithUnit(2, u));
    }
    expect(inMeasure(2, 'dash', 'oz')).toBe('2 dashes');
  });

  it('As written is byte-identical to the card before the change, for every unit', () => {
    for (const u of RECIPE_UNITS) for (const q of [0.5, 1, 1.125, 22.5, 30]) expect(inMeasure(q, u, 'as_written')).toBe(amountWithUnit(q, u));
    expect(inMeasure(30, null, 'oz')).toBe(amountWithUnit(30, null as never));
  });

  it('says it converted only when a line reads differently', () => {
    expect(converts([{ qty: 2, unit: 'dash' }], 'oz')).toBe(false);
    expect(converts([{ qty: 30, unit: 'ml' }], 'as_written')).toBe(false);
    expect(converts([{ qty: 30, unit: 'ml' }], 'oz')).toBe(true);
  });
});
