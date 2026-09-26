/**
 * The ladder's pure half (founder item 36). The case the founder's shape
 * turns on is the first: a rung HIDES cards and never re-ranks them, so a
 * box keeps the size its worth earned against the whole book.
 */

import { describe, expect, it } from 'vitest';
import { rankOffers, type OfferDto, type OfferScopeTag } from './promotions-format';
import {
  NO_FACETS,
  defaultRung,
  facetOptions,
  facetsFromParams,
  foldText,
  inRung,
  matchesFacets,
  menuTagOf,
  rungCounts,
  visible,
  writeParams,
} from './promotions-scope';

const TODAY = '2026-09-26';

function tag(over: Partial<OfferScopeTag> = {}): OfferScopeTag {
  return { scope: 'menu', wines: 1, winesOnMenu: 1, menuMatches: [], categories: ['wine'], runningLow: [], ...over };
}

function offer(id: string, worth: number | null, over: Partial<OfferDto> = {}): OfferDto {
  return {
    id,
    provider_id: 'v1',
    provider_name: 'Empire',
    name: `offer ${id}`,
    promo_type: 'seasonal',
    description: null,
    conditions: {},
    discount_value: { percent: 10 },
    applicable_wines: ['Narince'],
    start_date: '2026-09-01',
    end_date: '2026-10-30',
    confidence: 0.8,
    created_at: null,
    dismissed_at: null,
    dismissed_by: null,
    state: 'open',
    grade: {
      status: 'graded',
      qualification: null,
      wines: [
        {
          wine: 'Narince',
          matchedAs: 'Narince',
          baseline: null,
          offered: null,
          bestElsewhere: null,
          market: null,
          reference: null,
          deltaPct: -5,
          verdict: 'beats',
          worth:
            worth == null
              ? null
              : { amount: worth, currency: 'TRY', quantity: 10, invoiceLines: 2, windowDays: 540, comparisonDate: '2026-09-01', comparisonAgeDays: 25, maxAgeDays: 180 },
          worthWithheld: null,
          skipped: [],
        },
      ],
      tally: { beats: 1, matches: 0, above: 0, ungraded: 0 },
      vendor: { lastPurchaseDate: null, paidLines: 0 },
    },
    bundle: null,
    scope: tag(),
    ...over,
  };
}

describe('rank once, then hide (box sizes fixed across rungs)', () => {
  const book = [
    offer('hero-other', 500, { scope: tag({ scope: 'other' }) }),
    offer('l1-stock', 300, { scope: tag({ scope: 'stock' }) }),
    offer('l2-menu', 200),
    offer('l3-menu', 150),
    offer('c-menu', 20),
  ];
  const ranked = rankOffers(book);
  const tiersIn = (rung: 'menu' | 'stock' | 'all') =>
    ranked.filter((r) => visible(r.offer, rung, NO_FACETS, TODAY)).map((r) => [r.offer.id, r.tier]);

  it('keeps every card at the tier the whole book gave it, in every rung', () => {
    expect(tiersIn('all')).toEqual([
      ['hero-other', 'hero'],
      ['l1-stock', 'large'],
      ['l2-menu', 'large'],
      ['l3-menu', 'large'],
      ['c-menu', 'compact'],
    ]);
    // "On my menu": the hero is not on the menu, so NO card is promoted into its place.
    expect(tiersIn('menu')).toEqual([
      ['l2-menu', 'large'],
      ['l3-menu', 'large'],
      ['c-menu', 'compact'],
    ]);
    expect(tiersIn('stock')).toEqual([
      ['l1-stock', 'large'],
      ['l2-menu', 'large'],
      ['l3-menu', 'large'],
      ['c-menu', 'compact'],
    ]);
  });
});

describe('the rungs contain each other', () => {
  it('menu ⊂ stock ⊂ all', () => {
    const m = offer('m', 1);
    const s = offer('s', 1, { scope: tag({ scope: 'stock' }) });
    const o = offer('o', 1, { scope: tag({ scope: 'other' }) });
    expect([m, s, o].map((x) => inRung(x, 'menu'))).toEqual([true, false, false]);
    expect([m, s, o].map((x) => inRung(x, 'stock'))).toEqual([true, true, false]);
    expect([m, s, o].map((x) => inRung(x, 'all'))).toEqual([true, true, true]);
    expect(rungCounts([m, s, o], NO_FACETS, TODAY)).toEqual({ menu: 1, stock: 2, all: 3 });
  });

  it('opens on the menu when a menu is read, on everything stocked when none is', () => {
    const house = { coverage: { lines: 0, drinkLines: 0, linked: 0, notLinked: 0, otherLines: 0 }, shelf: { rows: 0, active: 0, counted: 0 } };
    const base = { read_at: '', offers: [offer('a', 1)], ledger: { window_days: 540, since: '', paid_lines: 0, house_sightings: 0, market_sightings: 0, skipped_sightings: 0 } };
    expect(defaultRung({ ...base, house: { ...house, menus: [{ menu_id: 'm', name: null, read_at: null }] } })).toBe('menu');
    expect(defaultRung({ ...base, house: { ...house, menus: [] } })).toBe('stock');
    // A gateway older than the ladder: everything, unscoped.
    expect(defaultRung(base)).toBe('all');
  });
});

describe('facets — AND across, OR within', () => {
  const a = offer('a', 1, { provider_id: 'v1', scope: tag({ categories: ['wine'] }) });
  const b = offer('b', 1, { provider_id: 'v2', provider_name: 'Winebow', scope: tag({ categories: ['beer'] }) });
  const c = offer('c', 1, { provider_id: 'v2', provider_name: 'Winebow', end_date: '2026-09-29', scope: tag({ categories: ['spirits'] }) });

  it('vendor chips OR together', () => {
    expect([a, b, c].filter((o) => matchesFacets(o, { ...NO_FACETS, vendors: ['v1', 'v2'] }, TODAY)).length).toBe(3);
    expect([a, b, c].filter((o) => matchesFacets(o, { ...NO_FACETS, vendors: ['v2'] }, TODAY)).map((o) => o.id)).toEqual(['b', 'c']);
  });

  it('a category AND a vendor narrow together', () => {
    expect([a, b, c].filter((o) => matchesFacets(o, { ...NO_FACETS, vendors: ['v2'], categories: ['beer'] }, TODAY)).map((o) => o.id)).toEqual(['b']);
  });

  it('ends soon is seven days or fewer, on an open offer', () => {
    expect([a, b, c].filter((o) => matchesFacets(o, { ...NO_FACETS, endsSoon: true }, TODAY)).map((o) => o.id)).toEqual(['c']);
    expect(matchesFacets(offer('u', 1, { end_date: null, state: 'undated' }), { ...NO_FACETS, endsSoon: true }, TODAY)).toBe(false);
  });

  it('running low keeps only offers the gateway tagged from COUNTED stock', () => {
    const low = offer('low', 1, { scope: tag({ runningLow: [{ wine: 'Narince', stockLive: 1, thresholdMin: 6, countedAt: '2026-09-20' }] }) });
    expect([a, low].filter((o) => matchesFacets(o, { ...NO_FACETS, runningLow: true }, TODAY)).map((o) => o.id)).toEqual(['low']);
  });

  it('search folds accents and the dotless i, and reads the vendor and the matched menu line', () => {
    const k = offer('k', 1, { applicable_wines: ['Kalecik Karası'], scope: tag({ menuMatches: [{ wine: 'Kalecik Karası', menuLineId: 'l', menuLine: 'House red' }] }) });
    expect(matchesFacets(k, { ...NO_FACETS, q: 'KALECİK karasi' }, TODAY)).toBe(true);
    expect(matchesFacets(k, { ...NO_FACETS, q: 'house red' }, TODAY)).toBe(true);
    expect(matchesFacets(k, { ...NO_FACETS, q: 'empire' }, TODAY)).toBe(true);
    expect(matchesFacets(k, { ...NO_FACETS, q: 'narince' }, TODAY)).toBe(false);
    expect(foldText('Öküzgözü')).toBe('okuzgozu');
  });

  it('offers a chip only for what the rung holds, but keeps a chosen one so it can be taken off', () => {
    const opts = facetOptions([a, b], 'menu', { ...NO_FACETS, vendors: ['gone'] }, TODAY);
    expect(opts.vendors.map((v) => [v.id, v.count])).toEqual([
      ['v1', 1],
      ['v2', 1],
      ['gone', 0],
    ]);
    expect(opts.categories.map((x) => x.id)).toEqual(['wine', 'beer']);
  });
});

describe('the URL is the state', () => {
  it('round-trips the rung and every facet', () => {
    const f = { vendors: ['v1', 'v2'], categories: ['wine' as const], endsSoon: true, runningLow: true, q: 'rose' };
    const p = writeParams(new URLSearchParams('keep=1'), 'stock', f);
    expect(p.get('scope')).toBe('stock');
    expect(p.get('keep')).toBe('1');
    expect(facetsFromParams(p)).toEqual(f);
  });

  it('ignores a category it does not know', () => {
    expect(facetsFromParams(new URLSearchParams('cat=by_the_glass&cat=beer')).categories).toEqual(['beer']);
  });
});

describe('menuTagOf — the menu line the claim rests on', () => {
  it('names the line, or the first and how many more', () => {
    expect(menuTagOf(offer('a', 1, { scope: tag({ menuMatches: [] }) }))).toBeNull();
    expect(menuTagOf(offer('a', 1, { scope: tag({ menuMatches: [{ wine: 'x', menuLineId: '1', menuLine: 'Malbec' }] }) }))).toBe('Malbec');
    expect(
      menuTagOf(
        offer('a', 1, {
          scope: tag({
            menuMatches: [
              { wine: 'x', menuLineId: '1', menuLine: 'Malbec' },
              { wine: 'y', menuLineId: '2', menuLine: 'Rosé' },
            ],
          }),
        }),
      ),
    ).toBe('Malbec +1 more');
  });
});
