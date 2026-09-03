/**
 * ReceivingNext view models — live data only, through the EXISTING services
 * (`services/api/receiving.ts`, `services/api/credits.ts`, the procurement
 * orders endpoint the legacy page proved out, and `lib/doorOutbox.ts`).
 * Nothing here invents a number.
 *
 * Honesty contract (same as useOrdersNextData): unknowns are null and render
 * as em dashes downstream. A failed queue fetch is not an empty queue; a
 * missing claim amount is not $0.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/services/api/client';
import { creditsApi, type ProcurementCredit, type CreditStats } from '@/services/api/credits';
import type { UnverifiedDelivery } from '@/services/api/receiving';
import { flushDoorOutbox, type QueuedDoorReceipt } from '@/lib/doorOutbox';
import { offlineStorage, type PendingMutation } from '@/lib/offline-storage';
import { num } from './rc-format';

/* ─────────────────────────────────────────── the shape of a failure ─────── */

/**
 * "Not permitted" and "the server broke" are different facts and a page that
 * renders them identically teaches the reader to distrust both. Axios carries
 * the status on `response.status`; nothing else on this page reads it.
 */
export interface FailureVM {
  status: number | null;
  message: string;
  /** 403/401 — the request was understood and refused. Retrying changes nothing. */
  forbidden: boolean;
}

export function failureOf(isError: boolean, error: unknown): FailureVM | null {
  if (!isError) return null;
  const status =
    num((error as { response?: { status?: unknown } } | null)?.response?.status) ?? null;
  const message = (error as { message?: string } | null)?.message ?? 'request failed';
  return { status, message, forbidden: status === 403 || status === 401 };
}

/* ───────────────────────────────────── the windows the server imposes ───── */

/**
 * Every cap this page's figures are computed behind, cited to the query that
 * imposes it. ADR 0051 clause 2 turns each of these into a `≥`.
 *
 * A cap is only observable from the client when the payload's own length can
 * reach it — so `QUEUE_ITEMS` and `UNVERIFIED` produce a floor exactly when the
 * list came back full. `LINKED_CREDITS` and `RECOVERY_STATS` are aggregates
 * computed server-side behind the cap, so their fullness is NOT observable
 * here and their figures are floors unconditionally.
 */
export const SERVER_WINDOWS = {
  /** receiving.service.ts:375 — the queue's own rows. */
  QUEUE_ITEMS: 100,
  /** receiving.service.ts:271 — the receipt events the uncounted list is built from. */
  UNVERIFIED: 500,
  /** receiving.service.ts:384 — credits linked to queue rows. No `.order()`. */
  LINKED_CREDITS: 200,
  /** credits.controller.ts:137 — every figure on the owner ledger. No `.order()`. */
  RECOVERY_STATS: 5000,
  /** credits.controller.ts:113 — `/credits` list, oldest-first. */
  CREDITS_LIST: 200,
} as const;

/* ───────────────────────────────────────────────── staff: in-flight orders ── */

/**
 * "Placed with the vendor, not yet received" — the pair the legacy page
 * established the hard way (ReceivingHome.tsx:75-105): `SENT` is a
 * conversation status and asking for it 400s; `APPROVED` cannot be at the
 * door; `PARTIALLY_RECEIVED` is what the door flow writes on success.
 */
const IN_FLIGHT_STATUSES = ['CONFIRMED', 'IN_TRANSIT'] as const;

/** One row of `GET /procurement/orders` (OrderListResponseDto → orders[]). */
interface OpenOrderDto {
  id: string;
  orderNumber?: string | null;
  /** DENOMINATED IN `unitType`. Five on a case order is five CASES. */
  quantity?: number | null;
  /** `procurement_orders.unit_type` — bottle|case|keg|pack|split_case|each|liter. */
  unitType?: string | null;
  /** The bottle-denominated total the server already computed (ADR 0054). */
  bottlesTotal?: number | null;
  wineName?: string | null;
  requestedAt?: string | null;
  providerId?: string | null;
  /**
   * Not in OrderResponseDto today — `mapOrderRow` emits `providerId` only
   * (procurement.service.ts:1911). Read defensively, under both spellings the
   * gateway might land on, so the door sees the distributor's name the moment
   * one of them is emitted. See the TODO on `vendorOf` below.
   */
  providerName?: string | null;
  provider?: { name?: string | null } | null;
}

/**
 * TODO(gateway, blocked): `mapOrderRow` in
 * `apps/api-gateway/src/procurement/procurement.service.ts:1906-1928` maps
 * `providerId` and never a provider NAME, so `vendor` is null on every row in
 * production and the receiver at the door cannot see which distributor is
 * standing in front of them. The fix is one join + one mapped field in that
 * service; it is deliberately not made here because three unmerged branches
 * own that file. This function is written so the page works the instant the
 * field lands, under either spelling.
 */
function vendorOf(o: OpenOrderDto): string | null {
  const name = o.providerName ?? o.provider?.name ?? null;
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed === '' ? null : trimmed;
}

export interface DeliveryVM {
  id: string;
  /** The distributor. Null means NOT KNOWN, and the card must say so. */
  vendor: string | null;
  /** Last resort for telling two unnamed trucks apart. */
  providerRef: string | null;
  /** The single line this order carries (one wine per procurement order). */
  line: string | null;
  po: string | null;
  /**
   * OrderResponseDto is one wine per order, so a delivery is exactly one
   * line by construction — this is a fact of the DTO, not a guess.
   */
  lineCount: 1;
  /**
   * What the door will count, in BOTTLES. Taken from the server's own
   * `bottlesTotal` (ADR 0054's arithmetic) and never re-derived: the pack size
   * is not in this payload, so a client-side `quantity × n` would be an
   * invention. Null when the server did not compute it.
   */
  bottlesTotal: number | null;
  /** What was ordered, in the unit it was ordered in. Never bottles unless it is. */
  orderedQty: number | null;
  unitType: string | null;
  requestedAt: string | null;
}

export interface StaffLaneData {
  deliveries: DeliveryVM[];
  /**
   * The gateway's own `total` — an exact PostgREST count, not a page length
   * (procurement.service.ts:853). Null until every request has answered.
   */
  totalOutForDelivery: number | null;
  /** True when a status page was capped, so `deliveries.length` is a floor. */
  listTruncated: boolean;
  /** False until the list actually arrived — an empty array then means UNKNOWN. */
  hasData: boolean;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  failure: FailureVM | null;
  refetch: () => void;
}


/**
 * Every query key below carries the active restaurant id: the gateway scopes
 * these endpoints by tenant, so an unkeyed cache would serve the PREVIOUS
 * restaurant's deliveries/credits for a beat (or until refetch) after a
 * restaurant switch — the cross-tenant leak class found on the p3 wave.
 */
function useActiveRestaurantId(): string {
  const { activeRestaurantId, user } = useAuth();
  return activeRestaurantId || user?.restaurantId || '';
}

export function useStaffDeliveries(): StaffLaneData {
  const rid = useActiveRestaurantId();
  const q = useQuery({
    queryKey: ['receiving-next-open-orders', rid, ...IN_FLIGHT_STATUSES],
    queryFn: async () => {
      // One status per request (the DTO takes a single enum; the service does
      // `.eq("status", …)`). Disjoint by construction, so the merge cannot
      // duplicate a row.
      const pages = await Promise.all(
        IN_FLIGHT_STATUSES.map(async (status) => {
          const { data } = await apiClient.get('/procurement/orders', {
            params: { status, limit: 25 },
          });
          // `total` is the gateway's exact count for this status, and `hasMore`
          // says whether the 25-row page reached it. Both were previously
          // destructured away, which is what forced the rendered count to be a
          // page length dressed as a total.
          return {
            orders: (data?.orders ?? []) as OpenOrderDto[],
            total: num(data?.total),
            hasMore: data?.hasMore === true,
          };
        }),
      );
      return pages;
    },
  });

  const pages = q.data;

  const deliveries = useMemo<DeliveryVM[]>(
    () =>
      (pages ?? [])
        .flatMap((p) => p.orders)
        .sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? ''))
        .map((o) => ({
          id: o.id,
          vendor: vendorOf(o),
          providerRef: o.providerId ? o.providerId.slice(0, 8) : null,
          line: o.wineName ?? null,
          po: o.orderNumber ?? (o.id ? o.id.slice(0, 8) : null),
          lineCount: 1 as const,
          // NEVER `quantity`. See DeliveryVM.bottlesTotal.
          bottlesTotal: num(o.bottlesTotal),
          orderedQty: num(o.quantity),
          unitType: o.unitType ?? null,
          requestedAt: o.requestedAt ?? null,
        })),
    [pages],
  );

  // The statuses are disjoint, so the per-status totals add. One unknown total
  // makes the sum unknown — a partial sum rendered as a total is the same
  // defect one level up.
  const totalOutForDelivery = useMemo(() => {
    if (!pages) return null;
    let sum = 0;
    for (const p of pages) {
      if (p.total === null) return null;
      sum += p.total;
    }
    return sum;
  }, [pages]);

  return {
    deliveries,
    totalOutForDelivery,
    listTruncated: (pages ?? []).some((p) => p.hasMore),
    hasData: Array.isArray(pages),
    isLoading: q.isLoading,
    isError: q.isError,
    isFetching: q.isFetching,
    failure: failureOf(q.isError, q.error),
    refetch: () => void q.refetch(),
  };
}

/* ─────────────────────────────────────────────── manager: decision queue ── */

/** One row of `GET /procurement/receiving/queue` (receiving.service.ts:managerQueue). */
export interface QueueItemDto {
  orderId: string;
  orderNumber: string | null;
  verdict: string;
  summary: string | null;
  backorderQty: number;
  verifiedAt: string | null;
  dollarsAtRisk: number;
  selfEvidenced: boolean;
  openClaims: number;
}

/** The same row after `num()` has separated a measured 0 from an absent field. */
export interface QueueItemVM extends QueueItemDto {
  lane: OutcomeLane;
  laneLabel: string;
  chip: string;
  /**
   * Null when the server sent no figure at all — the em dash. A real measured
   * `0` stays `0` and renders as `$0`, because "this row costs nothing" and
   * "nobody has priced this row" are opposite facts about a decision queue and
   * the page used to print both as `—` (ADR 0051 clause 1).
   */
  atRisk: number | null;
  /**
   * A FLOOR, always. The server links claims with `.limit(200)` and no
   * `.order()` (receiving.service.ts:384), and the cap is applied across the
   * restaurant rather than per order, so the client cannot observe whether it
   * was reached. `≥0` therefore means "none inside the window", never "none".
   */
  openClaimsFloor: number | null;
}

/**
 * The three first-class outcomes the founder named (MAKEOVER-VERDICTS, door
 * brainstorm §3): accepted · short · refused. The nine match verdicts
 * (`lib/invoiceMatch.ts:MatchVerdict`) fold into them — "accepted" here means
 * the goods were kept but the paper disagrees, which is the only reason a
 * kept delivery is in this queue at all (matched rows are filtered server-side).
 */
export type OutcomeLane = 'accepted' | 'short' | 'refused';

export const LANE_LABEL: Record<OutcomeLane, string> = {
  accepted: 'Accepted — paper disagrees',
  short: 'Short',
  refused: 'Refused',
};

export function laneOf(verdict: string): OutcomeLane {
  switch (verdict) {
    case 'qty_short':
    case 'short_shipped':
    case 'partial':
      return 'short';
    case 'rejected':
      return 'refused';
    // overbilled_vs_ship, price_variance, qty_over, unmatched — goods kept,
    // paperwork wrong. An unknown verdict string also lands here and is shown
    // verbatim rather than hidden.
    default:
      return 'accepted';
  }
}

/** Human sentence for the verdict chip; unknown strings render verbatim. */
export function verdictLabel(verdict: string): string {
  switch (verdict) {
    case 'overbilled_vs_ship':
      return 'Overbilled vs their slip';
    case 'price_variance':
      return 'Price variance';
    case 'qty_over':
      return 'Over-delivered';
    case 'qty_short':
      return 'Short shipment';
    case 'short_shipped':
      return 'Lost in transit';
    case 'rejected':
      return 'Units refused';
    case 'partial':
      return 'Partial delivery';
    case 'unmatched':
      return 'No invoice yet';
    default:
      return verdict;
  }
}

export interface ManagerQueueData {
  /** Worst money first — the server's own order, kept. */
  items: QueueItemVM[];
  laneCounts: Record<OutcomeLane, number | null>;
  totalAtRisk: number | null;
  /**
   * True when the queue came back holding exactly its cap, so every count and
   * every sum derived from it is a lower bound (SERVER_WINDOWS.QUEUE_ITEMS).
   */
  itemsAtFloor: boolean;
  /**
   * Null means the query did not answer — NOT "nothing is uncounted". An
   * uncounted delivery is the one that turns into unexplained shrinkage, so
   * this is the single figure on the page where silence is most expensive.
   */
  unverified: UnverifiedDelivery[] | null;
  /** The uncounted list is built behind `.limit(500)` on receipt events. */
  unverifiedAtFloor: boolean;
  hasData: boolean;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  failure: FailureVM | null;
  refetch: () => void;
}

export function useManagerQueue(): ManagerQueueData {
  const rid = useActiveRestaurantId();
  const q = useQuery({
    queryKey: ['receiving-next-queue', rid],
    queryFn: async () => {
      const { data } = await apiClient.get('/procurement/receiving/queue');
      return data as {
        items: QueueItemDto[];
        unverified: UnverifiedDelivery[];
        totalAtRisk: number;
      };
    },
  });

  return useMemo(() => {
    const known = !!q.data && Array.isArray(q.data.items);
    const items: QueueItemVM[] = known
      ? q.data!.items.map((i) => ({
          ...i,
          lane: laneOf(i.verdict),
          laneLabel: LANE_LABEL[laneOf(i.verdict)],
          chip: verdictLabel(i.verdict),
          atRisk: num(i.dollarsAtRisk),
          openClaimsFloor: num(i.openClaims),
        }))
      : [];
    const laneCounts: Record<OutcomeLane, number | null> = {
      accepted: known ? items.filter((i) => i.lane === 'accepted').length : null,
      short: known ? items.filter((i) => i.lane === 'short').length : null,
      refused: known ? items.filter((i) => i.lane === 'refused').length : null,
    };
    // The cap is observable here: the queue's own rows arrive in the payload,
    // so a full page IS the evidence that more may exist behind it.
    const itemsAtFloor = known && items.length >= SERVER_WINDOWS.QUEUE_ITEMS;
    const unverified = known ? q.data!.unverified ?? null : null;
    const err = q.error as { message?: string } | null;
    return {
      items,
      laneCounts,
      totalAtRisk: known ? num(q.data!.totalAtRisk) : null,
      itemsAtFloor,
      unverified,
      // Built from the newest 500 receipt events; the list itself is shorter
      // than that window, so fullness is not observable and this is a floor
      // whenever the list is non-empty.
      unverifiedAtFloor: (unverified?.length ?? 0) > 0,
      hasData: known,
      isLoading: q.isLoading,
      isError: q.isError,
      errorMessage: q.isError ? err?.message ?? 'request failed' : null,
      failure: failureOf(q.isError, q.error),
      refetch: () => void q.refetch(),
    };
  }, [q.data, q.isLoading, q.isError, q.error, q.refetch]);
}

/* ─────────────────────────── manager: drafted-unsent credit requests (calm) ── */

export interface CreditDraftsData {
  /** state === 'open': drafted by the house when the count was saved, sent by no one. */
  drafts: ProcurementCredit[];
  hasData: boolean;
  isLoading: boolean;
  isError: boolean;
  failure: FailureVM | null;
  refetch: () => void;
}

export function useCreditDrafts(): CreditDraftsData {
  const rid = useActiveRestaurantId();
  const q = useQuery({
    queryKey: ['receiving-next-credit-drafts', rid],
    queryFn: () => creditsApi.list({ state: 'open' }),
  });
  return {
    drafts: q.data ?? [],
    hasData: Array.isArray(q.data),
    isLoading: q.isLoading,
    isError: q.isError,
    failure: failureOf(q.isError, q.error),
    refetch: () => void q.refetch(),
  };
}

/**
 * The one-gesture approval: open → requested. The server owns every further
 * transition (promised, credited need the memo). A refusal is surfaced to the
 * caller — the card states it in place and the die resets.
 */
export function useApproveCreditDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (creditId: string) => creditsApi.transition(creditId, { to: 'requested' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['receiving-next-credit-drafts'] });
      void qc.invalidateQueries({ queryKey: ['receiving-next-queue'] });
      void qc.invalidateQueries({ queryKey: ['receiving-next-recovery'] });
    },
  });
}

/* ───────────────────────────────────────────────────── owner: recovery ── */

export interface RecoveryData {
  stats: CreditStats | null;
  /** Sum of credited_amount settled this calendar month / last. Null until known. */
  creditedThisMonth: number | null;
  creditedLastMonth: number | null;
  /**
   * The trend's own failure. Separate from `isError` on purpose: the headline
   * figure is allowed to stand when only the trend broke, but the trend must
   * then SAY it broke rather than showing the same `—` it shows for "no
   * settled claims yet". Honest-by-accident is not honest.
   */
  trendIsError: boolean;
  trendFailure: FailureVM | null;
  /**
   * Every stats figure is computed behind `.limit(5000)` with no `.order()`
   * (credits.controller.ts:137), and the trend behind `.limit(200)` ordered
   * OLDEST-first (:112) — so a restaurant past either cap has its most recent
   * settlements outside the window entirely. Both are lower bounds.
   */
  statsAtFloor: boolean;
  trendAtFloor: boolean;
  hasData: boolean;
  isLoading: boolean;
  isError: boolean;
  failure: FailureVM | null;
  refetch: () => void;
}

export function useOwnerRecovery(): RecoveryData {
  const rid = useActiveRestaurantId();
  const statsQ = useQuery({
    queryKey: ['receiving-next-recovery', rid],
    queryFn: () => creditsApi.stats(),
  });
  // The trend is derived from the credited claims themselves (settled_at),
  // because /credits/stats carries totals only. If this list fails the trend
  // is a dash — the headline figure does not borrow certainty from it.
  const creditedQ = useQuery({
    queryKey: ['receiving-next-credited-list', rid],
    queryFn: () => creditsApi.list({ state: 'credited' }),
  });

  return useMemo(() => {
    let thisMonth: number | null = null;
    let lastMonth: number | null = null;
    if (Array.isArray(creditedQ.data)) {
      const now = new Date();
      const lastRef = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const inMonth = (iso: string | null, ref: Date) => {
        if (!iso) return false;
        const d = new Date(iso);
        return d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear();
      };
      const sum = (ref: Date) =>
        creditedQ.data!
          .filter((c) => inMonth(c.settled_at, ref))
          .reduce((s, c) => s + (num(c.credited_amount) ?? 0), 0);
      thisMonth = sum(now);
      lastMonth = sum(lastRef);
    }
    return {
      stats: statsQ.data ?? null,
      creditedThisMonth: thisMonth,
      creditedLastMonth: lastMonth,
      trendIsError: creditedQ.isError,
      trendFailure: failureOf(creditedQ.isError, creditedQ.error),
      // Not observable from the payload — /credits/stats returns aggregates,
      // not the 5000 rows behind them — so this is unconditional whenever
      // there is anything to bound.
      statsAtFloor: !!statsQ.data,
      trendAtFloor: Array.isArray(creditedQ.data) && creditedQ.data.length > 0,
      hasData: !!statsQ.data,
      isLoading: statsQ.isLoading,
      isError: statsQ.isError,
      failure: failureOf(statsQ.isError, statsQ.error),
      refetch: () => {
        void statsQ.refetch();
        void creditedQ.refetch();
      },
    };
  }, [
    statsQ.data,
    statsQ.isLoading,
    statsQ.isError,
    statsQ.error,
    statsQ.refetch,
    creditedQ.data,
    creditedQ.isError,
    creditedQ.error,
    creditedQ.refetch,
  ]);
}

/* ───────────────────────────────────────────── shared: the door outbox ── */

/**
 * `doorOutbox.ts` keeps this literal private; cited here rather than
 * re-exported so this page cannot drift from the queue it watches
 * (lib/doorOutbox.ts:24).
 */
const DOOR_MUTATION_TYPE = 'receiving.door';

/**
 * Storage key for drops this page has pinned, PER RESTAURANT. Survives reload
 * on purpose.
 *
 * It used to be one global key. A receiving tablet at the door is shared, and
 * restaurant switching is a first-class gesture, so a receipt dropped under
 * restaurant A rendered as a `role="alert"` under restaurant B — naming that
 * receipt's label and its order-id prefix to a tenant with no right to either.
 */
const DROPS_KEY_PREFIX = 'mudavym.receiving.outboxDrops';

/** The pre-scoping key. Read exactly once per browser, then removed — see `readDrops`. */
const DROPS_KEY_LEGACY = 'mudavym.receiving.outboxDrops';

function dropsKey(restaurantId: string): string {
  // An empty id would collapse back to the legacy key and re-create the leak.
  return `${DROPS_KEY_PREFIX}.${restaurantId || 'unscoped'}`;
}

export interface QueuedReceiptVM {
  id: string;
  label: string;
  queuedAt: string | null;
  /** Attempt N of 8 (doorOutbox MAX_ATTEMPTS). 0 = not yet tried. */
  retryCount: number;
  lastError: string | null;
}

export interface DroppedReceiptVM {
  id: string;
  label: string;
  droppedAt: string;
  /**
   * False when a flush both sent and dropped in one pass — the diff cannot
   * then prove WHICH removed receipt was the dropped one, and the pin says so
   * instead of guessing.
   */
  exact: boolean;
  /**
   * True for a pin inherited from the pre-scoping global key. The restaurant
   * it belongs to was never recorded, so it is shown — losing a pinned drop is
   * the inv-09 defect this rail exists to fix — but it is NOT claimed as this
   * restaurant's.
   */
  tenantUnknown?: boolean;
}

/**
 * The most recent flush. `attempted: false` is a first-class state: the outbox
 * returns `{sent:0, failed:0}` without touching the network when the device is
 * offline (lib/doorOutbox.ts:94), and stamping that with a timestamp printed
 * "last sync 14:32 · sent 0 · failed 0" directly under a header reading
 * "offline — holding".
 */
export type FlushRecord =
  | { attempted: true; sent: number; failed: number; at: string }
  | { attempted: false; reason: 'offline'; at: string };

export interface OutboxData {
  /** Null when local storage itself could not be read — unknown, not empty. */
  queued: QueuedReceiptVM[] | null;
  drops: DroppedReceiptVM[];
  /** Result of the most recent flush this page ran. Null before the first. */
  lastFlush: FlushRecord | null;
  online: boolean;
  dismissDrop: (id: string) => void;
  flushNow: () => void;
}

function parseDrops(raw: string | null): DroppedReceiptVM[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as DroppedReceiptVM[]) : [];
  } catch {
    return [];
  }
}

/**
 * MIGRATION, decided rather than defaulted. The pre-scoping key holds pins
 * whose restaurant was never recorded, and the three options were:
 *
 *   discard      — silently loses a receipt that needs a person. That IS the
 *                  inv-09 defect; refused.
 *   re-attribute — moves them to whichever restaurant is active now and claims
 *                  them as its own. That is the leak this fix exists to close,
 *                  performed once by hand; refused.
 *   adopt, marked — taken by the first restaurant to open the page, stamped
 *                  `tenantUnknown`, and rendered saying the restaurant was not
 *                  recorded. Nothing is lost and nothing is claimed.
 *
 * The legacy key is removed on adoption so the pins land in exactly one place
 * instead of fanning out to every tenant that later opens the page.
 */
function readDrops(restaurantId: string): DroppedReceiptVM[] {
  try {
    const scoped = parseDrops(window.localStorage.getItem(dropsKey(restaurantId)));
    const legacyRaw = window.localStorage.getItem(DROPS_KEY_LEGACY);
    if (!legacyRaw) return scoped;

    const inherited = parseDrops(legacyRaw)
      .filter((d) => !scoped.some((s) => s.id === d.id))
      .map((d) => ({ ...d, tenantUnknown: true }));
    const merged = [...scoped, ...inherited];
    window.localStorage.setItem(dropsKey(restaurantId), JSON.stringify(merged));
    window.localStorage.removeItem(DROPS_KEY_LEGACY);
    return merged;
  } catch {
    return [];
  }
}

function writeDrops(restaurantId: string, drops: DroppedReceiptVM[]): void {
  try {
    window.localStorage.setItem(dropsKey(restaurantId), JSON.stringify(drops));
  } catch {
    /* storage blocked — the in-memory pins still render this session */
  }
}

function toQueuedVM(m: PendingMutation): QueuedReceiptVM {
  const entry = m.data as QueuedDoorReceipt | undefined;
  return {
    id: m.id,
    label: entry?.orderLabel || entry?.orderId?.slice(0, 8) || 'Door receipt',
    queuedAt: m.timestamp ? new Date(m.timestamp).toISOString() : null,
    retryCount: m.retryCount ?? 0,
    lastError: m.lastError ?? null,
  };
}

/**
 * TODO(door-outbox, blocked): the QUEUE itself is still untenanted.
 * `doorOutbox.ts` writes every receipt under the single mutation type
 * `receiving.door` and `QueuedDoorReceipt` (`{orderId, orderLabel, body}`)
 * carries no restaurant id, so a queued receipt cannot be attributed to a
 * tenant from this side at all — filtering the read alone would return zero,
 * which is strictly worse. The write side needs to stamp the id; that file is
 * owned by a separate review. This filter is the consuming half, and it is
 * INERT until then: nothing sets the field today, so every entry passes.
 */
function belongsToRestaurant(m: PendingMutation, restaurantId: string): boolean {
  const tagged = (m.data as { restaurantId?: unknown } | undefined)?.restaurantId;
  if (typeof tagged !== 'string' || tagged === '') return true;
  return tagged === restaurantId;
}

/**
 * The pending-outbox rail's data. This is the defect fix the motion canvas
 * named (inv-09, "Nothing vanishes; the drop becomes a pin"): the legacy page
 * calls `watchDoorOutbox` and throws the flush result away, so a receipt that
 * `flushDoorOutbox` permanently drops (4xx, or 8 failed attempts —
 * doorOutbox.ts:115) is indistinguishable from one that was delivered. Here
 * the queue is snapshotted around each flush; anything that left the queue
 * beyond what `sent` accounts for is pinned, named, and stays until a person
 * dismisses it.
 */
export function useDoorOutbox(): OutboxData {
  const rid = useActiveRestaurantId();
  const [queued, setQueued] = useState<QueuedReceiptVM[] | null>(null);
  const [drops, setDrops] = useState<DroppedReceiptVM[]>(() =>
    typeof window === 'undefined' ? [] : readDrops(rid),
  );
  const [lastFlush, setLastFlush] = useState<FlushRecord | null>(null);
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const busyRef = useRef(false);

  // A restaurant switch re-reads that tenant's pins. Without this the previous
  // restaurant's drops stay on screen — the same leak the key scoping closes,
  // arriving through React state instead of through storage.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setDrops(readDrops(rid));
    setLastFlush(null);
  }, [rid]);

  const refreshQueue = useCallback(async () => {
    try {
      const pending = await offlineStorage.getPendingMutationsByType(DOOR_MUTATION_TYPE);
      setQueued(pending.filter((m) => belongsToRestaurant(m, rid)).map(toQueuedVM));
    } catch {
      setQueued(null); // unknown, and rendered as unknown — never as empty
    }
  }, [rid]);

  const pinDrops = useCallback(
    (next: DroppedReceiptVM[]) => {
      if (next.length === 0) return;
      setDrops((prev) => {
        const merged = [...prev, ...next.filter((d) => !prev.some((p) => p.id === d.id))];
        writeDrops(rid, merged);
        return merged;
      });
    },
    [rid],
  );

  const flushNow = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      let before: PendingMutation[] = [];
      let beforeKnown = true;
      try {
        before = await offlineStorage.getPendingMutationsByType(DOOR_MUTATION_TYPE);
      } catch {
        beforeKnown = false;
      }

      // `flushDoorOutbox` returns {sent:0, failed:0} WITHOUT attempting
      // anything when the device is offline (lib/doorOutbox.ts:94). Two
      // independent readings separate that non-attempt from a real flush that
      // found nothing to send, neither of which requires touching that file:
      //
      //  1. the same predicate it guards on, read here first;
      //  2. its own loop invariant — it iterates the pending queue and every
      //     iteration increments exactly one of sent/failed, so a non-empty
      //     queue returning 0+0 cannot have run.
      const offlineNow = typeof navigator !== 'undefined' && navigator.onLine === false;
      const res = offlineNow ? { sent: 0, failed: 0 } : await flushDoorOutbox();
      const raced = beforeKnown && before.length > 0 && res.sent + res.failed === 0;
      const at = new Date().toISOString();
      setLastFlush(
        offlineNow || raced ? { attempted: false, reason: 'offline', at } : { ...res, attempted: true, at },
      );

      if (beforeKnown && res.failed > 0) {
        let after: PendingMutation[] = [];
        try {
          after = await offlineStorage.getPendingMutationsByType(DOOR_MUTATION_TYPE);
        } catch {
          after = [];
        }
        const afterIds = new Set(after.map((m) => m.id));
        const removed = before.filter((m) => !afterIds.has(m.id));
        // removed = delivered + permanently dropped. `sent` accounts for the
        // delivered ones; the remainder were dropped by flushDoorOutbox.
        const droppedCount = Math.max(0, removed.length - res.sent);
        if (droppedCount > 0) {
          // When nothing was sent in the same pass, every removed item was a
          // drop and the names are exact. Otherwise the pin is honest about
          // the ambiguity rather than pointing at the wrong receipt.
          const exact = res.sent === 0;
          const candidates = exact ? removed : removed.slice(0, droppedCount);
          pinDrops(
            candidates.map((m) => ({
              id: m.id,
              label: toQueuedVM(m).label,
              droppedAt: new Date().toISOString(),
              exact,
            })),
          );
        }
      }
      await refreshQueue();
    } finally {
      busyRef.current = false;
    }
  }, [pinDrops, refreshQueue]);

  useEffect(() => {
    void refreshQueue();
    void flushNow();
    const onOnline = () => {
      setOnline(true);
      void flushNow();
    };
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void flushNow();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    const poll = window.setInterval(() => void refreshQueue(), 15_000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(poll);
    };
  }, [flushNow, refreshQueue]);

  const dismissDrop = useCallback(
    (id: string) => {
      setDrops((prev) => {
        const next = prev.filter((d) => d.id !== id);
        writeDrops(rid, next);
        return next;
      });
    },
    [rid],
  );

  return { queued, drops, lastFlush, online, dismissDrop, flushNow: () => void flushNow() };
}
