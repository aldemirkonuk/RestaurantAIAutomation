import { describe, expect, it } from 'vitest';
import type { RecipeLine, ServeFigure } from '../../../../services/api/recipes';
import { STD_G, alcoholLines, standardDrinks, strengthBeforeWater } from './standardDrinks';

const line = (label: string, ml: number, over: Partial<RecipeLine> = {}): RecipeLine => ({
  id: label,
  position: 0,
  role: 'stocked',
  inventoryId: 'i',
  label,
  itemName: null,
  itemKind: null,
  qtyEntered: ml,
  unitCode: 'ml',
  qtyBase: ml * 10,
  baseUnit: 'ml10',
  status: 'linked',
  costPerServe: null,
  costBasis: null,
  ...over,
});

// A Negroni, 30/30/30 ml at 40/25/16%: 12 + 7.5 + 4.8 = 24.3 ml of ethanol, 19.17 g.
const negroni = [line('Gin', 30), line('Campari', 30), line('Sweet vermouth', 30)];
const complete: ServeFigure = { value: 24.3, atLeast: false, missing: [] };

describe('standardDrinks (r110 drinks-g1)', () => {
  it('a Negroni is 1.4 US standard drinks and 2.4 UK units', () => {
    expect(standardDrinks(complete, 'US')).toMatchObject({ kind: 'drinks', drinks: 1.4 });
    expect(standardDrinks(complete, 'GB')).toMatchObject({ kind: 'drinks', drinks: 2.4 });
    expect(alcoholLines(complete, negroni, 1, 'US', 'USD').std).toBe('1.4 US standard drinks (14 g each)');
    expect(alcoholLines(complete, negroni, 1, 'GB', 'GBP').std).toBe('2.4 UK units (8 g each)');
    expect(alcoholLines(complete, negroni, 1, 'CA', 'CAD').std).toBe('1.4 Canadian standard drinks (13.45 g each)');
  });

  it('the table is the six countries and their own grams', () => {
    expect(STD_G).toEqual({ US: 14, GB: 8, AU: 10, NZ: 10, IE: 10, CA: 13.45 });
  });

  it('a partial figure gives no number, and names the line with no strength', () => {
    const partial: ServeFigure = { value: 19.5, atLeast: true, missing: ['Tonic'] };
    expect(standardDrinks(partial, 'US')).toEqual({ kind: 'not_worked_out', missing: ['Tonic'] });
    const said = alcoholLines(partial, negroni, 1, 'US', 'USD');
    expect(said.std).toBe('Standard drinks not worked out: Tonic states no strength.');
    expect(said.std).not.toMatch(/\d/);
    expect(said.strength).toBe('');
  });

  it('a country not in the table gets grams only (no WHO 10 g default)', () => {
    expect(standardDrinks(complete, 'TR')).toEqual({ kind: 'grams', grams: 24.3 * 0.789 });
    expect(alcoholLines(complete, negroni, 1, 'TR', 'TRY').std).toBe('19,2 g; no standard drink for this country');
    expect(alcoholLines(complete, negroni, 1, null, null).std).toMatch(/^19.2 g; the house's country is not set$/);
  });

  it('says nothing about standard drinks while the country is read, but the strength is there', () => {
    const said = alcoholLines(complete, negroni, 1, undefined, null);
    expect(said.std).toBe('');
    expect(said.strength).toMatch(/^27\s?% before ice and water$/);
  });

  it('strength is the pure alcohol over the poured ml, per serve', () => {
    expect(strengthBeforeWater(complete, negroni, 1)).toEqual({ kind: 'pct', pct: 27 });
    // The same lines making two serves: half the volume a serve.
    const two = strengthBeforeWater({ value: 12.15, atLeast: false, missing: [] }, negroni, 2);
    expect(two).toEqual({ kind: 'pct', pct: 27 });
    expect(alcoholLines(complete, negroni, 1, 'US', 'USD').strength).toBe('27% before ice and water');
  });

  it('a counted g line gives no strength, and is named', () => {
    const withSugar = [...negroni, line('Sugar', 0, { unitCode: 'g', qtyBase: 10_000, baseUnit: 'mg' })];
    expect(strengthBeforeWater(complete, withSugar, 1)).toEqual({ kind: 'not_by_volume', lines: ['Sugar'] });
    expect(alcoholLines(complete, withSugar, 1, 'US', 'USD').strength).toBe('Strength not worked out: Sugar is not measured by volume.');
    const withEgg = [...negroni, line('Egg white', 0, { unitCode: 'each', qtyBase: 1000, baseUnit: 'each_milli' })];
    expect(strengthBeforeWater(complete, withEgg, 1).kind).toBe('not_by_volume');
  });

  it('the number is in the house form: a comma house writes 1,4', () => {
    expect(alcoholLines(complete, negroni, 1, 'US', 'TRY').std).toBe('1,4 US standard drinks (14 g each)');
  });
});
