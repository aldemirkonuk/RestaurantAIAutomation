/**
 * The /vendors scope ladder's state — founder, 2026-09-26, item 36 (ADR 0221).
 *
 * Owns: which rung is showing (and the `?scope=` that remembers it), the
 * "Supplies my menu" evidence (`GET /providers/menu-supply`), and the "Find new
 * vendors" catalogue search with its live total (`GET /vendor-catalogue/search`,
 * the existing curated search). The pure rules are in `vendor-scope.ts`.
 *
 * The URL is read and written through `window.location` / `history`, like
 * `?vendor=` on this page, rather than router state: the page is also rendered
 * outside a router in its tests, and nothing else on the route listens to it.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { fetchVendorMenuSupply } from '../../../services/api/vendorMenuSupply';
import {
  searchVendorCataloguePage,
  type VendorSearchResponse,
} from '../../../services/api/vendors';
import {
  cardsForScope,
  openingScope,
  scopeCounts,
  scopeFromSearch,
  supplierIndex,
  widenReason,
  type ScopeCounts,
  type SupplyState,
  type VendorScope,
  type WidenReason,
} from './vendor-scope';
import type { MenuSupplier } from '../../../services/api/vendorMenuSupply';

function serverMessage(e: unknown): string {
  const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  if (typeof msg === 'string' && msg.trim()) return msg;
  return e instanceof Error ? e.message : 'unknown error';
}

function askedScope(): VendorScope | null {
  if (typeof window === 'undefined') return null;
  return scopeFromSearch(window.location.search);
}

function writeScope(scope: VendorScope) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('scope', scope);
  // `tab=discover` is how the old /distributors address arrives; once the
  // person has chosen a rung it has said all it had to say.
  url.searchParams.delete('tab');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/** The catalogue is searched on a pause in typing, not on every key. */
function useSettled<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

export interface CatalogueSearch {
  q: string;
  setQ: (q: string) => void;
  country: string;
  setCountry: (c: string) => void;
  status: 'loading' | 'error' | 'ready';
  message: string | null;
  result: VendorSearchResponse | null;
}

export interface VendorScopes<T> {
  scope: VendorScope;
  choose: (s: VendorScope) => void;
  /** True once the person (or the URL) chose; the banner is for the default. */
  chosen: boolean;
  supply: SupplyState;
  reason: WidenReason | null;
  counts: ScopeCounts;
  /** The cards the current rung shows; null while the menu rung is unanswered. */
  visible: T[] | null;
  supplierOf: (providerId: string) => MenuSupplier | null;
  find: CatalogueSearch;
  refetchSupply: () => void;
}

export function useVendorScopes<T extends { provider: { id: string } }>(
  cards: T[],
  cardsKnown: boolean,
): VendorScopes<T> {
  const { activeRestaurantId } = useAuth();
  const [asked, setAsked] = useState<VendorScope | null>(askedScope);

  const supplyQ = useQuery({
    queryKey: ['vendor-menu-supply', activeRestaurantId ?? ''],
    queryFn: fetchVendorMenuSupply,
    enabled: Boolean(activeRestaurantId),
    staleTime: 60_000,
    retry: 1,
  });

  const supply: SupplyState = supplyQ.data
    ? { status: 'ready', data: supplyQ.data }
    : supplyQ.isError
      ? { status: 'error', message: serverMessage(supplyQ.error) }
      : { status: 'loading' };

  const [q, setQ] = useState('');
  // The curated catalogue is keyed by country; the existing search (and the
  // add-vendor modal before it) opens on US. The field is on screen so a house
  // elsewhere can change it — nothing here guesses a country for them.
  const [country, setCountry] = useState('US');
  const settledQ = useSettled(q.trim());
  const settledCountry = useSettled(country.trim().toUpperCase());
  const catalogueQ = useQuery({
    queryKey: ['vendor-catalogue-search', settledQ, settledCountry],
    queryFn: () => searchVendorCataloguePage(settledQ, settledCountry, 20, 0),
    enabled: settledCountry.length > 0,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const reason = widenReason(supply);
  const index = supplierIndex(supply);
  const scope = openingScope(asked, supply);
  const counts = scopeCounts(
    cardsKnown ? cards : null,
    reason ? null : index,
    catalogueQ.data ? catalogueQ.data.total : null,
  );

  const visible = useMemo(
    () => (scope === 'find' ? null : cardsForScope(scope, cards, reason ? null : index)),
    [scope, cards, index, reason],
  );

  return {
    scope,
    choose: (s) => {
      setAsked(s);
      writeScope(s);
    },
    chosen: asked !== null,
    supply,
    reason,
    counts,
    visible,
    supplierOf: (id) => index?.get(id) ?? null,
    find: {
      q,
      setQ,
      country,
      setCountry,
      status: catalogueQ.data ? 'ready' : catalogueQ.isError ? 'error' : 'loading',
      message: catalogueQ.isError ? serverMessage(catalogueQ.error) : null,
      result: catalogueQ.data ?? null,
    },
    refetchSupply: () => void supplyQ.refetch(),
  };
}
