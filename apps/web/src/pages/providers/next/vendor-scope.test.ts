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
