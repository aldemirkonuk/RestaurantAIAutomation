import { describe, expect, it } from 'vitest';
import { heldBackSaid, spendHeldBackSaid } from './format';

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

describe('spendHeldBackSaid — the scanned papers that hold a spend back', () => {
  it('is null when nothing is held back and no sentence is given', () => {
    expect(spendHeldBackSaid({ uncosted: 0, other: {} }, { uncosted: 0, other: {} })).toBeNull();
    expect(spendHeldBackSaid({}, {}, '  ')).toBeNull();
  });

  it('says the orders alone as before', () => {
    expect(spendHeldBackSaid({ uncosted: 2 }, {})).toBe('2 delivered orders have no recorded cost');
  });

  it('says scanned deliveries with no invoice total', () => {
    expect(spendHeldBackSaid({}, { uncosted: 1 })).toBe('1 scanned delivery has no invoice total yet');
    expect(spendHeldBackSaid({}, { uncosted: 3 })).toBe('3 scanned deliveries have no invoice total yet');
  });

  it('says scanned deliveries in other money by code, most first', () => {
    expect(spendHeldBackSaid({}, { other: { EUR: 1 } })).toBe('1 scanned delivery is in EUR, not the house’s money');
    expect(spendHeldBackSaid({}, { other: { USD: 1, EUR: 2 } })).toBe(
      '3 scanned deliveries are in other currencies (2 EUR, 1 USD), not the house’s money',
    );
  });

  it('puts the orders first, then every paper reason, joined by a semicolon', () => {
    expect(spendHeldBackSaid({ uncosted: 1 }, { uncosted: 2, other: { EUR: 1 } })).toBe(
      '1 delivered order has no recorded cost; 1 scanned delivery is in EUR, not the house’s money; 2 scanned deliveries have no invoice total yet',
    );
  });

  it('falls back to the gateway sentence only when no count says why', () => {
    expect(spendHeldBackSaid({}, {}, 'The scanned papers could not be read.')).toBe('The scanned papers could not be read.');
    expect(spendHeldBackSaid({ uncosted: 1 }, {}, 'The scanned papers could not be read.')).toBe(
      '1 delivered order has no recorded cost',
    );
  });
});
