/**
 * The reads and writes behind /vendor-prices, each keyed by the active house.
 *
 * Every hook here returns a STATED state — `loading` / `unreadable` / `ready`
 * (plus `idle` where a key is needed first) — and a failure that tells a
 * refusal (403) apart from a breakage, because "the register refused this
 * account" and "the register could not be read" are different sentences and
 * neither is an empty list (ADR 0020; page note §12).
 *
 * Keys carry `activeRestaurantId`: `switchRestaurant` re-issues the token
 * without remounting, and a bare key would hand the next house the previous
 * one's ladder from cache (the lesson `IdentityDecisionLog.tsx` recorded).
 *
 * Routes, each cited to the controller that owns it:
 *   GET  /vendor-intel/compare                 vendor-intel.controller.ts:49
 *   GET  /vendor-intel/observations            vendor-intel.controller.ts (vendorBook, 2026-09-11)
 *   POST /vendor-intel/observations            vendor-intel.controller.ts:140
 *   GET  /vendor-intel/below-average           vendor-intel.controller.ts:103
 *   GET  /vendor-intel/identity/status         vendor-intel.controller.ts:364
 *   GET  /vendor-intel/identity/candidates     vendor-intel.controller.ts:460 (staff may)
 *   POST /vendor-intel/identity/candidates/decide  :489 (staff may)
 *   GET  /vendor-intel/identity/decisions      :572 (staff may)
 *   POST /vendor-intel/identity/decisions/undo :533 (owner/manager; refused again in the service)
 *   GET  /wines, GET /wines/:id                wines.controller.ts:38,80
 *   GET  /providers                            providers.controller.ts (the house's vendor book)
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/services/api/client';
import { fetchProviders, type Provider } from '@/services/api/providers';
import type { Wine } from '@/services/api/types';
import { getWineById, searchWines } from '@/services/api/wines';
import { apiErrorMessage, apiErrorStatus, num, retryUnlessClientError } from './vp-format';
import type { RegisterObservation } from './vp-provenance';
import type { CompareResult } from './vp-ladder';

export type Role = 'owner' | 'manager' | 'staff' | null;

export interface FailureVM {
  message: string;
  status: number | null;
  /** 401/403 — the gateway REFUSED, which is a different fact from a breakage. */
  forbidden: boolean;
}

export function failureOf(err: unknown): FailureVM {
  const status = apiErrorStatus(err);
  return {
    message: apiErrorMessage(err),
    status,
    forbidden: status === 401 || status === 403,
  };
}

export type ReadState = 'idle' | 'loading' | 'unreadable' | 'ready';

export interface Read<T> {
  state: ReadState;
  failure: FailureVM | null;
  data: T | null;
  refetch: () => void;
}

function readOf<T>(q: {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
  fetchStatus?: string;
}, enabled: boolean): Read<T> {
  if (!enabled) return { state: 'idle', failure: null, data: null, refetch: () => void q.refetch() };
  if (q.isError) return { state: 'unreadable', failure: failureOf(q.error), data: null, refetch: () => void q.refetch() };
  if (q.data !== undefined) return { state: 'ready', failure: null, data: q.data, refetch: () => void q.refetch() };
  return { state: 'loading', failure: null, data: null, refetch: () => void q.refetch() };
}

/** The signed-in person's role in the active house, as the token states it. */
export function useHouseRole(): { role: Role; restaurantId: string | null; canSeePrices: boolean; canUndo: boolean } {
  const { activeRestaurantId, activeRole, user } = useAuth();
  const role = (activeRole ?? user?.role ?? null) as Role;
  // Owner/manager, exactly the controller's class gate
  // (vendor-intel.controller.ts:38). Hiding is a courtesy; the refusal is
  // the route's. Staff are never sent a request that will 403.
  const canSeePrices = role === 'owner' || role === 'manager';
  return { role, restaurantId: activeRestaurantId ?? null, canSeePrices, canUndo: canSeePrices };
}

/* ── the ladder ───────────────────────────────────────────────────────────── */

function observationOf(r: Record<string, unknown>): RegisterObservation {
  return {
    id: String(r.id ?? ''),
    scope: r.scope === 'market' ? 'market' : 'house',
    providerId: typeof r.providerId === 'string' ? r.providerId : null,
    vendorCatalogueId: typeof r.vendorCatalogueId === 'string' ? r.vendorCatalogueId : null,
    vendorName: typeof r.vendorName === 'string' ? r.vendorName : null,
    productName: typeof r.productName === 'string' ? r.productName : null,
    masterWineId: typeof r.masterWineId === 'string' ? r.masterWineId : null,
    identityId: typeof r.identityId === 'string' ? r.identityId : null,
    sourceType: typeof r.sourceType === 'string' ? r.sourceType : 'unstated',
    trustTier: num(r.trustTier),
    sourceRef: typeof r.sourceRef === 'string' ? r.sourceRef : null,
    sourceUrl: typeof r.sourceUrl === 'string' ? r.sourceUrl : null,
    rawPrice: num(r.rawPrice) ?? Number.NaN,
    currency: typeof r.currency === 'string' && r.currency ? r.currency : 'USD',
    packSize: num(r.packSize) ?? 1,
    unitVolumeMl: num(r.unitVolumeMl),
    observedAt: typeof r.observedAt === 'string' ? r.observedAt : '',
    effectiveDate: typeof r.effectiveDate === 'string' ? r.effectiveDate : null,
    parseConfidence: num(r.parseConfidence),
    isOutlier: r.isOutlier === true,
    outlierReason: typeof r.outlierReason === 'string' ? r.outlierReason : null,
    outlierBasis: typeof r.outlierBasis === 'string' ? r.outlierBasis : null,
    outlierJudgedAt: typeof r.outlierJudgedAt === 'string' ? r.outlierJudgedAt : null,
    raw: r.raw && typeof r.raw === 'object' ? (r.raw as Record<string, unknown>) : {},
  };
}

function compareOf(d: Record<string, unknown>): CompareResult {
  const c = (d.consensus ?? {}) as Record<string, unknown>;
  return {
    productName: typeof d.productName === 'string' ? d.productName : null,
    consensus: {
      consensusPrice: num(c.consensusPrice),
      bestPrice: num(c.bestPrice),
      bestVendorId: typeof c.bestVendorId === 'string' ? c.bestVendorId : null,
      bestVendorName: typeof c.bestVendorName === 'string' ? c.bestVendorName : null,
      observationCount: num(c.observationCount) ?? 0,
      admittedCount: num(c.admittedCount) ?? 0,
      outlierCount: num(c.outlierCount) ?? 0,
      sourceBreakdown: (c.sourceBreakdown ?? {}) as Record<string, number>,
      ladder: Array.isArray(c.ladder)
        ? (c.ladder as Array<Record<string, unknown>>).map((q) => ({
            id: typeof q.id === 'string' ? q.id : null,
            vendorId: typeof q.vendorId === 'string' ? q.vendorId : null,
            vendorName: typeof q.vendorName === 'string' ? q.vendorName : null,
            unitPrice: num(q.unitPrice) ?? Number.NaN,
            sourceType: typeof q.sourceType === 'string' ? q.sourceType : 'unstated',
            ageDays: num(q.ageDays) ?? Number.NaN,
            isOutlier: q.isOutlier === true,
          }))
        : [],
      confidence: num(c.confidence) ?? 0,
      notes: Array.isArray(c.notes) ? (c.notes as unknown[]).filter((n): n is string => typeof n === 'string') : [],
    },
    trends: Array.isArray(d.trends)
      ? (d.trends as Array<Record<string, unknown>>).map((t) => ({
          windowDays: num(t.windowDays) ?? 0,
          current: num(t.current),
          previous: num(t.previous),
          absoluteChange: num(t.absoluteChange),
          pctChange: num(t.pctChange),
          note: typeof t.note === 'string' ? t.note : '',
        }))
      : [],
    observations: Array.isArray(d.observations)
      ? (d.observations as Array<Record<string, unknown>>).map(observationOf)
      : [],
  };
}

export function useLadder(masterWineId: string | null, enabled: boolean): Read<CompareResult> {
  const { restaurantId } = useHouseRole();
  const on = enabled && !!masterWineId && !!restaurantId;
  const q = useQuery({
    queryKey: ['vp-ladder', restaurantId, masterWineId],
    enabled: on,
    retry: retryUnlessClientError,
    queryFn: async () => {
      const res = await apiClient.get('/vendor-intel/compare', { params: { masterWineId } });
      return compareOf((res.data ?? {}) as Record<string, unknown>);
    },
  });
  return readOf(q, on);
}

/* ── the vendor's book ────────────────────────────────────────────────────── */

export interface VendorBookVM {
  vendor: { providerId: string | null; vendorName: string | null };
  items: RegisterObservation[];
  count: number;
  limit: number;
  complete: boolean;
  scope: string;
}

export function useVendorBook(
  providerId: string | null,
  vendorName: string | null,
  enabled: boolean,
): Read<VendorBookVM> {
  const { restaurantId } = useHouseRole();
  const on = enabled && (!!providerId || !!vendorName) && !!restaurantId;
  const q = useQuery({
    queryKey: ['vp-book', restaurantId, providerId, vendorName],
    enabled: on,
    retry: retryUnlessClientError,
    queryFn: async () => {
      const res = await apiClient.get('/vendor-intel/observations', {
        params: providerId ? { providerId, limit: 200 } : { vendorName, limit: 200 },
      });
      const d = (res.data ?? {}) as Record<string, unknown>;
      const vendor = (d.vendor ?? {}) as Record<string, unknown>;
      const items = Array.isArray(d.items) ? (d.items as Array<Record<string, unknown>>).map(observationOf) : [];
      return {
        vendor: {
          providerId: typeof vendor.providerId === 'string' ? vendor.providerId : null,
          vendorName: typeof vendor.vendorName === 'string' ? vendor.vendorName : null,
        },
        items,
        count: num(d.count) ?? items.length,
        limit: num(d.limit) ?? 200,
        // Absent is NOT complete: if the gateway did not say, the count is a floor.
        complete: d.complete === true,
        scope: typeof d.scope === 'string' ? d.scope : '',
      } satisfies VendorBookVM;
    },
  });
  return readOf(q, on);
}

/* ── the market box ───────────────────────────────────────────────────────── */

export interface MarketItem {
  productKey: string;
  sourceClass: string;
  productName: string | null;
  currency: string;
  latestPrice: number | null;
  latestAt: string | null;
  latestVendor: string | null;
  latestSource: string | null;
  averagePrice: number | null;
  averageOf: number | null;
  fractionBelow: number | null;
}

export interface MarketVM {
  items: MarketItem[];
  publicSiteItems: MarketItem[];
  scannedObservations: number | null;
  scannedProducts: number | null;
  skippedThin: number | null;
  skippedNotBelow: number | null;
  skippedMixedCurrency: number | null;
  skippedUnrecognisedClass: number | null;
  windowDays: number | null;
  minObservations: number | null;
}

function marketItemOf(raw: Record<string, unknown>): MarketItem {
  const latest = (raw.latest ?? {}) as Record<string, unknown>;
  const average = (raw.average ?? {}) as Record<string, unknown>;
  return {
    productKey: String(raw.productKey ?? ''),
    sourceClass: typeof raw.sourceClass === 'string' ? raw.sourceClass : 'quoted',
    productName: typeof raw.productName === 'string' ? raw.productName : null,
    currency: typeof raw.currency === 'string' ? raw.currency : 'USD',
    latestPrice: num(latest.unitPrice),
    latestAt: typeof latest.observedAt === 'string' ? latest.observedAt : null,
    latestVendor: typeof latest.vendorName === 'string' ? latest.vendorName : null,
    latestSource: typeof latest.sourceType === 'string' ? latest.sourceType : null,
    averagePrice: num(average.unitPrice),
    averageOf: num(average.observations),
    fractionBelow: num(raw.fractionBelow),
  };
}

export const MARKET_WINDOW_DAYS = 30;

export function useMarketBox(enabled: boolean): Read<MarketVM> {
  const { restaurantId } = useHouseRole();
  const on = enabled && !!restaurantId;
  const q = useQuery({
    queryKey: ['vp-market', restaurantId],
    enabled: on,
    retry: retryUnlessClientError,
    queryFn: async () => {
      const res = await apiClient.get('/vendor-intel/below-average', { params: { windowDays: MARKET_WINDOW_DAYS } });
      const d = (res.data ?? {}) as Record<string, unknown>;
      const scanned = (d.scanned ?? {}) as Record<string, unknown>;
      const skipped = (d.skipped ?? {}) as Record<string, unknown>;
      const window_ = (d.window ?? {}) as Record<string, unknown>;
      return {
        items: Array.isArray(d.items) ? (d.items as Array<Record<string, unknown>>).map(marketItemOf) : [],
        publicSiteItems: Array.isArray(d.publicSiteItems)
          ? (d.publicSiteItems as Array<Record<string, unknown>>).map(marketItemOf)
          : [],
        scannedObservations: num(scanned.observations),
        scannedProducts: num(scanned.products),
        skippedThin: num(skipped.thinHistory),
        skippedNotBelow: num(skipped.notBelow),
        skippedMixedCurrency: num(skipped.mixedCurrency),
        skippedUnrecognisedClass: num(skipped.unrecognisedClass),
        windowDays: num(window_.days),
        minObservations: num(d.minObservations),
      } satisfies MarketVM;
    },
  });
  return readOf(q, on);
}

/* ── the identity registers ───────────────────────────────────────────────── */

export interface CandidateVM {
  id: string;
  subjectTable: string;
  subjectId: string;
  restaurantId: string | null;
  identityId: string;
  method: string;
  confidence: number | null;
  evidence: Record<string, unknown>;
  createdAt: string;
  identity:
    | { unread: false; displayLabel: string | null; standing: string | null }
    | { unread: true; reason: string };
}

export interface QueueVM {
  items: CandidateVM[];
  limit: number;
  complete: boolean;
}

export function useIdentityQueue(): Read<QueueVM> {
  const { restaurantId } = useHouseRole();
  const on = !!restaurantId;
  const q = useQuery({
    queryKey: ['vp-identity-queue', restaurantId],
    enabled: on,
    retry: retryUnlessClientError,
    queryFn: async () => {
      const res = await apiClient.get('/vendor-intel/identity/candidates', { params: { limit: 50 } });
      const d = (res.data ?? {}) as Record<string, unknown>;
      const items = Array.isArray(d.items)
        ? (d.items as Array<Record<string, unknown>>).map((r): CandidateVM => {
            const ident = (r.identity ?? null) as Record<string, unknown> | null;
            return {
              id: String(r.id ?? ''),
              subjectTable: typeof r.subject_table === 'string' ? r.subject_table : 'unstated',
              subjectId: typeof r.subject_id === 'string' ? r.subject_id : '',
              restaurantId: typeof r.restaurant_id === 'string' ? r.restaurant_id : null,
              identityId: typeof r.identity_id === 'string' ? r.identity_id : '',
              method: typeof r.method === 'string' ? r.method : 'unstated',
              confidence: num(r.confidence),
              evidence: r.evidence && typeof r.evidence === 'object' ? (r.evidence as Record<string, unknown>) : {},
              createdAt: typeof r.created_at === 'string' ? r.created_at : '',
              identity:
                ident && ident.unread === false
                  ? {
                      unread: false,
                      displayLabel: typeof ident.display_label === 'string' ? ident.display_label : null,
                      standing: typeof ident.standing === 'string' ? ident.standing : null,
                    }
                  : {
                      unread: true,
                      reason:
                        ident && typeof ident.reason === 'string'
                          ? ident.reason
                          : 'the gateway did not say which bottle this proposes',
                    },
            };
          })
        : [];
      return { items, limit: num(d.limit) ?? 50, complete: d.complete === true } satisfies QueueVM;
    },
  });
  return readOf(q, on);
}

export interface DecisionVM {
  id: string;
  candidateId: string;
  action: 'confirmed' | 'rejected' | 'undone' | string;
  decidedByLabel: string;
  decidedByRole: string;
  decidedAt: string;
  evidenceShown: Record<string, unknown>;
  note: string | null;
  linkWritten: string | null;
  undoesDecisionId: string | null;
}

export interface LogVM {
  items: DecisionVM[];
  scope: string;
  limit: number;
  complete: boolean;
}

export function useIdentityLog(): Read<LogVM> {
  const { restaurantId } = useHouseRole();
  const on = !!restaurantId;
  const q = useQuery({
    queryKey: ['vp-identity-log', restaurantId],
    enabled: on,
    retry: retryUnlessClientError,
    queryFn: async () => {
      const res = await apiClient.get('/vendor-intel/identity/decisions', { params: { limit: 50 } });
      const d = (res.data ?? {}) as Record<string, unknown>;
      const items = Array.isArray(d.items)
        ? (d.items as Array<Record<string, unknown>>).map(
            (r): DecisionVM => ({
              id: String(r.id ?? ''),
              candidateId: String(r.candidate_id ?? ''),
              action: typeof r.action === 'string' ? r.action : 'unstated',
              decidedByLabel: typeof r.decided_by_label === 'string' ? r.decided_by_label : 'name not kept',
              decidedByRole: typeof r.decided_by_role === 'string' ? r.decided_by_role : 'unstated',
              decidedAt: typeof r.decided_at === 'string' ? r.decided_at : '',
              evidenceShown:
                r.evidence_shown && typeof r.evidence_shown === 'object'
                  ? (r.evidence_shown as Record<string, unknown>)
                  : {},
              note: typeof r.note === 'string' ? r.note : null,
              linkWritten: typeof r.link_written === 'string' ? r.link_written : null,
              undoesDecisionId: typeof r.undoes_decision_id === 'string' ? r.undoes_decision_id : null,
            }),
          )
        : [];
      return {
        items,
        scope: typeof d.scope === 'string' ? d.scope : '',
        limit: num(d.limit) ?? 50,
        complete: d.complete === true,
      } satisfies LogVM;
    },
  });
  return readOf(q, on);
}

export interface IdentityStatusVM {
  identities: number | null;
  keys: number | null;
  candidates: { pending: number; confirmed: number; rejected: number } | null;
  linkedObservations: number | null;
  notes: string[];
}

export function useIdentityStatus(enabled: boolean): Read<IdentityStatusVM> {
  const { restaurantId } = useHouseRole();
  const on = enabled && !!restaurantId;
  const q = useQuery({
    queryKey: ['vp-identity-status', restaurantId],
    enabled: on,
    retry: retryUnlessClientError,
    queryFn: async () => {
      const res = await apiClient.get('/vendor-intel/identity/status');
      const d = (res.data ?? {}) as Record<string, unknown>;
      const c = (d.candidates ?? null) as Record<string, unknown> | null;
      const linked = (d.linked ?? {}) as Record<string, unknown>;
      return {
        identities: num(d.identities),
        keys: num(d.keys),
        candidates: c
          ? { pending: num(c.pending) ?? 0, confirmed: num(c.confirmed) ?? 0, rejected: num(c.rejected) ?? 0 }
          : null,
        linkedObservations: num(linked.vendor_price_observations),
        notes: Array.isArray(d.notes) ? (d.notes as unknown[]).filter((n): n is string => typeof n === 'string') : [],
      } satisfies IdentityStatusVM;
    },
  });
  return readOf(q, on);
}

/* ── the picker and the vendor list ───────────────────────────────────────── */

export function useWineSearch(term: string): Read<Wine[]> {
  const on = term.trim().length >= 2;
  const q = useQuery({
    queryKey: ['vp-wine-search', term.trim()],
    enabled: on,
    staleTime: 60_000,
    retry: retryUnlessClientError,
    queryFn: () => searchWines({ search: term.trim(), limit: 8 }),
  });
  return readOf(q, on);
}

export function useWine(masterWineId: string | null): Read<Wine | null> {
  const on = !!masterWineId;
  const q = useQuery({
    queryKey: ['vp-wine', masterWineId],
    enabled: on,
    staleTime: 5 * 60_000,
    retry: retryUnlessClientError,
    queryFn: () => getWineById(masterWineId as string),
  });
  return readOf(q, on);
}

export function useHouseProviders(enabled: boolean): Read<Provider[]> {
  const { restaurantId } = useHouseRole();
  const on = enabled && !!restaurantId;
  const q = useQuery({
    queryKey: ['vp-providers', restaurantId],
    enabled: on,
    staleTime: 5 * 60_000,
    retry: retryUnlessClientError,
    queryFn: () => fetchProviders(restaurantId as string),
  });
  return readOf(q, on);
}

/* ── the writes ───────────────────────────────────────────────────────────── */

export interface RecordPriceInput {
  masterWineId: string;
  productName?: string;
  producer?: string;
  vintage?: number;
  providerId?: string;
  vendorName?: string;
  price: number;
  currency: string;
  packSize: number;
  unitVolumeMl?: number;
  sourceType: 'quote' | 'chat' | 'social' | 'manual';
  sourceUrl?: string;
  observedAt?: string;
  note?: string;
}

export interface RecordPriceResult {
  id: string;
  observedAt: string;
  isOutlier: boolean;
  outlierReason: string;
}

/** The record. No wax: a sighting is a fact written down, not a commitment. */
export function useRecordPrice(masterWineId: string | null) {
  const { restaurantId } = useHouseRole();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecordPriceInput): Promise<RecordPriceResult> => {
      const res = await apiClient.post('/vendor-intel/observations', input);
      const o = ((res.data ?? {}) as { observation?: Record<string, unknown> }).observation ?? {};
      return {
        id: String(o.id ?? ''),
        observedAt: typeof o.observedAt === 'string' ? o.observedAt : '',
        isOutlier: o.isOutlier === true,
        outlierReason: typeof o.outlierReason === 'string' ? o.outlierReason : 'The gateway did not say whether the row was judged.',
      };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vp-ladder', restaurantId, masterWineId] });
      void qc.invalidateQueries({ queryKey: ['vp-book', restaurantId] });
      void qc.invalidateQueries({ queryKey: ['vp-market', restaurantId] });
    },
  });
}

export interface DecideInput {
  candidateId: string;
  decision: 'confirmed' | 'rejected';
  note?: string;
}

export function useDecideCandidate() {
  const { restaurantId } = useHouseRole();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DecideInput) => {
      const res = await apiClient.post('/vendor-intel/identity/candidates/decide', input);
      return (res.data ?? {}) as { status?: string; linkWritten?: string | null; decisionId?: string };
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['vp-identity-queue', restaurantId] });
      void qc.invalidateQueries({ queryKey: ['vp-identity-log', restaurantId] });
      void qc.invalidateQueries({ queryKey: ['vp-identity-status', restaurantId] });
    },
  });
}

export function useUndoDecision() {
  const { restaurantId } = useHouseRole();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { decisionId: string; note?: string }) => {
      const res = await apiClient.post('/vendor-intel/identity/decisions/undo', input);
      return (res.data ?? {}) as { decisionId?: string; undid?: string; linkCleared?: string | null };
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['vp-identity-queue', restaurantId] });
      void qc.invalidateQueries({ queryKey: ['vp-identity-log', restaurantId] });
      void qc.invalidateQueries({ queryKey: ['vp-identity-status', restaurantId] });
    },
  });
}
