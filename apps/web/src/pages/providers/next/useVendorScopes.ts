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
import { settingsApi } from '../../../services/api/settings';
import {
  fetchCatalogueWineListers,
  fetchOwnWineSellers,
  type CatalogueWineSearch,
  type OwnWineSeller,
  type OwnWineSearch,
} from '../../../services/api/vendorWineSearch';
import {
  searchVendorCataloguePage,
  type VendorSearchResponse,
} from '../../../services/api/vendors';
import {
  cardsForScope,
  defaultCatalogueCountry,
  openingScope,
  vendorNameMatches,
  wineSearchable,
  type CountryBasis,
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

export type AskState<R> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: R };

export interface CatalogueSearch {
  q: string;
  setQ: (q: string) => void;
  country: string;
  setCountry: (c: string) => void;
  /**
   * Why the country field holds what it holds before anybody typed in it
   * (founder, round 7, item 48: the house's own country, US only when missing).
   * `typed` once the person changed it.
   */
  countryBasis: CountryBasis | 'typed' | 'reading';
  /** `restaurants.country` as written, for the hint. */
  countryWritten: string | null;
  status: 'loading' | 'error' | 'ready';
  message: string | null;
  result: VendorSearchResponse | null;
  /** The name-only wine search over catalogue sightings (item 48). */
  wine: AskState<CatalogueWineSearch>;
}

/** "All my vendors"' search box: a vendor's name, or a wine it sold (any vintage). */
export interface BookSearch {
  q: string;
  setQ: (q: string) => void;
  /** The wine half; `idle` while the text is too short to be a wine name. */
  wine: AskState<OwnWineSearch>;
  sellerOf: (providerId: string) => OwnWineSeller | null;
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
  book: BookSearch;
  refetchSupply: () => void;
}

function askState<R>(
  enabled: boolean,
  q: { data?: R; isError: boolean; error: unknown },
): AskState<R> {
  if (!enabled) return { status: 'idle' };
  if (q.isError) return { status: 'error', message: serverMessage(q.error) };
  if (q.data !== undefined) return { status: 'ready', data: q.data };
  return { status: 'loading' };
}

export function useVendorScopes<T extends { provider: { id: string; name: string } }>(
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
  // The curated catalogue is keyed by country. Founder, 2026-09-26, round 7,
  // item 48: "Find new vendors" opens on the HOUSE's own country (its address,
  // `restaurants.country`, resolved to ISO-2 by lib/countries.ts), US only when
  // that is missing — and the field stays editable. Until the house's country
  // has answered, the catalogue is not searched at all, so the rung never
  // flashes a US list at a house in Türkiye.
  const houseQ = useQuery({
    queryKey: ['settings', 'currency', activeRestaurantId ?? ''],
    queryFn: () => settingsApi.houseCurrency(),
    enabled: Boolean(activeRestaurantId),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const houseSettled = houseQ.isSuccess || houseQ.isError;
  const derived = defaultCatalogueCountry(houseQ.data ?? null, houseQ.isError);
  const [typedCountry, setTypedCountry] = useState<string | null>(null);
  const country = typedCountry ?? (houseSettled ? derived.code : '');
  const wantCountry = country.trim().toUpperCase();
  const settledQ = useSettled(q.trim());
  const settledCountry = useSettled(wantCountry);
  // The pause has caught up with what the field says (so a debounced "US"
  // from before the house answered is never sent).
  const countryReady = wantCountry.length === 2 && settledCountry === wantCountry;
  const catalogueQ = useQuery({
    queryKey: ['vendor-catalogue-search', settledQ, settledCountry],
    queryFn: () => searchVendorCataloguePage(settledQ, settledCountry, 20, 0),
    enabled: countryReady,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const reason = widenReason(supply);
  const index = supplierIndex(supply);
  const scope = openingScope(asked, supply);

  // The name-only wine search (item 48): any vintage, only where the menu rung
  // is not applied — "All my vendors" (the house's own purchases) and "Find new
  // vendors" (price sightings of curated catalogue vendors).
  const catalogueWineOn = scope === 'find' && countryReady && wineSearchable(settledQ);
  const catalogueWineQ = useQuery({
    queryKey: ['vendor-catalogue-wine', activeRestaurantId ?? '', settledQ, settledCountry],
    queryFn: () => fetchCatalogueWineListers(settledQ, settledCountry),
    enabled: catalogueWineOn,
    staleTime: 60_000,
    retry: 1,
  });

  const [bookQ, setBookQ] = useState('');
  const settledBookQ = useSettled(bookQ.trim());
  const ownWineOn = scope === 'all' && wineSearchable(settledBookQ);
  const ownWineQ = useQuery({
    queryKey: ['vendor-wine-sellers', activeRestaurantId ?? '', settledBookQ],
    queryFn: () => fetchOwnWineSellers(settledBookQ),
    enabled: ownWineOn,
    staleTime: 60_000,
    retry: 1,
  });
  const sellers = useMemo(
    () => new Map((ownWineQ.data?.sellers ?? []).map((s) => [s.providerId, s])),
    [ownWineQ.data],
  );
  // The wine answer is only this box's answer when it was asked for what the
  // box says now (a stale answer for an older text is not shown as current).
  const ownWine: AskState<OwnWineSearch> = askState(
    ownWineOn && settledBookQ === bookQ.trim(),
    ownWineQ,
  );
  const sellerOf = (id: string) =>
    ownWine.status === 'ready' ? (sellers.get(id) ?? null) : null;
  const counts = scopeCounts(
    cardsKnown ? cards : null,
    reason ? null : index,
    catalogueQ.data ? catalogueQ.data.total : null,
  );

  const text = bookQ.trim();
  const wineReady = ownWine.status === 'ready';
  const visible = useMemo(() => {
    if (scope === 'find') return null;
    const shown = cardsForScope(scope, cards, reason ? null : index);
    if (!shown || scope !== 'all' || text === '') return shown;
    // A vendor's own name, or a wine it sold (any vintage, once answered).
    return shown.filter(
      (c) => vendorNameMatches(c.provider.name, text) || (wineReady && sellers.has(c.provider.id)),
    );
  }, [scope, cards, index, reason, text, wineReady, sellers]);

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
      setCountry: (c: string) => setTypedCountry(c),
      countryBasis: typedCountry !== null ? 'typed' : houseSettled ? derived.basis : 'reading',
      countryWritten: derived.written,
      status: catalogueQ.data ? 'ready' : catalogueQ.isError ? 'error' : 'loading',
      message: catalogueQ.isError ? serverMessage(catalogueQ.error) : null,
      result: catalogueQ.data ?? null,
      wine: askState(catalogueWineOn && settledQ === q.trim(), catalogueWineQ),
    },
    book: { q: bookQ, setQ: setBookQ, wine: ownWine, sellerOf },
    refetchSupply: () => void supplyQ.refetch(),
  };
}
