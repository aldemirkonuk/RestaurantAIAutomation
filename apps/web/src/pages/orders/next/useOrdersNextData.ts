/**
 * OrdersNext view model — live data only, assembled from the EXISTING hooks
 * (useOrders, useProviders); nothing here invents a number. The five-stage
 * spine the founder kept (pending · approved · ordered · delivered · recurring)
 * is derived from the canonical OrderStatus set via normalizeOrderStatus, with
 * `recurring` orthogonal: a repeating order sits in the recurring station
 * whatever its current status, exactly as the legacy page bucketed it.
 *
 * Unknowns are null and render as em dashes downstream — a failed query is not
 * an empty ledger, and a missing price is not $0.00.
 */

import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useOrders } from '@/hooks/queries/useOrderQueries';
import { useProviders } from '@/hooks/queries/useProviderQueries';
import { normalizeOrderStatus, type Order, type OrderStatus } from '@/services/api/types';
import { num } from './format';

export type Stage = 'pending' | 'approved' | 'ordered' | 'delivered';
export const STAGES: Stage[] = ['pending', 'approved', 'ordered', 'delivered'];

export const STAGE_LABEL: Record<Stage | 'recurring', string> = {
  pending: 'Pending',
  approved: 'Approved',
  ordered: 'Ordered',
  delivered: 'Delivered',
  recurring: 'Recurring',
};

function stageOf(status: OrderStatus): Stage | 'cancelled' {
  switch (status) {
    case 'draft':
    case 'negotiating':
    case 'pending':
    case 'pending_approval':
      return 'pending';
    case 'approved':
      return 'approved';
    case 'ordered':
    case 'in_transit':
      return 'ordered';
    case 'delivered':
    case 'partially_received':
    case 'verified':
    case 'completed':
      return 'delivered';
    case 'cancelled':
    case 'rejected':
      return 'cancelled';
  }
}

/**
 * The gateway speaks ProcurementOrderStatus (SCREAMING_SNAKE) and the raw list
 * endpoint returns it verbatim; normalizeOrderStatus knows the canonical set
 * but not these backend-only variants, which the legacy page mapped by hand
 * (useOrdersPage.ts mapApiStatusToUi). Same truth, kept here.
 */
export function canonicalStatus(raw: string | undefined): OrderStatus {
  switch ((raw ?? '').toUpperCase()) {
    case 'APPROVAL_NEEDED':
      return 'pending_approval';
    case 'CONFIRMED':
      return 'ordered';
    case 'FAILED':
      return 'cancelled';
    default:
      return normalizeOrderStatus(raw);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string | null | undefined): boolean => !!v && UUID_RE.test(v);

export interface OrderRowVM {
  id: string;
  orderNumber: string | null;
  wineName: string | null;
  producer: string | null;
  providerName: string | null;
  quantity: number | null;
  unitPrice: number | null;
  /** quantity × unitPrice when both are known — the working. */
  computedTotal: number | null;
  /** The server's own totalPrice, kept separately so a disagreement can be said. */
  listedTotal: number | null;
  /** The figure the page acts on: listed if present, else computed, else null. */
  total: number | null;
  stage: Stage | 'cancelled';
  status: OrderStatus;
  recurring: boolean;
  recurrenceLabel: string | null;
  requestedAt: string | null;
  approvedAt: string | null;
  deliveredAt: string | null;
  notes: string | null;
}

export interface MonthFigure {
  /** Sum of known order values created this calendar month (cancelled excluded). Null = unknown. */
  thisMonth: number | null;
  lastMonth: number | null;
  /** Orders inside this month whose value is unknown — stated, not silently zeroed. */
  unpricedThisMonth: number;
}

export interface OrdersNextData {
  rows: OrderRowVM[];
  /** Station counts. Null while unknown (loading with no cache, or errored). */
  counts: Record<Stage, number | null>;
  recurringCount: number | null;
  cancelledCount: number | null;
  month: MonthFigure;
  /**
   * True only once the orders list has actually arrived. While false, an empty
   * `rows` means UNKNOWN (fetching, retrying, or waiting on a restaurant
   * context) — never "no orders". The page must not claim an empty book on it.
   */
  hasData: boolean;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  refetch: () => void;
}

function toRow(o: Order, providerNameById: Map<string, string>): OrderRowVM {
  const status = canonicalStatus(o.status);
  const quantity = num(o.quantity);
  const unitPrice = num(o.unitPrice);
  const listedTotal = num(o.totalPrice);
  const computedTotal = quantity !== null && unitPrice !== null ? quantity * unitPrice : null;
  const rawProvider = o.providerName && !isUuid(o.providerName) ? o.providerName : null;
  const recurring = !!o.recurrence;
  const freq = o.recurrence?.frequency ?? null;
  return {
    id: o.id,
    orderNumber: o.orderNumber ?? null,
    wineName: o.wineName && !isUuid(o.wineName) ? o.wineName : null,
    producer: o.wineProducer ?? null,
    providerName: rawProvider ?? providerNameById.get(o.providerId) ?? null,
    quantity,
    unitPrice,
    computedTotal,
    listedTotal,
    total: listedTotal ?? computedTotal,
    stage: stageOf(status),
    status,
    recurring,
    recurrenceLabel: recurring
      ? [freq, o.recurrence?.nextDate ? `next ${o.recurrence.nextDate}` : null]
          .filter(Boolean)
          .join(' · ') || 'recurring'
      : null,
    requestedAt: o.requestedAt ?? o.createdAt ?? null,
    approvedAt: o.approvedAt ?? null,
    deliveredAt: o.deliveredAt ?? null,
    notes: o.notes ?? null,
  };
}

export function useOrdersNextData(): OrdersNextData {
  const { activeRestaurantId, user } = useAuth();
  const restaurantId = activeRestaurantId || user?.restaurantId || '';
  const ordersQuery = useOrders();
  const providersQuery = useProviders(restaurantId);

  const providerNameById = useMemo(() => {
    const map = new Map<string, string>();
    (providersQuery.data ?? []).forEach((p) => {
      if (p?.id && p?.name) map.set(p.id, p.name);
    });
    return map;
  }, [providersQuery.data]);

  return useMemo(() => {
    const raw = ordersQuery.data;
    const known = Array.isArray(raw);
    const rows = known ? raw.map((o) => toRow(o, providerNameById)) : [];

    const counts: Record<Stage, number | null> = {
      pending: null,
      approved: null,
      ordered: null,
      delivered: null,
    };
    let recurringCount: number | null = null;
    let cancelledCount: number | null = null;
    const month: MonthFigure = { thisMonth: null, lastMonth: null, unpricedThisMonth: 0 };

    if (known) {
      const oneTime = rows.filter((r) => !r.recurring);
      for (const s of STAGES) counts[s] = oneTime.filter((r) => r.stage === s).length;
      recurringCount = rows.filter((r) => r.recurring).length;
      cancelledCount = rows.filter((r) => r.stage === 'cancelled').length;

      const now = new Date();
      const inMonth = (iso: string | null, ref: Date) => {
        if (!iso) return false;
        const d = new Date(iso);
        return d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear();
      };
      const lastRef = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const active = rows.filter((r) => r.stage !== 'cancelled');
      const sumKnown = (rs: OrderRowVM[]) =>
        rs.reduce((s, r) => s + (r.total ?? 0), 0);
      const thisRows = active.filter((r) => inMonth(r.requestedAt, now));
      const lastRows = active.filter((r) => inMonth(r.requestedAt, lastRef));
      month.thisMonth = sumKnown(thisRows);
      month.lastMonth = sumKnown(lastRows);
      month.unpricedThisMonth = thisRows.filter((r) => r.total === null).length;
    }

    const err = ordersQuery.error as { message?: string } | null;
    return {
      rows,
      counts,
      recurringCount,
      cancelledCount,
      month,
      hasData: known,
      isLoading: ordersQuery.isLoading,
      isError: ordersQuery.isError,
      errorMessage: ordersQuery.isError ? err?.message ?? 'request failed' : null,
      refetch: () => void ordersQuery.refetch(),
    };
  }, [ordersQuery.data, ordersQuery.isLoading, ordersQuery.isError, ordersQuery.error, ordersQuery.refetch, providerNameById]);
}
