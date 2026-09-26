/**
 * `/promotions` — the house-first ladder and its facets, pure (founder item
 * 36; ADR 0160 §113, round-6 bracket). The gateway tags every offer with the
 * narrowest rung it belongs to (`offer-scope.ts`); this file only decides what
 * a rung and a set of facets SHOW. It never ranks: `rankOffers` runs once
 * over every offer on the table and a rung only hides cards, so a box keeps
 * the size its worth earned against the whole book (founder: box sizes fixed
 * across scopes).
 *
 * THE RUNGS, his words: "On my menu" → "Everything I stock" → "All offers".
 * Each contains the one before it. Facets AND across each other and OR within
 * one (vendor A or vendor B), the convention the research found in Baymard's
 * faceted-search guidance.
 */

import type { CoarseCategory, OfferDto, PromotionsReadDto } from './promotions-format';

/**
 * Fold text for the search box the way the gateway folds a wine name
 * (`offer-grade.ts` `foldName`): strip accents, fold the Turkish dotless i,
 * lowercase, letters and digits only — so "kalecik karasi" finds "KALECİK
 * KARASI".
 */
export function foldText(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ıİ]/g, 'i')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export type Rung = 'menu' | 'stock' | 'all';

export const RUNGS: ReadonlyArray<{ id: Rung; label: string; short: string }> = [
  { id: 'menu', label: 'On my menu', short: 'Menu' },
  { id: 'stock', label: 'Everything I stock', short: 'Stock' },
  { id: 'all', label: 'All offers', short: 'All' },
];

export const CATEGORY_WORDS: Record<CoarseCategory, string> = {
  wine: 'Wine',
  beer: 'Beer',
  spirits: 'Spirits',
  soft_drinks: 'Soft drinks',
  other_drinks: 'Other drinks',
  not_classified: 'Not classified',
};

export const CATEGORY_ORDER: readonly CoarseCategory[] = [
  'wine',
  'beer',
  'spirits',
  'soft_drinks',
  'other_drinks',
  'not_classified',
];

/** "Ends soon" — the same seven days the card's own end-date word turns amber at (`offerStateWord`). */
export const ENDS_SOON_DAYS = 7;

export interface Facets {
  vendors: string[];
  categories: CoarseCategory[];
  endsSoon: boolean;
  runningLow: boolean;
  q: string;
}

export const NO_FACETS: Facets = { vendors: [], categories: [], endsSoon: false, runningLow: false, q: '' };

export function activeFacetCount(f: Facets): number {
  return f.vendors.length + f.categories.length + (f.endsSoon ? 1 : 0) + (f.runningLow ? 1 : 0) + (f.q.trim() ? 1 : 0);
}

/** Whether this read carries the ladder at all (a gateway older than it sends neither). */
export function scopeReady(read: PromotionsReadDto | undefined | null): boolean {
  return !!read?.house && read.offers.every((o) => !!o.scope);
}

/** A house with no current menu opens on "Everything I stock" — with the banner, never silently. */
export function defaultRung(read: PromotionsReadDto): Rung {
  if (!scopeReady(read)) return 'all';
  return (read.house?.menus.length ?? 0) > 0 ? 'menu' : 'stock';
}

export function parseRung(v: string | null): Rung | null {
  return v === 'menu' || v === 'stock' || v === 'all' ? v : null;
}

export function inRung(o: OfferDto, rung: Rung): boolean {
  if (rung === 'all' || !o.scope) return true;
  if (rung === 'stock') return o.scope.scope === 'menu' || o.scope.scope === 'stock';
  return o.scope.scope === 'menu';
}

export function endsSoon(o: OfferDto, todayIso: string): boolean {
  if (o.state !== 'open' || !o.end_date) return false;
  const days = Math.ceil((Date.parse(o.end_date) - Date.parse(todayIso)) / 86_400_000);
  return days >= 0 && days <= ENDS_SOON_DAYS;
}

function haystack(o: OfferDto): string {
  return foldText(
    [
      o.name,
      o.provider_name ?? '',
      o.description ?? '',
      ...o.applicable_wines,
      ...(o.scope?.menuMatches.map((m) => m.menuLine) ?? []),
    ].join(' \n '),
  );
}

export function matchesFacets(o: OfferDto, f: Facets, todayIso: string): boolean {
  if (f.vendors.length > 0 && !f.vendors.includes(o.provider_id)) return false;
  if (f.categories.length > 0 && !(o.scope?.categories ?? []).some((c) => f.categories.includes(c))) return false;
  if (f.endsSoon && !endsSoon(o, todayIso)) return false;
  if (f.runningLow && !((o.scope?.runningLow.length ?? 0) > 0)) return false;
  const q = foldText(f.q);
  if (q) {
    const hay = haystack(o);
    if (!q.split(' ').every((word) => hay.includes(word))) return false;
  }
  return true;
}

export function visible(o: OfferDto, rung: Rung, f: Facets, todayIso: string): boolean {
  return inRung(o, rung) && matchesFacets(o, f, todayIso);
}

/** The live count beside each rung: the offers ON THE TABLE that rung would show under the current facets. */
export function rungCounts(onTable: OfferDto[], f: Facets, todayIso: string): Record<Rung, number> {
  const out: Record<Rung, number> = { menu: 0, stock: 0, all: 0 };
  for (const o of onTable) {
    if (!matchesFacets(o, f, todayIso)) continue;
    for (const r of RUNGS) if (inRung(o, r.id)) out[r.id] += 1;
  }
  return out;
}

export interface FacetOptions {
  vendors: Array<{ id: string; name: string; count: number }>;
  categories: Array<{ id: CoarseCategory; count: number }>;
  endsSoon: number;
  runningLow: number;
}

/**
 * The choices a facet offers, counted inside the current rung. A vendor or a
 * category with no offer in the rung is not offered as a chip — except one
 * already chosen, which stays so it can be taken off.
 */
export function facetOptions(onTable: OfferDto[], rung: Rung, f: Facets, todayIso: string): FacetOptions {
  const inScope = onTable.filter((o) => inRung(o, rung));
  const vendors = new Map<string, { id: string; name: string; count: number }>();
  const cats = new Map<CoarseCategory, number>();
  let soon = 0;
  let low = 0;
  for (const o of inScope) {
    const v = vendors.get(o.provider_id) ?? { id: o.provider_id, name: o.provider_name ?? 'Unnamed vendor', count: 0 };
    v.count += 1;
    vendors.set(o.provider_id, v);
    for (const c of o.scope?.categories ?? []) cats.set(c, (cats.get(c) ?? 0) + 1);
    if (endsSoon(o, todayIso)) soon += 1;
    if ((o.scope?.runningLow.length ?? 0) > 0) low += 1;
  }
  for (const id of f.vendors) {
    if (!vendors.has(id)) {
      const named = onTable.find((o) => o.provider_id === id);
      vendors.set(id, { id, name: named?.provider_name ?? 'Unnamed vendor', count: 0 });
    }
  }
  for (const c of f.categories) if (!cats.has(c)) cats.set(c, 0);
  return {
    vendors: [...vendors.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    categories: CATEGORY_ORDER.filter((c) => cats.has(c)).map((c) => ({ id: c, count: cats.get(c) ?? 0 })),
    endsSoon: soon,
    runningLow: low,
  };
}

/* ── the URL is the state (?scope=, ?vendor=, ?cat=, ?soon=1, ?low=1, ?q=) ── */

export function facetsFromParams(p: URLSearchParams): Facets {
  const cats = p.getAll('cat').filter((c): c is CoarseCategory => (CATEGORY_ORDER as readonly string[]).includes(c));
  return {
    vendors: p.getAll('vendor').filter(Boolean),
    categories: cats,
    endsSoon: p.get('soon') === '1',
    runningLow: p.get('low') === '1',
    q: p.get('q') ?? '',
  };
}

export function writeParams(base: URLSearchParams, rung: Rung | null, f: Facets): URLSearchParams {
  const p = new URLSearchParams(base);
  for (const k of ['scope', 'vendor', 'cat', 'soon', 'low', 'q']) p.delete(k);
  if (rung) p.set('scope', rung);
  for (const v of f.vendors) p.append('vendor', v);
  for (const c of f.categories) p.append('cat', c);
  if (f.endsSoon) p.set('soon', '1');
  if (f.runningLow) p.set('low', '1');
  if (f.q.trim()) p.set('q', f.q);
  return p;
}

/** "Kalecik Karası" on the card, or the first line and "+n more" when several matched. */
export function menuTagOf(o: OfferDto): string | null {
  const m = o.scope?.menuMatches ?? [];
  if (m.length === 0) return null;
  return m.length === 1 ? m[0].menuLine : `${m[0].menuLine} +${m.length - 1} more`;
}
