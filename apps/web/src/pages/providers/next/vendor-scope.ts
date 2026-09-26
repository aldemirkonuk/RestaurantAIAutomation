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
