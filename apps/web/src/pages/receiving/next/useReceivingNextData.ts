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
import { apiClient } from '@/services/api/client';
import { creditsApi, type ProcurementCredit, type CreditStats } from '@/services/api/credits';
import type { UnverifiedDelivery } from '@/services/api/receiving';
import { flushDoorOutbox, type QueuedDoorReceipt } from '@/lib/doorOutbox';
import { offlineStorage, type PendingMutation } from '@/lib/offline-storage';
import { num } from './rc-format';

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
  quantity?: number | null;
  wineName?: string | null;
  requestedAt?: string | null;
  /** Not in OrderResponseDto today; read defensively so a later addition just works. */
  providerName?: string | null;
}

export interface DeliveryVM {
  id: string;
  /** Vendor when the API ever provides it; the wine is the honest fallback. */
  vendor: string | null;
  /** The single line this order carries (one wine per procurement order). */
  line: string | null;
  po: string | null;
  /**
   * OrderResponseDto is one wine per order, so a delivery is exactly one
   * line by construction — this is a fact of the DTO, not a guess.
   */
  lineCount: 1;
  bottles: number | null;
  requestedAt: string | null;
}

export interface StaffLaneData {
  deliveries: DeliveryVM[];
  /** False until the list actually arrived — an empty array then means UNKNOWN. */
  hasData: boolean;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => void;
}

export function useStaffDeliveries(): StaffLaneData {
  const q = useQuery({
    queryKey: ['receiving-next-open-orders', ...IN_FLIGHT_STATUSES],
    queryFn: async () => {
      // One status per request (the DTO takes a single enum; the service does
      // `.eq("status", …)`). Disjoint by construction, so the merge cannot
      // duplicate a row.
      const pages = await Promise.all(
        IN_FLIGHT_STATUSES.map(async (status) => {
          const { data } = await apiClient.get('/procurement/orders', {
            params: { status, limit: 25 },
          });
          return (data?.orders ?? []) as OpenOrderDto[];
        }),
      );
      return pages
        .flat()
        .sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? ''));
    },
  });

  const deliveries = useMemo<DeliveryVM[]>(
    () =>
      (q.data ?? []).map((o) => ({
        id: o.id,
        vendor: o.providerName ?? null,
        line: o.wineName ?? null,
        po: o.orderNumber ?? (o.id ? o.id.slice(0, 8) : null),
        lineCount: 1 as const,
        bottles: num(o.quantity),
        requestedAt: o.requestedAt ?? null,
      })),
    [q.data],
  );

  return {
    deliveries,
    hasData: Array.isArray(q.data),
    isLoading: q.isLoading,
    isError: q.isError,
    isFetching: q.isFetching,
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

export interface QueueItemVM extends QueueItemDto {
  lane: OutcomeLane;
  laneLabel: string;
  chip: string;
}

export interface ManagerQueueData {
  /** Worst money first — the server's own order, kept. */
  items: QueueItemVM[];
  laneCounts: Record<OutcomeLane, number | null>;
  totalAtRisk: number | null;
  unverified: UnverifiedDelivery[];
  hasData: boolean;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  refetch: () => void;
}

export function useManagerQueue(): ManagerQueueData {
  const q = useQuery({
    queryKey: ['receiving-next-queue'],
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
        }))
      : [];
    const laneCounts: Record<OutcomeLane, number | null> = {
      accepted: known ? items.filter((i) => i.lane === 'accepted').length : null,
      short: known ? items.filter((i) => i.lane === 'short').length : null,
      refused: known ? items.filter((i) => i.lane === 'refused').length : null,
    };
    const err = q.error as { message?: string } | null;
    return {
      items,
      laneCounts,
      totalAtRisk: known ? num(q.data!.totalAtRisk) : null,
      unverified: known ? q.data!.unverified ?? [] : [],
      hasData: known,
      isLoading: q.isLoading,
      isError: q.isError,
      errorMessage: q.isError ? err?.message ?? 'request failed' : null,
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
  refetch: () => void;
}

export function useCreditDrafts(): CreditDraftsData {
  const q = useQuery({
    queryKey: ['receiving-next-credit-drafts'],
    queryFn: () => creditsApi.list({ state: 'open' }),
  });
  return {
    drafts: q.data ?? [],
    hasData: Array.isArray(q.data),
    isLoading: q.isLoading,
    isError: q.isError,
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
  hasData: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useOwnerRecovery(): RecoveryData {
  const statsQ = useQuery({
    queryKey: ['receiving-next-recovery'],
    queryFn: () => creditsApi.stats(),
  });
  // The trend is derived from the credited claims themselves (settled_at),
  // because /credits/stats carries totals only. If this list fails the trend
  // is a dash — the headline figure does not borrow certainty from it.
  const creditedQ = useQuery({
    queryKey: ['receiving-next-credited-list'],
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
      hasData: !!statsQ.data,
      isLoading: statsQ.isLoading,
      isError: statsQ.isError,
      refetch: () => {
        void statsQ.refetch();
        void creditedQ.refetch();
      },
    };
  }, [statsQ.data, statsQ.isLoading, statsQ.isError, statsQ.refetch, creditedQ.data, creditedQ.refetch]);
}

/* ───────────────────────────────────────────── shared: the door outbox ── */

/**
 * `doorOutbox.ts` keeps this literal private; cited here rather than
 * re-exported so this page cannot drift from the queue it watches
 * (lib/doorOutbox.ts:24).
 */
const DOOR_MUTATION_TYPE = 'receiving.door';

/** Storage key for drops this page has pinned. Survives reload on purpose. */
const DROPS_KEY = 'mudavym.receiving.outboxDrops';

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
}

export interface OutboxData {
  /** Null when local storage itself could not be read — unknown, not empty. */
  queued: QueuedReceiptVM[] | null;
  drops: DroppedReceiptVM[];
  /** Result of the most recent flush this page ran. Null before the first. */
  lastFlush: { sent: number; failed: number; at: string } | null;
  online: boolean;
  dismissDrop: (id: string) => void;
  flushNow: () => void;
}

function readDrops(): DroppedReceiptVM[] {
  try {
    const raw = window.localStorage.getItem(DROPS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as DroppedReceiptVM[]) : [];
  } catch {
    return [];
  }
}

function writeDrops(drops: DroppedReceiptVM[]): void {
  try {
    window.localStorage.setItem(DROPS_KEY, JSON.stringify(drops));
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
  const [queued, setQueued] = useState<QueuedReceiptVM[] | null>(null);
  const [drops, setDrops] = useState<DroppedReceiptVM[]>(() =>
    typeof window === 'undefined' ? [] : readDrops(),
  );
  const [lastFlush, setLastFlush] = useState<{ sent: number; failed: number; at: string } | null>(
    null,
  );
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const busyRef = useRef(false);

  const refreshQueue = useCallback(async () => {
    try {
      const pending = await offlineStorage.getPendingMutationsByType(DOOR_MUTATION_TYPE);
      setQueued(pending.map(toQueuedVM));
    } catch {
      setQueued(null); // unknown, and rendered as unknown — never as empty
    }
  }, []);

  const pinDrops = useCallback((next: DroppedReceiptVM[]) => {
    if (next.length === 0) return;
    setDrops((prev) => {
      const merged = [...prev, ...next.filter((d) => !prev.some((p) => p.id === d.id))];
      writeDrops(merged);
      return merged;
    });
  }, []);

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

      const res = await flushDoorOutbox();
      setLastFlush({ ...res, at: new Date().toISOString() });

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

  const dismissDrop = useCallback((id: string) => {
    setDrops((prev) => {
      const next = prev.filter((d) => d.id !== id);
      writeDrops(next);
      return next;
    });
  }, []);

  return { queued, drops, lastFlush, online, dismissDrop, flushNow: () => void flushNow() };
}
