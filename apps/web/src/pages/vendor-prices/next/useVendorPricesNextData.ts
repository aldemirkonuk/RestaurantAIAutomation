/**
 * VendorPricesNext data — live data through the real endpoints only.
 *
 * The founder's rule for this page (ADR 0160 §112, fork 6, answered
 * 2026-09-18 via AskUserQuestion — "Always on the record, loaded fresh"):
 * the paper trail is shown on every price record without extra clicks, and
 * read fresh each time the record opens, never served from a cache.
 * Concretely: `useCompare` runs as soon as a wine is picked (the ladder and
 * its trail ARE the record) with `gcTime: 0` / `staleTime: 0`, so reopening
 * a record re-reads it instead of painting the previous copy first.
 * `useSightingIdentity` — a sighting's identity decisions and pending
 * candidate, which are not the trail — still only runs once a sheet is open
 * for a row that names an identity, also with `gcTime: 0` / `staleTime: 0`
 * (review finding, 2026-09-18: reopening showed a stale decision within 20ms
 * of closing).
 *
 * Every query key here carries `activeRestaurantId`. Switching the active
 * house re-issues the token without remounting this page
 * (`AuthContext.setActiveRestaurantId`), and a key that omits the house would
 * serve the PREVIOUS house's ladder — its own quotes and receipts — from
 * cache until the refetch landed. `IdentityDecisionLog.tsx` keys on it for
 * exactly this reason.
 */

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../../contexts/AuthContext'
import { searchWines, getWineById } from '../../../services/api/wines'
import type { Wine } from '../../../services/api/types'
import {
  compareVendorPrices,
  decideIdentityCandidate,
  fetchBelowAverage,
  fetchIdentityCandidates,
  fetchIdentityDecisions,
  fetchIdentityStatus,
  fetchPriceIndexStatus,
  fetchObservationSources,
  fetchProviderUsualCurrency,
  fetchShopSweepStatus,
  fetchSiteSweepStatus,
  recordVendorPrice,
  retryUnlessClientError,
  undoIdentityDecision,
  type ManualObservationInput,
  type VendorCompareResponse,
} from '../../../services/api/vendorIntel'

/** Which key names the bottle, and its raw value — `identityHash`/`signature`
 * are ADR 0124's fallback chain (`0124:212-217`): identity first, then a
 * library wine, then a bare name+vintage signature. */
export type ProductRef =
  | { kind: 'wine'; id: string }
  | { kind: 'signature'; id: string }
  | { kind: 'identity'; id: string }

/**
 * `price-below-average.ts#GroupingKey` prefixes a product key with which of
 * the three it is (`identity:<uuid>`, `wine:<masterWineId>`,
 * `sig:<signatureHash>`) — the SAME convention `market-price.producer.ts:209`
 * uses to build `/vendor-prices?product=<productKey>`. An unprefixed value is
 * read as a wine id, matching every link this page has ever accepted.
 */
function parseProductKey(raw: string): ProductRef {
  const m = /^(identity|wine|sig):(.+)$/.exec(raw)
  if (!m) return { kind: 'wine', id: raw }
  const id = m[2]
  if (m[1] === 'sig') return { kind: 'signature', id }
  if (m[1] === 'identity') return { kind: 'identity', id }
  return { kind: 'wine', id }
}

/**
 * The bottle named in the URL, however it got there: `?wine=` (this page's
 * own convention), `?masterWineId=` (the legacy page's — `VendorPriceCompare.tsx:393`,
 * kept so an old bookmark still lands on the right bottle), or
 * `?product=<productKey>` (the market-price notification —
 * `market-price.producer.ts:209`, which this page did not honour until this
 * pass: T15, "a link to nothing").
 */
export function useSelectedProduct(): [ProductRef | null, (wineId: string | null) => void] {
  const [params, setParams] = useSearchParams()
  const wine = params.get('wine') ?? params.get('masterWineId')
  const product = params.get('product')
  const ref: ProductRef | null = wine ? { kind: 'wine', id: wine } : product ? parseProductKey(product) : null

  const setWineId = (id: string | null) => {
    const next = new URLSearchParams(params)
    next.delete('masterWineId')
    next.delete('product')
    if (id) next.set('wine', id)
    else next.delete('wine')
    setParams(next, { replace: true })
  }
  return [ref, setWineId]
}

/** The picked wine's own record, so the header can name it even when the
 * page was reached by a direct link rather than a fresh search. Only fires
 * for a `wine` ref — a signature or identity ref names no library row. */
export function useSelectedWine(ref: ProductRef | null) {
  const wineId = ref?.kind === 'wine' ? ref.id : null
  return useQuery({
    queryKey: ['vendor-prices-wine', wineId],
    queryFn: () => getWineById(wineId as string),
    enabled: !!wineId,
    staleTime: 5 * 60_000,
  })
}

/** The wine picker. Enabled only past two characters — a one-letter query
 * against a 14,000-row library is a table scan the person did not ask for. */
export function useWineSearch(query: string) {
  const trimmed = query.trim()
  const q = useQuery({
    queryKey: ['vendor-prices-wine-search', trimmed],
    queryFn: () => searchWines({ search: trimmed, limit: 20 }),
    enabled: trimmed.length >= 2,
    retry: retryUnlessClientError,
  })
  return {
    results: (q.data ?? []) as Wine[],
    isLoading: q.isFetching,
    isError: q.isError,
  }
}

/** The ladder itself, and the paper trail drawn from the same read. A
 * failed read is an error, never an empty comparison — `retry` skips a 4xx
 * (a bad id will say the same thing again) but a 5xx or a dropped connection
 * gets one retry before the page says so. Keyed by the active house so a
 * switch never serves the previous house's ladder from cache, and never
 * cached at all (`gcTime: 0`, `staleTime: 0`): fork 6, "loaded fresh". */
export function useCompare(ref: ProductRef | null) {
  const { activeRestaurantId } = useAuth()
  const enabled = !!ref && ref.kind !== 'identity'
  return useQuery<VendorCompareResponse>({
    queryKey: ['vendor-prices-compare', activeRestaurantId, ref?.kind, ref?.id],
    queryFn: () =>
      compareVendorPrices(
        ref?.kind === 'signature' ? { signatureHash: ref.id } : { masterWineId: (ref as { id: string }).id },
      ),
    enabled,
    gcTime: 0,
    staleTime: 0,
    retry: retryUnlessClientError,
  })
}

/** Recording a price. Invalidates the ladder for this wine on success — a
 * draft is not sent, so nothing here claims success before the gateway has
 * answered. */
export function useRecordPrice(ref: ProductRef | null) {
  const qc = useQueryClient()
  const { activeRestaurantId } = useAuth()
  return useMutation({
    mutationFn: (input: ManualObservationInput) => recordVendorPrice(input),
    onSuccess: () => {
      if (ref) qc.invalidateQueries({ queryKey: ['vendor-prices-compare', activeRestaurantId, ref.kind, ref.id] })
    },
  })
}

/**
 * Fork 6(a): what "Record a price" may name as where a price came from — this
 * house's recent messages with the matched vendor and that vendor's contacts.
 * Enabled only once a vendor is resolved to one of this house's rows, and
 * never cached (`gcTime: 0`, `staleTime: 0`): a message that arrived a minute
 * ago must be pickable, and a contact removed a minute ago must not be.
 */
export function useObservationSources(providerId: string | null) {
  const { activeRestaurantId } = useAuth()
  return useQuery({
    queryKey: ['vendor-prices-observation-sources', activeRestaurantId, providerId],
    queryFn: () => fetchObservationSources(providerId as string),
    enabled: !!providerId,
    retry: retryUnlessClientError,
    gcTime: 0,
    staleTime: 0,
  })
}

/**
 * The picked provider's stated usual currency, if any — fork 2(c) (ADR
 * 0160 §112). `enabled` only once a provider is actually resolved from the
 * typed vendor name, so a free-typed vendor with no matching provider row
 * never fires a request that can only 404. `staleTime` is generous: a
 * vendor's usual currency changes rarely, and this is only ever an offered
 * DEFAULT, never silently re-applied over what a person already typed.
 */
export function useProviderUsualCurrency(providerId: string | null) {
  return useQuery({
    queryKey: ['vendor-prices-provider-usual-currency', providerId],
    queryFn: () => fetchProviderUsualCurrency(providerId as string),
    enabled: !!providerId,
    retry: retryUnlessClientError,
    staleTime: 5 * 60_000,
  })
}

/**
 * The sighting sheet's identity panel — decisions on this bottle plus its
 * pending candidate, if any. `enabled` is the sheet's own open state ANDed
 * with the row actually naming an identity, so nothing fetches while the
 * sheet is closed and an unidentified row never fires a request that can
 * only come back empty.
 *
 * `gcTime: 0, staleTime: 0` on both: the founder, on this exact panel —
 * "do not add this to the cache." Reopening the sheet always reads fresh,
 * never a decision that is 20ms old and already stale. `retryUnlessClientError`
 * replaces the default 3 retries, which turned a real failure into an 8-second
 * "Reading the log…" before the page said anything was wrong.
 */
export function useSightingIdentity(identityId: string | null, enabled: boolean) {
  const { activeRestaurantId } = useAuth()
  const active = enabled && !!identityId
  const decisions = useQuery({
    queryKey: ['vendor-prices-identity-decisions', activeRestaurantId, identityId],
    queryFn: () => fetchIdentityDecisions(50, identityId as string),
    enabled: active,
    gcTime: 0,
    staleTime: 0,
    retry: retryUnlessClientError,
  })
  const candidates = useQuery({
    queryKey: ['vendor-prices-identity-candidates', activeRestaurantId, identityId],
    queryFn: () => fetchIdentityCandidates({ identityId: identityId as string, limit: 10 }),
    enabled: active,
    gcTime: 0,
    staleTime: 0,
    retry: retryUnlessClientError,
  })
  return { decisions, candidates }
}

/** Staff may confirm or reject; a manager's undo lives in this same sheet now
 * (ADR 0149 row 17) as well as on the house-wide log (`IdentityDecisionLog.tsx`).
 * Confirming a candidate changes what a row's identity IS, so the ladder's
 * own compare read is invalidated too — otherwise the row a person just
 * confirmed keeps showing yesterday's identity until the next unrelated
 * refetch (review finding, minor: "a successful Confirm does not invalidate
 * compare"). */
export function useDecideCandidate(identityId: string | null, ref: ProductRef | null) {
  const qc = useQueryClient()
  const { activeRestaurantId } = useAuth()
  return useMutation({
    mutationFn: (input: { candidateId: string; decision: 'confirmed' | 'rejected'; note?: string }) =>
      decideIdentityCandidate(input),
    onSuccess: () => {
      if (identityId) {
        qc.invalidateQueries({ queryKey: ['vendor-prices-identity-decisions', activeRestaurantId, identityId] })
        qc.invalidateQueries({ queryKey: ['vendor-prices-identity-candidates', activeRestaurantId, identityId] })
      }
      if (ref) qc.invalidateQueries({ queryKey: ['vendor-prices-compare', activeRestaurantId, ref.kind, ref.id] })
    },
  })
}

/** A manager takes a decision back, from inside the sighting sheet (ADR 0149
 * row 17): offered only when `undoRefusal` is null, so a call here should
 * always be this house's own decision — the gateway is still the actual
 * gate. */
export function useUndoDecision(identityId: string | null) {
  const qc = useQueryClient()
  const { activeRestaurantId } = useAuth()
  return useMutation({
    mutationFn: (input: { decisionId: string; note?: string }) => undoIdentityDecision(input),
    onSuccess: () => {
      if (identityId) {
        qc.invalidateQueries({ queryKey: ['vendor-prices-identity-decisions', activeRestaurantId, identityId] })
      }
    },
  })
}

/**
 * The masthead standing line — built from the same endpoints the identity
 * drawer and the sweep pages already read (ADR 0160 §112 review, major:
 * "the page before a bottle is picked is nearly empty… build both from the
 * existing endpoints"). `owner` is checked by the CALLER, not enabled here,
 * because `site-sweep/status` and `shop-sweep/status` are owner-only
 * (E8) — a manager session must never fire those two at all, not merely
 * hide their result.
 */
export function useMastheadStatus(role: 'owner' | 'manager' | 'staff' | null) {
  const { activeRestaurantId } = useAuth()
  // `identity/status` and `price-index/status` are platform-wide reads (no
  // `@CurrentUser` in either handler) — no house belongs in their keys.
  const identity = useQuery({
    queryKey: ['vendor-prices-masthead-identity'],
    queryFn: fetchIdentityStatus,
    enabled: role === 'owner' || role === 'manager',
    retry: retryUnlessClientError,
    staleTime: 60_000,
  })
  const priceIndex = useQuery({
    queryKey: ['vendor-prices-masthead-price-index'],
    queryFn: fetchPriceIndexStatus,
    enabled: role === 'owner' || role === 'manager',
    retry: retryUnlessClientError,
    staleTime: 60_000,
  })
  // `site-sweep/status` IS per-house (`siteSweepStatus(user.restaurantId)`) —
  // its key carries the active house so a switch never serves the previous
  // house's vendor rows from cache (the same rule `useCompare` follows).
  const siteSweep = useQuery({
    queryKey: ['vendor-prices-masthead-site-sweep', activeRestaurantId],
    queryFn: fetchSiteSweepStatus,
    enabled: role === 'owner',
    retry: retryUnlessClientError,
    staleTime: 60_000,
  })
  // `shop-sweep/status` is per-JURISDICTION, not per-house (no house owns
  // `price_index_postings`) — no house belongs in its key either.
  const shopSweep = useQuery({
    queryKey: ['vendor-prices-masthead-shop-sweep'],
    queryFn: fetchShopSweepStatus,
    enabled: role === 'owner',
    retry: retryUnlessClientError,
    staleTime: 60_000,
  })
  return { identity, priceIndex, siteSweep, shopSweep }
}

/** "Newest below the earlier mean" — the cross-product box named but not
 * built in the first pass. Owner/manager only, matching `belowAverage`'s own
 * guard; a staff session never mounts the empty-picker state that calls it
 * (the whole page is a 403 for staff). */
export function useBelowAverage(role: 'owner' | 'manager' | 'staff' | null) {
  const { activeRestaurantId } = useAuth()
  return useQuery({
    queryKey: ['vendor-prices-below-average', activeRestaurantId],
    queryFn: () => fetchBelowAverage({}),
    enabled: role === 'owner' || role === 'manager',
    retry: retryUnlessClientError,
    staleTime: 60_000,
  })
}

/**
 * The house-wide "waiting for a person" queue — staff-readable (identity is
 * not a price), used on the staff 403 branch so staff keep the queue the
 * legacy page rendered for them "outside its data branch"
 * (`VendorPriceCompare.tsx:593-600`, review finding).
 */
export function useHouseIdentityCandidates() {
  const { activeRestaurantId } = useAuth()
  return useQuery({
    queryKey: ['vendor-prices-house-candidates', activeRestaurantId],
    queryFn: () => fetchIdentityCandidates({ limit: 20 }),
    retry: retryUnlessClientError,
  })
}

/** A small debounce for the search box, so every keystroke does not fire a
 * request — 250ms, short enough to feel live. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}
