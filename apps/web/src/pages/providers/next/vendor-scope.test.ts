/**
 * The /vendors scope rules (founder, 2026-09-26, item 36): which rung the page
 * opens on, what each rung shows, and the counts it prints.
 */

import { describe, expect, it } from 'vitest';
import type { VendorMenuSupply } from '../../../services/api/vendorMenuSupply';
import {
  cardsForScope,
  openingScope,
  scopeCounts,
  scopeFromSearch,
  supplierIndex,
  supplierTag,
  widenReason,
  wineSearchable,
  vendorNameMatches,
  vintagesLine,
  soldTag,
  listedTag,
  defaultCatalogueCountry,
  type SupplyState,
} from './vendor-scope';

function supply(over: Partial<VendorMenuSupply['menu']> = {}, suppliers: VendorMenuSupply['suppliers'] = []): SupplyState {
  return {
    status: 'ready',
    data: {
      menu: { current: true, menus: 1, readAt: null, lines: 10, linkedLines: 8, wines: 8, ...over },
      windowDays: 180,
      since: '2026-03-30',
      suppliers,
    },
  };
}

const card = (id: string) => ({ provider: { id } });

describe('scopeFromSearch', () => {
  it('reads ?scope=, and ?tab=discover (the /distributors redirect) as Find new vendors', () => {
    expect(scopeFromSearch('?scope=menu')).toBe('menu');
    expect(scopeFromSearch('?scope=all')).toBe('all');
    expect(scopeFromSearch('?scope=find')).toBe('find');
    expect(scopeFromSearch('?tab=discover')).toBe('find');
    expect(scopeFromSearch('?scope=bogus')).toBeNull();
    expect(scopeFromSearch('?vendor=p1')).toBeNull();
  });
});

describe('openingScope — where the page opens', () => {
  it('opens on the menu when there is a current menu with linked wines', () => {
    expect(openingScope(null, supply())).toBe('menu');
  });

  it('stays on the menu rung while the answer is still coming (no flash of the whole book)', () => {
    expect(openingScope(null, { status: 'loading' })).toBe('menu');
    expect(widenReason({ status: 'loading' })).toBeNull();
  });

  it('widens to All my vendors, and says why, when there is no menu, no linked wine, or no answer', () => {
    expect(openingScope(null, supply({ current: false, menus: 0, wines: 0 }))).toBe('all');
    expect(widenReason(supply({ current: false, menus: 0, wines: 0 }))).toBe('no-menu');
    expect(openingScope(null, supply({ wines: 0, linkedLines: 0 }))).toBe('all');
    expect(widenReason(supply({ wines: 0, linkedLines: 0 }))).toBe('menu-unlinked');
    expect(openingScope(null, { status: 'error', message: 'x' })).toBe('all');
    expect(widenReason({ status: 'error', message: 'x' })).toBe('unreadable');
  });

  it('an asked-for scope always wins', () => {
    expect(openingScope('find', supply())).toBe('find');
    expect(openingScope('menu', supply({ current: false }))).toBe('menu');
  });
});

describe('cardsForScope and scopeCounts', () => {
  const cards = [card('a'), card('b'), card('c')];
  const s = supply({}, [
    { providerId: 'c', menuWines: 2, priced: 1, ordered: 1, stocked: 0 },
    { providerId: 'a', menuWines: 1, priced: 0, ordered: 0, stocked: 1 },
    { providerId: 'gone', menuWines: 5, priced: 5, ordered: 0, stocked: 0 },
  ]);
  const idx = supplierIndex(s);

  it('the menu rung hides cards and keeps the book order — it never re-sorts', () => {
    expect(cardsForScope('menu', cards, idx)?.map((c) => c.provider.id)).toEqual(['a', 'c']);
    expect(cardsForScope('all', cards, idx)).toBe(cards);
  });

  it('the menu rung is unanswered (null), not empty, while its evidence is unknown', () => {
    expect(cardsForScope('menu', cards, null)).toBeNull();
    expect(scopeCounts(cards, null, null)).toEqual({ menu: null, all: 3, find: null });
  });

  it('counts only vendors still in the book (a supplier row for a removed vendor is not counted)', () => {
    expect(scopeCounts(cards, idx, 42)).toEqual({ menu: 2, all: 3, find: 42 });
  });

  it('the book unknown is a dash, not zero', () => {
    expect(scopeCounts(null, idx, null)).toEqual({ menu: null, all: null, find: null });
  });
});

describe('supplierTag', () => {
  it('names the wine count and the kinds of evidence', () => {
    expect(supplierTag({ providerId: 'x', menuWines: 1, priced: 0, ordered: 0, stocked: 1 })).toBe(
      '1 wine on your menu · stocked',
    );
    expect(supplierTag({ providerId: 'x', menuWines: 3, priced: 2, ordered: 1, stocked: 0 })).toBe(
      '3 wines on your menu · priced, ordered',
    );
  });
});

describe('the name-only wine search (founder, 2026-09-26, round 7, item 48)', () => {
  it('asks only with two characters of NAME; a year alone is not a name', () => {
    expect(wineSearchable('')).toBe(false);
    expect(wineSearchable('o')).toBe(false);
    expect(wineSearchable('2019')).toBe(false);
    expect(wineSearchable('op')).toBe(true);
    expect(wineSearchable('opus 2019')).toBe(true);
  });

  it('matches a vendor name word by word, accent- and case-blind', () => {
    expect(vendorNameMatches('Bodega Álvaro', 'alvaro bodega')).toBe(true);
    expect(vendorNameMatches('Bodega Álvaro', 'cave')).toBe(false);
    expect(vendorNameMatches('Bodega Álvaro', '  ')).toBe(true);
  });

  it('says every vintage, newest first, and never drops an unstated one', () => {
    expect(
      vintagesLine([
        { producer: 'Catena', name: 'Malbec', vintage: 2018 },
        { producer: 'Catena', name: 'Malbec', vintage: 2021 },
        { producer: 'Catena', name: 'Malbec', vintage: null },
      ]),
    ).toBe('Catena Malbec 2021, 2018, vintage not stated');
    // the producer is not repeated when the name already carries it
    expect(vintagesLine([{ producer: 'Opus One', name: 'Opus One', vintage: 2019 }])).toBe('Opus One 2019');
  });

  it('labels a house vendor with what it sold and how the house knows', () => {
    expect(
      soldTag({
        providerId: 'v1',
        wines: [
          { masterWineId: 'a', producer: null, name: 'Sancerre', vintage: 2023, priced: false, ordered: false, stocked: true },
          { masterWineId: 'b', producer: null, name: 'Sancerre', vintage: 2022, priced: true, ordered: false, stocked: false },
        ],
      }),
    ).toBe('Sold you Sancerre 2023, 2022 · priced, stocked');
  });

  it('never calls a sighting a sale: invoiced, quoted, listed, and the vendor’s own text quoted', () => {
    expect(
      listedTag([
        { masterWineId: null, producer: null, name: 'Sancerre Blanc 2021', vintage: 2021, vintageFromText: true, kind: 'listed', lastSeen: null },
        { masterWineId: 'a', producer: null, name: 'Sancerre', vintage: 2022, vintageFromText: false, kind: 'invoiced', lastSeen: null },
      ]),
    ).toBe('Invoiced Sancerre 2022 · Listed “Sancerre Blanc 2021” (as written on their list)');
  });

  it('opens Find new vendors on the house’s country; US only when it is missing, unknown or unreadable', () => {
    const house = (country: string | null) => ({ readable: true, country });
    expect(defaultCatalogueCountry(house('Türkiye'), false)).toEqual({ code: 'TR', basis: 'house', written: 'Türkiye' });
    expect(defaultCatalogueCountry(house('United Kingdom'), false).code).toBe('GB');
    expect(defaultCatalogueCountry(house('tr'), false).code).toBe('TR');
    expect(defaultCatalogueCountry(house(null), false)).toEqual({ code: 'US', basis: 'missing', written: null });
    expect(defaultCatalogueCountry(house('  '), false).basis).toBe('missing');
    expect(defaultCatalogueCountry(house('Atlantis'), false)).toEqual({ code: 'US', basis: 'unknown', written: 'Atlantis' });
    expect(defaultCatalogueCountry({ readable: false, country: 'Türkiye' }, false).basis).toBe('unreadable');
    expect(defaultCatalogueCountry(null, true).basis).toBe('unreadable');
  });
});
