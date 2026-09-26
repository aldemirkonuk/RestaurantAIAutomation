/**
 * The /vendors scope ladder — founder, 2026-09-26, item 36 (ADR 0221).
 *
 *   Supplies my menu  →  All my vendors  →  Find new vendors
 *
 * "Supplies my menu" is the house's own vendors with PURCHASE evidence for a
 * wine on the CURRENT menu (`GET /providers/menu-supply`). "All my vendors" is
 * the whole house-owned book. "Find new vendors" searches the curated
 * `vendor_catalogue` — the existing search, not ADR 0221's deferred shared
 * layer.
 *
 * Pure: which scope the page opens on, what each scope shows, and the counts.
 * The rendering is in VendorScopeBar / ProvidersNext.
 */

import type { MenuSupplier, VendorMenuSupply } from '../../../services/api/vendorMenuSupply';
import type {
  OwnWineSeller,
  SightingKind,
  WineListed,
  WineSold,
} from '../../../services/api/vendorWineSearch';
import { countryByName } from '../../../lib/countries';

export type VendorScope = 'menu' | 'all' | 'find';

export const SCOPE_LABEL: Record<VendorScope, string> = {
  menu: 'Supplies my menu',
  all: 'All my vendors',
  find: 'Find new vendors',
};

/**
 * The scope the URL asks for. `?scope=` is this page's own state; `?tab=discover`
 * is what the permanent `/distributors` redirect carries (App.tsx, RenamedRoute),
 * so an old discovery link lands on the discovery rung.
 */
export function scopeFromSearch(search: string): VendorScope | null {
  const params = new URLSearchParams(search);
  const s = params.get('scope');
  if (s === 'menu' || s === 'all' || s === 'find') return s;
  if (params.get('tab') === 'discover') return 'find';
  return null;
}

export type SupplyState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: VendorMenuSupply };

/**
 * Why the page did NOT open on "Supplies my menu", in words for the banner —
 * or null when it did (or is still finding out).
 */
export type WidenReason = 'no-menu' | 'menu-unlinked' | 'unreadable';

export function widenReason(supply: SupplyState): WidenReason | null {
  if (supply.status === 'loading') return null;
  if (supply.status === 'error') return 'unreadable';
  if (!supply.data.menu.current) return 'no-menu';
  if (supply.data.menu.wines === 0) return 'menu-unlinked';
  return null;
}

/**
 * Where the page opens. An asked-for scope wins. Otherwise the house's menu —
 * unless there is no current menu, its lines link no wine, or the evidence
 * could not be read, and then "All my vendors" with a banner that says which
 * (founder: "no menu → widen + banner"). While the answer is still coming, the
 * menu rung shows its own "reading" line rather than flashing the whole book.
 */
export function openingScope(asked: VendorScope | null, supply: SupplyState): VendorScope {
  if (asked) return asked;
  return widenReason(supply) ? 'all' : 'menu';
}

export function supplierIndex(supply: SupplyState): Map<string, MenuSupplier> | null {
  if (supply.status !== 'ready') return null;
  return new Map(supply.data.suppliers.map((s) => [s.providerId, s]));
}

/**
 * The cards a scope shows, in the book's own order (the menu rung hides cards;
 * it never re-sorts them). `null` when the menu rung cannot be answered yet.
 */
export function cardsForScope<T extends { provider: { id: string } }>(
  scope: Exclude<VendorScope, 'find'>,
  cards: T[],
  index: Map<string, MenuSupplier> | null,
): T[] | null {
  if (scope === 'all') return cards;
  if (!index) return null;
  return cards.filter((c) => index.has(c.provider.id));
}

export interface ScopeCounts {
  /** null while the menu evidence is unknown (loading or failed). */
  menu: number | null;
  all: number | null;
  /** null until the catalogue has answered. */
  find: number | null;
}

export function scopeCounts(
  cards: Array<{ provider: { id: string } }> | null,
  index: Map<string, MenuSupplier> | null,
  catalogueTotal: number | null,
): ScopeCounts {
  return {
    menu: cards && index ? cards.filter((c) => index.has(c.provider.id)).length : null,
    all: cards ? cards.length : null,
    find: catalogueTotal,
  };
}

/** "4 wines on your menu · priced, ordered" — the card's evidence tag. */
export function supplierTag(s: MenuSupplier): string {
  const kinds = [
    s.priced > 0 ? 'priced' : null,
    s.ordered > 0 ? 'ordered' : null,
    s.stocked > 0 ? 'stocked' : null,
  ].filter(Boolean);
  const wines = s.menuWines === 1 ? '1 wine on your menu' : `${s.menuWines} wines on your menu`;
  return kinds.length ? `${wines} · ${kinds.join(', ')}` : wines;
}

// ---------------------------------------------------------------------------
// The name-only wine search — founder, 2026-09-26, round 7, item 48 (ADR 0221).
//
// "Supplies my menu" stays EXACT vintage (the menu line is one vintage). With
// the menu rung not applied — on "All my vendors" and "Find new vendors" — a
// search by a wine's NAME matches ANY vintage, and each vendor is labelled with
// the vintage(s) it sold (own book) or was seen pricing (catalogue). The match
// itself runs on the gateway (`vendor-wine-search.ts`); these are the page's
// rules for when to ask and how to say the answer.
// ---------------------------------------------------------------------------

/** Lower-case, accents stripped, punctuation to spaces — the gateway's fold. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Whether the text is worth sending as a wine search: at least two characters
 * of NAME once any four-digit year is set aside (the gateway's own floor — it
 * answers 400 below it, and a year alone names no wine).
 */
export function wineSearchable(text: string): boolean {
  const words = fold(text)
    .split(' ')
    .filter((w) => w && !/^(19|20)\d{2}$/.test(w));
  return words.join(' ').length >= 2;
}

/** A vendor's own NAME matches the typed text (every word, accent-blind). */
export function vendorNameMatches(name: string, text: string): boolean {
  const words = fold(text).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const hay = ` ${fold(name)} `;
  return words.every((w) => hay.includes(w));
}

type Named = { producer: string | null; name: string; vintage: number | null };

function wineText(w: Named): string {
  return w.producer && !fold(w.name).includes(fold(w.producer))
    ? `${w.producer} ${w.name}`
    : w.name;
}

/**
 * "Opus One Winery Opus One 2019, 2018" — one wine, its vintages newest first.
 * An unstated vintage is said, never dropped: "vintage not stated".
 */
export function vintagesLine(wines: Named[]): string {
  const byWine = new Map<string, Array<number | null>>();
  for (const w of wines) {
    const k = wineText(w);
    const list = byWine.get(k) ?? [];
    list.push(w.vintage);
    byWine.set(k, list);
  }
  return [...byWine.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, vs]) => {
      const years = [...new Set(vs.filter((v): v is number => v !== null))].sort((a, b) => b - a);
      const parts = years.map(String);
      if (vs.some((v) => v === null)) parts.push('vintage not stated');
      return `${k} ${parts.join(', ')}`;
    })
    .join(' · ');
}

/** The card tag on "All my vendors": "Sold you Opus One 2019, 2018 · ordered, priced". */
export function soldTag(seller: OwnWineSeller): string {
  const any = (k: keyof Pick<WineSold, 'priced' | 'ordered' | 'stocked'>) =>
    seller.wines.some((w) => w[k]);
  const kinds = [any('priced') ? 'priced' : null, any('ordered') ? 'ordered' : null, any('stocked') ? 'stocked' : null]
    .filter(Boolean)
    .join(', ');
  return `Sold you ${vintagesLine(seller.wines)}${kinds ? ` · ${kinds}` : ''}`;
}

const KIND_WORD: Record<SightingKind, string> = {
  invoiced: 'Invoiced',
  quoted: 'Quoted',
  listed: 'Listed',
};

/**
 * The catalogue label, grouped by how strongly the vendor was seen with the
 * wine — a price on their site is "Listed", not "Sold" (a sighting is not a
 * sale). A sighting that names no library wine is quoted as the vendor wrote
 * it (its vintage, if any, is in that text), and says so.
 */
export function listedTag(wines: WineListed[]): string {
  const order: SightingKind[] = ['invoiced', 'quoted', 'listed'];
  return order
    .map((k) => {
      const ws = wines.filter((w) => w.kind === k);
      if (ws.length === 0) return null;
      const known = ws.filter((w) => !w.vintageFromText);
      const asWritten = ws.filter((w) => w.vintageFromText);
      const parts = [
        known.length ? vintagesLine(known) : null,
        asWritten.length
          ? `${asWritten.map((w) => `“${w.name}”`).join(', ')} (as written on their list)`
          : null,
      ].filter(Boolean);
      return `${KIND_WORD[k]} ${parts.join(', ')}`;
    })
    .filter(Boolean)
    .join(' · ');
}

/**
 * The country "Find new vendors" opens on — founder, round 7, item 48: the
 * house's own address, US only when it is missing. `restaurants.country` holds
 * whatever the address form wrote (Google's long text, e.g. "Türkiye"), read
 * through `GET /settings/currency` and resolved by the one country table
 * (`lib/countries.ts`). Text the table does not know is NOT guessed at: it
 * falls back to US like a missing country and the hint says which.
 */
export type CountryBasis = 'house' | 'missing' | 'unknown' | 'unreadable';

export function defaultCatalogueCountry(
  house: { readable: boolean; country: string | null } | null,
  failed: boolean,
): { code: string; basis: CountryBasis; written: string | null } {
  if (failed || (house && !house.readable)) return { code: 'US', basis: 'unreadable', written: null };
  const written = house?.country?.trim() || null;
  if (!written) return { code: 'US', basis: 'missing', written: null };
  const c = countryByName(written);
  if (!c) return { code: 'US', basis: 'unknown', written };
  return { code: c.code, basis: 'house', written };
}
