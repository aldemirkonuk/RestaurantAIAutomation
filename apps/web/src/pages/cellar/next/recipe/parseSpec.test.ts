/**
 * Paste a spec (proposal §4 F17). Main's recipe box split each line with one
 * regex (`CocktailRegister.tsx:113` at origin/main), which read "2 egg whites"
 * as unit "egg", could not read ½ at all, and linked nothing. These rows are
 * proposals: every one arrives unconfirmed.
 */
import { describe, expect, it } from 'vitest';
import { parseLine, parseSpec, readAmount } from './parseSpec';

describe('parseSpec — pasted text into rows to confirm', () => {
  it('reads "1½ oz gin" as 1.5 oz gin', () => {
    expect(parseLine('1½ oz gin')).toEqual({
      qty: 1.5, unit: 'oz', label: 'gin', role: 'stocked', confirmed: false,
    });
  });

  it('reads "2 dashes Angostura" as 2 dash', () => {
    expect(parseLine('2 dashes Angostura')).toMatchObject({ qty: 2, unit: 'dash', label: 'Angostura', role: 'stocked' });
  });

  it('reads "2 egg whites" as 2 each "egg white", not unit "egg"', () => {
    expect(parseLine('2 egg whites')).toMatchObject({ qty: 2, unit: 'each', label: 'egg white', role: 'stocked' });
  });

  it('reads a Turkish decimal comma: "22,5 ml lemon juice" is 22.5 ml', () => {
    expect(parseLine('22,5 ml lemon juice')).toMatchObject({ qty: 22.5, unit: 'ml', label: 'lemon juice' });
  });

  it('marks "Orange twist garnish" untracked', () => {
    expect(parseLine('Orange twist garnish')).toMatchObject({ qty: null, role: 'untracked', label: 'Orange twist garnish' });
  });

  it('marks "top with soda" untracked with no amount', () => {
    expect(parseLine('top with soda')).toMatchObject({ qty: null, unit: null, role: 'untracked' });
  });

  it('reads ½ ¼ ¾ ⅓ ⅔, "1 1/2" and "3/4"', () => {
    expect(readAmount('½')).toBe(0.5);
    expect(readAmount('¼')).toBe(0.25);
    expect(readAmount('¾')).toBe(0.75);
    expect(readAmount('⅓')).toBeCloseTo(1 / 3);
    expect(readAmount('⅔')).toBeCloseTo(2 / 3);
    expect(readAmount('1 1/2')).toBe(1.5);
    expect(readAmount('3/4')).toBe(0.75);
    expect(parseLine('1 1/2 ounces bourbon')).toMatchObject({ qty: 1.5, unit: 'oz', label: 'bourbon' });
  });

  it('maps every unit word onto the closed menu', () => {
    const cases: [string, string][] = [
      ['3 cl Campari', 'cl'], ['1 l batch', 'l'], ['2 tsp sugar', 'tsp'], ['1 tbsp honey', 'tbsp'],
      ['1 barspoon maraschino', 'barspoon'], ['1 bsp absinthe', 'barspoon'], ['5 g salt', 'g'],
      ['1 kg ice cream', 'kg'], ['1 dash Peychaud', 'dash'], ['30 ml gin', 'ml'], ['1 ounce rye', 'oz'],
    ];
    for (const [line, unit] of cases) expect(parseLine(line)?.unit, line).toBe(unit);
  });

  it('keeps tonic water counted but plain water and ice not', () => {
    expect(parseLine('100 ml tonic water')?.role).toBe('stocked');
    expect(parseLine('20 ml water')?.role).toBe('untracked');
    expect(parseLine('ice')?.role).toBe('untracked');
  });

  it('splits on new lines and " / ", and every row is unconfirmed', () => {
    const rows = parseSpec('1½ oz gin / 2 dashes Angostura\n1 egg white\n\n  Orange twist garnish');
    expect(rows.map((r) => r.label)).toEqual(['gin', 'Angostura', 'egg white', 'Orange twist garnish']);
    expect(rows.every((r) => r.confirmed === false)).toBe(true);
  });
});
