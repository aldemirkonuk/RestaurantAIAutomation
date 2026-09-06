import { describe, expect, it } from 'vitest';
import { VENDOR_UNNAMED, vendorClause, vendorLine, vendorName } from './vendor';

/**
 * The vendor's three states, and the two ways a screen prints them.
 *
 * WHY EACH CASE EXISTS. `providerName` was declared on the shared `Order` type
 * and never sent, so four surfaces read `undefined` and printed either the
 * literal word "vendor" or nothing at all. The wire now sends it, and sends
 * `null` when the join answered nothing — a different fact from the key being
 * absent, which means the route never joined. This module is where those become
 * words, so this is where the distinction is pinned:
 *
 *  * a name is a name, trimmed;
 *  * `null`, `undefined` and a BLANK string are all "no name here". They differ
 *    in what they say about the query, and a screen can do nothing different
 *    about any of them, so they print one sentence rather than three;
 *  * a row slot says the words; a running sentence stays silent unless asked.
 *    That asymmetry is the one judgement call in the module and it is tested
 *    rather than left to the reader.
 */

describe('vendorName', () => {
  it('is the name, trimmed', () => {
    expect(vendorName({ providerName: 'Vinifera Imports' })).toBe('Vinifera Imports');
    expect(vendorName({ providerName: '  Vinifera Imports  ' })).toBe('Vinifera Imports');
  });

  it('is null for every state that is not a name', () => {
    // null = joined, found nothing. undefined / absent = did not join.
    // '' and '   ' = a provider row whose name column is blank.
    expect(vendorName({ providerName: null })).toBeNull();
    expect(vendorName({ providerName: undefined })).toBeNull();
    expect(vendorName({})).toBeNull();
    expect(vendorName(null)).toBeNull();
    expect(vendorName(undefined)).toBeNull();
    expect(vendorName({ providerName: '' })).toBeNull();
    expect(vendorName({ providerName: '   ' })).toBeNull();
  });
});

describe('vendorLine — the slot in a list row', () => {
  it('prints the name', () => {
    expect(vendorLine({ providerName: 'Vinifera Imports' })).toBe('Vinifera Imports');
  });

  it('never returns an empty string', () => {
    // A blank where the vendor goes reads as "there is no vendor", which is the
    // absence-reported-as-health fault this whole change exists to end.
    for (const order of [{ providerName: null }, {}, null, undefined, { providerName: ' ' }]) {
      expect(vendorLine(order as never)).toBe(VENDOR_UNNAMED);
      expect(vendorLine(order as never)).not.toBe('');
    }
  });
});

describe('vendorClause — the clause in a running sentence', () => {
  it('appends the name with its separator', () => {
    expect(vendorClause({ providerName: 'Vinifera Imports' })).toBe(' · Vinifera Imports');
    expect(vendorClause({ providerName: 'Vinifera Imports' }, { separator: ', ' })).toBe(
      ', Vinifera Imports',
    );
  });

  it('says nothing by default when there is no name, and says it when asked', () => {
    expect(vendorClause({ providerName: null })).toBe('');
    expect(vendorClause({})).toBe('');
    expect(vendorClause({ providerName: null }, { sayWhenUnnamed: true })).toBe(
      ` · ${VENDOR_UNNAMED}`,
    );
  });
});
