/**
 * Carry many, the reading half (inventory r40): one good a line, a par read as
 * a count is read, a listed or twice-listed line left out before anything is
 * sent, and the whole result said in words.
 */
import { describe, expect, it } from 'vitest';
import { CARRIED_ONCE, inTurns, carryManySummary, readCarryLines } from './carry-lines';

describe('readCarryLines', () => {
  it('reads one good a line, drops blank lines and bullets, and keeps each line number', () => {
    const lines = readCarryLines('- Bread flour\n\n• Lemons\n3. Olive  oil\n  ', 'g', new Set());
    expect(lines.map((l) => [l.line, l.name, l.par, l.problem, l.skip])).toEqual([
      [1, 'Bread flour', null, null, null],
      [3, 'Lemons', null, null, null],
      [4, 'Olive oil', null, null, null],
    ]);
  });

  it('reads a par after the first comma or tab followed by a figure, in the book unit', () => {
    const lines = readCarryLines('Bread flour, 5 kg\nTomatoes, cherry, 2,5 kg\nSugar\t0.5\nSalt, 250 g', 'g', new Set());
    expect(lines.map((l) => [l.name, l.par, l.problem])).toEqual([
      ['Bread flour', 5000, null],
      ['Tomatoes, cherry', 2500, null],
      ['Sugar', 500, null],
      ['Salt', 250, null],
    ]);
  });

  it('keeps a name that only has words after its comma, and a leading 00 that is not a list number', () => {
    const lines = readCarryLines('Tomatoes, cherry\n00 flour', 'g', new Set());
    expect(lines.map((l) => [l.name, l.par])).toEqual([
      ['Tomatoes, cherry', null],
      ['00 flour', null],
    ]);
  });

  it('asks about a bare whole par for a weighed good, never guessing g or kg', () => {
    const [l] = readCarryLines('Flour, 5', 'g', new Set());
    expect(l.par).toBeNull();
    expect(l.problem).toBe('Say which: 5 g or 5 kg. A figure after a comma is read as the par.');
  });

  it('takes a whole par for a counted good and refuses a part of one', () => {
    const [a, b] = readCarryLines('Napkins, 200\nStraws, 1.5', 'each', new Set());
    expect([a.par, a.problem]).toEqual([200, null]);
    expect(b.par).toBeNull();
    expect(b.problem).toContain('A whole number of items.');
  });

  it('leaves out a name already on the list and a name listed twice, whatever its case', () => {
    const lines = readCarryLines('Lemons\nflour\nLEMONS\nFlour', 'g', new Set(['flour']));
    expect(lines.map((l) => [l.name, l.skip])).toEqual([
      ['Lemons', null],
      ['flour', 'listed'],
      ['LEMONS', 'twice'],
      ['Flour', 'listed'],
    ]);
  });

  it('refuses a name longer than the server takes', () => {
    const [l] = readCarryLines('x'.repeat(121), 'g', new Set());
    expect(l.problem).toBe('Keep a name to 120 characters.');
    const [ok] = readCarryLines('x'.repeat(120), 'g', new Set());
    expect(ok.problem).toBeNull();
  });
});

describe('carryManySummary', () => {
  it('names up to three goods, then how many more', () => {
    const refused = ['A', 'B', 'C', 'D'].map((name) => ({ name, outcome: { kind: 'refused' as const, text: 'x' } }));
    expect(carryManySummary(refused, { listed: 0, twice: 0 })).toBe('Nothing was added for A, B, C and 1 more; each says why below.');
    expect(carryManySummary(refused.slice(0, 2), { listed: 0, twice: 0 })).toBe('Nothing was added for A and B; each says why below.');
  });

  it('says one carried good in the singular', () => {
    expect(carryManySummary([{ name: 'A', outcome: { kind: 'carried' } }], { listed: 1, twice: 0 })).toBe(
      'Carried 1 good, with nothing on hand until a delivery or a count. Left out: 1 already on the list.',
    );
  });
});

describe('carryManySummary: not known', () => {
  it('names a line whose answer never came, and says trying again is safe', () => {
    expect(carryManySummary([{ name: 'Lemons', outcome: { kind: 'unknown', text: 'x' } }], { listed: 0, twice: 0 })).toBe(
      `For Lemons it is not known whether it was added. ${CARRIED_ONCE}`,
    );
  });
});

describe('inTurns', () => {
  it('gives every item its turn, never more than the limit at once', async () => {
    let inFlight = 0;
    let most = 0;
    const done: number[] = [];
    await inTurns([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      done.push(n);
      inFlight -= 1;
    });
    expect([...done].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(most).toBe(3);
  });

  it('does nothing for an empty list', async () => {
    let called = 0;
    await inTurns([], 4, async () => {
      called += 1;
    });
    expect(called).toBe(0);
  });
});
