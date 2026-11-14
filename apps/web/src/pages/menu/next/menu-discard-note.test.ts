import { describe, expect, it } from 'vitest';
import { DISCARD_FOOTER, discardedNote } from './menu-discard-note';

const money = (n: number) => `TRY ${n}`;

describe('discardedNote (r36 N5)', () => {
  it('a drink with both house prices names both and where they stay', () => {
    expect(discardedNote({ name: 'Raki', house_price: { bottle: 900, glass: 120, removed: false } }, false, money)).toBe(
      'Raki is off the current menu. Its house price (bottle TRY 900, glass TRY 120) stays on Inventory: change it there under Your price, or the next menu read without it offers to take it off sale.',
    );
  });

  it('a drink with only a bottle price names only the bottle', () => {
    const said = discardedNote({ name: 'Barolo', house_price: { bottle: 3000, glass: null, removed: false } }, false, money);
    expect(said).toContain('(bottle TRY 3000)');
    expect(said).not.toContain('glass');
  });

  it('a drink with only a glass price names only the glass', () => {
    const said = discardedNote({ name: 'Rose', house_price: { bottle: null, glass: 150, removed: false } }, false, money);
    expect(said).toContain('(glass TRY 150)');
    expect(said).not.toContain('bottle');
  });

  it('a drink the house has no price for says no price changed', () => {
    expect(discardedNote({ name: 'Rose', house_price: { bottle: null, glass: null, removed: false } }, false, money)).toBe(
      'Rose is off the current menu. The house has no price for it, so no price changed.',
    );
  });

  it('a drink already off sale, a drink with no house price read, and a dish claim nothing about a price', () => {
    expect(discardedNote({ name: 'Rose', house_price: { bottle: 100, glass: null, removed: true } }, false, money)).toBe(
      'Rose is off the current menu.',
    );
    expect(discardedNote({ name: 'Rose' }, false, money)).toBe('Rose is off the current menu.');
    expect(discardedNote({ name: 'Kebab', house_price: { bottle: 100, glass: null, removed: false } }, true, money)).toBe(
      'Kebab is off the current menu.',
    );
  });

  it('a zero price is still a price', () => {
    expect(discardedNote({ name: 'Water', house_price: { bottle: 0, glass: null, removed: false } }, false, money)).toContain(
      '(bottle TRY 0)',
    );
  });

  it('the footer keeps its first sentence and says the price stays', () => {
    expect(DISCARD_FOOTER.startsWith('Discard takes a line off the current menu.')).toBe(true);
    expect(DISCARD_FOOTER).toContain("A drink's house price stays on Inventory");
    expect(DISCARD_FOOTER).toContain('offers to take it off sale');
  });
});
