import { describe, expect, it } from 'vitest';
import { heldBackSaid } from './format';

describe('heldBackSaid — why a spend figure is withheld, in words', () => {
  it('is null when nothing is held back', () => {
    expect(heldBackSaid(0, {})).toBeNull();
    expect(heldBackSaid(undefined, undefined)).toBeNull();
    expect(heldBackSaid(0, { EUR: 0 })).toBeNull();
  });

  it('keeps the uncosted sentence when no order is in other money', () => {
    expect(heldBackSaid(2, {})).toBe('2 delivered orders have no recorded cost');
  });

  it('names one currency by its code', () => {
    expect(heldBackSaid(0, { EUR: 1 })).toBe('1 delivered order is in EUR, not the house’s money');
    expect(heldBackSaid(0, { EUR: 2 })).toBe('2 delivered orders are in EUR, not the house’s money');
    // A code counted 0 is no order: it is not listed beside the real one.
    expect(heldBackSaid(0, { EUR: 1, USD: 0 })).toBe('1 delivered order is in EUR, not the house’s money');
  });

  it('lists several currencies, most first, then by code', () => {
    expect(heldBackSaid(0, { USD: 1, EUR: 2, GBP: 1 })).toBe(
      '4 delivered orders are in other currencies (2 EUR, 1 GBP, 1 USD), not the house’s money',
    );
  });

  it('adds the uncosted count after the other money', () => {
    expect(heldBackSaid(1, { EUR: 1 })).toBe(
      '1 delivered order is in EUR, not the house’s money; 1 has no recorded cost',
    );
    expect(heldBackSaid(3, { EUR: 1 })).toMatch(/; 3 have no recorded cost$/);
  });

  it('says the house’s currency could not be read', () => {
    expect(heldBackSaid(0, { TRY: 2 }, true)).toBe(
      '2 delivered orders are in TRY and the house’s currency could not be read',
    );
  });
});
