/**
 * Paste a spec (proposal §4 F17). Main's recipe box split each line with one
 * regex (`CocktailRegister.tsx:113` at origin/main), which read "2 egg whites"
 * as unit "egg", could not read ½ at all, and linked nothing. These rows are
 * proposals: every one arrives unconfirmed.
 */
import { describe, expect, it } from 'vitest';
import { parseLine, parseSpec, readAmount, unitTypo } from './parseSpec';

describe('parseSpec — pasted text into rows to confirm', () => {
  it('reads "1½ oz gin" as 1.5 oz gin', () => {
    expect(parseLine('1½ oz gin')).toEqual({
      qty: 1.5, unit: 'oz', label: 'gin', role: 'stocked', confirmed: false, flag: null,
    });
  });

  it('reads a three-digit decimal by its unit: 1.125 oz and 1,125 oz are 1.125, 1.500 l is 1.5', () => {
    expect(parseLine('1.125 oz gin')).toMatchObject({ qty: 1.125, unit: 'oz', label: 'gin', role: 'stocked' });
    expect(parseLine('1,125 oz gin')).toMatchObject({ qty: 1.125, unit: 'oz', label: 'gin' });
    expect(parseLine('1.500 l water')).toMatchObject({ qty: 1.5, unit: 'l' });
    expect(readAmount('1.125', 'oz')).toBe(1.125);
  });

  it('still refuses 1.500 ml, 1.000 g and a bare 1.125: a thousand in Europe, no unit to settle it', () => {
    for (const line of ['1.500 ml gin', '1.000 g sugar', '1.125 gin', '1.125 each egg']) {
      expect(parseLine(line), line).toMatchObject({ qty: null, unit: null, role: 'untracked' });
    }
    expect(readAmount('1.125')).toBeNull();
    expect(readAmount('1.125', 'ml')).toBeNull();
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

  it('proposes "Orange twist garnish" as 1 each, not counted, so it saves as written', () => {
    expect(parseLine('Orange twist garnish')).toMatchObject({ qty: 1, unit: 'each', role: 'untracked', label: 'Orange twist garnish' });
    expect(parseLine('Crushed ice')).toMatchObject({ qty: 1, unit: 'each', role: 'untracked' });
    expect(parseLine('Stir and strain')).toMatchObject({ qty: null, unit: null, role: 'untracked' });
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

  // Round 17, D3: each of these was read as a counted "N each" row.
  it('drops a numbered-list prefix before reading the amount', () => {
    expect(parseLine('1) 2 oz gin')).toMatchObject({ qty: 2, unit: 'oz', label: 'gin' });
    expect(parseLine('2. 30 ml Campari')).toMatchObject({ qty: 30, unit: 'ml', label: 'Campari' });
    expect(parseLine('1.5 oz gin')).toMatchObject({ qty: 1.5, unit: 'oz', label: 'gin' });
  });

  it('never makes a count of a measure the menu does not have', () => {
    for (const line of ['1 shot gin', '1 jigger gin', '1 cup milk', '1 pt cream', '2 parts rum', '1 splash soda']) {
      const r = parseLine(line);
      expect(r?.unit, line).toBeNull();
      expect(r?.qty, line).not.toBeNull();
      expect(r?.label, line).toBe(line.replace(/^\d+ /, ''));
    }
  });

  it('reads plain misspellings of menu units', () => {
    expect(parseLine('60 mls gin')).toMatchObject({ qty: 60, unit: 'ml', label: 'gin' });
    expect(parseLine('1 tbs honey')).toMatchObject({ qty: 1, unit: 'tbsp', label: 'honey' });
    expect(parseLine('5 gm salt')).toMatchObject({ qty: 5, unit: 'g', label: 'salt' });
  });

  it('keeps as text what it cannot read, instead of a count', () => {
    for (const line of ['-30 ml gin', '1e3 ml gin', '1.000,5 ml gin', '1,000 ml gin', '30mlgin', '1.5.3 ml gin']) {
      expect(parseLine(line), line).toMatchObject({ qty: null, unit: null, role: 'untracked', label: line });
    }
    expect(parseLine('- 30 ml gin')).toMatchObject({ qty: 30, unit: 'ml', label: 'gin' });
    expect(parseLine('.5 oz lime')).toMatchObject({ qty: 0.5, unit: 'oz', label: 'lime' });
    expect(parseLine('30ml gin')).toMatchObject({ qty: 30, unit: 'ml', label: 'gin' });
    expect(parseLine('2x lime wedge')).toMatchObject({ qty: 2, unit: 'each' });
  });

  it('splits at a slash only where another amount starts', () => {
    expect(parseSpec('1 oz gin/1 oz campari').map((r) => r.label)).toEqual(['gin', 'campari']);
    expect(parseSpec('1 oz Sweet / dry vermouth').map((r) => r.label)).toEqual(['Sweet / dry vermouth']);
    expect(parseSpec('1 1/2 oz gin / ½ oz lime').map((r) => r.qty)).toEqual([1.5, 0.5]);
  });
  // Round 19: a unit typed wrong was read as a count ("30 mll gin" became 30 each).
  it('keeps the amount of a mistyped unit, leaves the unit to pick, and flags the word', () => {
    expect(parseLine('30 mll gin')).toEqual({
      qty: 30, unit: null, label: 'mll gin', role: 'stocked', confirmed: false,
      flag: '"mll" is not a unit I know. Pick the unit.',
    });
    expect(parseLine('1 dasher bitters')).toMatchObject({ qty: 1, unit: null, flag: '"dasher" is not a unit I know. Pick the unit.' });
    expect(parseLine('30 mlgin')).toMatchObject({ qty: 30, unit: null, flag: '"mlgin" is not a unit I know. Pick the unit.' });
    for (const line of ['2 ozz rum', '1 tspn sugar', '15 lm lime', '1 teaspon salt', '20 mililiters syrup', '3 dashs Angostura', '5 grm salt', '2 dahs bitters', '1 zo rum']) {
      const r = parseLine(line);
      expect(r?.unit, line).toBeNull();
      expect(r?.qty, line).not.toBeNull();
      expect(r?.flag, line).toMatch(/is not a unit I know/);
    }
  });

  it('flags a measure off the menu by name', () => {
    expect(parseLine('1 shot gin')?.flag).toBe('"shot" is not on the unit menu. Pick the unit.');
  });

  it('still counts what a bar counts, with no flag', () => {
    const counted = [
      '2 limes', '1 lime', '12 mint leaves', '3 cherries', '2 olives', '1 egg white', '2 strawberries', '1 sugar cube',
      '2 cloves', '1 peach', '1 orange', '3 raspberries', '2 basil leaves', '1 cucumber slice', '4 coffee beans',
      '2 cardamom pods', '1 banana', '2 pineapple chunks', '1 star anise', '1 grapefruit', '1 lemon', '2 kiwis', '1 mango',
    ];
    for (const line of counted) expect(parseLine(line), line).toMatchObject({ unit: 'each', flag: null });
    expect(parseLine('30 ml gin')?.flag).toBeNull();
    // One-letter units (l, g, x) are not typo targets, or every two-letter word would be one.
    expect(unitTypo('xo')).toBe(false);
  });

  it('keeps as text an amount followed by something that is not a word', () => {
    for (const line of ['1:1 syrup 15 ml', '1 . 2 oz gin', '2-3 dashes bitters', '30çay şurubu']) {
      expect(parseLine(line), line).toMatchObject({ qty: null, unit: null, role: 'untracked', label: line });
    }
    expect(parseLine("2 'Old Tom' gin")).toMatchObject({ qty: 2, unit: 'each' });
  });
  it('flags an ingredient pasted twice instead of adding it up', () => {
    const rows = parseSpec('30 ml gin\n15 ml Campari\n30 ml Gin');
    expect(rows.map((r) => r.qty)).toEqual([30, 15, 30]);
    expect(rows[0].flag).toBeNull();
    expect(rows[2].flag).toBe('"Gin" is pasted above too. Leave one out if it was pasted twice.');
  });
});

describe('a stated size wins over a count (r5, R6)', () => {
  it('reads "1 Tonic Water 200ml" as 200 ml of tonic water, not 1 each', () => {
    expect(parseLine('1 Tonic Water 200ml')).toMatchObject({ qty: 200, unit: 'ml', label: 'Tonic Water', role: 'stocked', flag: null });
  });

  it('multiplies the count by the size, and reads cl, l, oz, g and kg', () => {
    expect(parseLine('2 x 330 ml soda')).toMatchObject({ qty: 660, unit: 'ml', label: 'soda' });
    expect(parseLine('1 ginger beer 20cl')).toMatchObject({ qty: 20, unit: 'cl', label: 'ginger beer' });
    expect(parseLine('1 tomato juice 0,5 l')).toMatchObject({ qty: 0.5, unit: 'l', label: 'tomato juice' });
    expect(parseLine('½ bottle tonic 200ml')).toMatchObject({ qty: 100, unit: 'ml', label: 'tonic' });
    expect(parseLine('1 sugar 10 g')).toMatchObject({ qty: 10, unit: 'g', label: 'sugar' });
  });

  it('leaves counts with no stated size alone, and a number in a name is not a size', () => {
    expect(parseLine('2 egg whites')).toMatchObject({ qty: 2, unit: 'each', label: 'egg white' });
    expect(parseLine('1 Monkey 47 gin')).toMatchObject({ qty: 1, unit: 'each', label: 'Monkey 47 gin' });
    expect(parseLine('1 Tanqueray No. 10')).toMatchObject({ qty: 1, unit: 'each' });
  });

  it('never touches a line whose own unit is a measure', () => {
    expect(parseLine('50 ml Absolut 70cl')).toMatchObject({ qty: 50, unit: 'ml', label: 'Absolut 70cl' });
  });

  it('does not choose between two sizes: it keeps the count and says so', () => {
    const row = parseLine('1 tonic 200ml 20cl');
    expect(row).toMatchObject({ qty: 1, unit: null });
    expect(row?.flag).toBe('Two sizes on one line (200ml, 20cl). Pick the amount and unit.');
  });

  it('does not read an ambiguous thousand as a size', () => {
    expect(parseLine('1 tonic 1.000ml')).toMatchObject({ qty: 1, unit: 'each' });
  });
});

describe('a name-first line is read by its trailing amount (r33 w1 F3)', () => {
  it('reads "Yeni Rakı 50 ml", "YENİ RAKI 50 ml" and "Lime juice 2 cl" as measured, stocked rows', () => {
    expect(parseLine('Yeni Rakı 50 ml')).toEqual({
      qty: 50, unit: 'ml', label: 'Yeni Rakı', role: 'stocked', confirmed: false, flag: null,
    });
    expect(parseLine('YENİ RAKI 50 ml')).toMatchObject({ qty: 50, unit: 'ml', label: 'YENİ RAKI', role: 'stocked' });
    expect(parseLine('Lime juice 2 cl')).toMatchObject({ qty: 2, unit: 'cl', label: 'Lime juice', role: 'stocked' });
  });

  it('reads fractions, decimals, glued units and a separator before the amount', () => {
    expect(parseLine('Gin 1 1/2 oz')).toMatchObject({ qty: 1.5, unit: 'oz', label: 'Gin' });
    expect(parseLine('Sugar syrup 22,5ml')).toMatchObject({ qty: 22.5, unit: 'ml', label: 'Sugar syrup' });
    expect(parseLine('Angostura: 2 dashes')).toMatchObject({ qty: 2, unit: 'dash', label: 'Angostura' });
    expect(parseLine('- Campari – 30 ml.')).toMatchObject({ qty: 30, unit: 'ml', label: 'Campari' });
  });

  it('a name ending in a bare number, or a count word, stays text', () => {
    for (const line of ['Chanel No 5', 'Bitters 100', 'Monkey 47', 'Limes 2 each', 'Lemons 2 x']) {
      expect(parseLine(line), line).toMatchObject({ qty: null, unit: null, role: 'untracked' });
    }
  });

  it('an amount that is not at the very end, or an ambiguous thousand, stays text', () => {
    expect(parseLine('Gin 50 ml chilled')).toMatchObject({ qty: null, unit: null });
    expect(parseLine('Water 1.000 ml')).toMatchObject({ qty: null, unit: null });
    expect(parseLine('50 ml')).toMatchObject({ qty: null, unit: null });
  });

  it('a garnish or a top-up written name first is not taken from the shelf', () => {
    expect(parseLine('Orange peel 1 g')).toMatchObject({ qty: 1, unit: 'g', role: 'untracked' });
    expect(parseLine('Soda to top 60 ml')).toMatchObject({ qty: 60, unit: 'ml', role: 'untracked' });
  });

  it('a pasted spec mixes both orders', () => {
    expect(parseSpec('50 ml gin\nCampari 25 ml\nSweet vermouth 25 ml').map((r) => [r.qty, r.unit, r.label])).toEqual([
      [50, 'ml', 'gin'],
      [25, 'ml', 'Campari'],
      [25, 'ml', 'Sweet vermouth'],
    ]);
  });
});
