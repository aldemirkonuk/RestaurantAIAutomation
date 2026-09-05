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
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/services/api/client';
import { useOrders } from '@/hooks/queries/useOrderQueries';
import { useProviders } from '@/hooks/queries/useProviderQueries';
import { type Order, type OrderStatus } from '@/services/api/types';
import { num } from './format';
import {
  PRICE_UOMS,
  agreementTotal,
  readFeesFromWire,
  type AgreementFees,
  readPriceUnitFromWire,
  type AgreementTotal,
  type PriceUnitReading,
  type PriceUom,
} from './price-unit';

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
// Moved to the foundation (lib/mudavym/status.ts) so other pages depend on
// lib/mudavym, never on this page; imported for local use and re-exported to
// keep existing call sites stable.
import { canonicalStatus } from '@/lib/mudavym/status';
export { canonicalStatus };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string | null | undefined): boolean => !!v && UUID_RE.test(v);

/**
 * What this page reads beyond the shared `Order` type.
 *
 * It used to carry six more: `finalPrice`, `totalCost`, `bottlesTotal`,
 * `unitType`, `priceUom` and `pricePackSize` were declared here because the
 * shared type named none of them — it named `unitPrice` / `totalPrice`, which
 * the list route has never sent. On 2026-09-05 the shared type was rewritten to
 * be exactly `OrderResponseDto`, so those six moved there and this intersection
 * shrank to what remains genuinely local.
 *
 * The three fee keys stay because they are ADR 0119 Q3, still being built on the
 * gateway side; they join the shared type when `OrderResponseDto` declares them.
 * `scripts/check_web_reads_gateway_dto_keys.py` guards the shared type, not this
 * intersection — a widening cast is always a way around a guard, which is why
 * the only three keys in it are named, dated and owned.
 */
type OrderWire = Order & {
  /** ADR 0119 Q3 — the money outside the price of the wine. */
  allowance?: number | null;
  deposit?: number | null;
  freight?: number | null;
};

export interface OrderRowVM {
  id: string;
  orderNumber: string | null;
  wineName: string | null;
  producer: string | null;
  providerName: string | null;
  quantity: number | null;
  /**
   * The AGREED price, stated per `priceUom` — not necessarily per bottle. Read
   * it only alongside `priceUnit`; on its own it is the ambiguous number ADR
   * 0119 exists to end.
   */
  unitPrice: number | null;
  /** Bottles (or kegs/litres, when the unit is opaque) the order comes to. */
  bottlesTotal: number | null;
  /** The unit the order's QUANTITY is counted in. Independent of the price's. */
  unitType: PriceUom | null;
  /**
   * What the route said about the unit `unitPrice` is stated in — including
   * whether it said anything at all (`read`). See `readPriceUnitFromWire`.
   */
  priceUnit: PriceUnitReading;
  /**
   * What the route said about the money OUTSIDE the price of the wine (ADR 0119
   * Q3) — including whether it said anything at all. `read: false` means this
   * payload came from a route that does not read the line's fee columns, which
   * is not the same as the agreement charging nothing.
   */
  fees: { read: boolean; fees: AgreementFees };
  /**
   * The total worked out from the price and ITS unit, with the working in
   * words. `null` when the operands are not all known — never a zero, and never
   * a per-bottle multiplication applied to a per-case price.
   */
  agreement: AgreementTotal | null;
  /** The arithmetic the page can show. Null when it cannot be done honestly. */
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

/**
 * What this house's approval rules say about one pending order.
 *
 * `GET /procurement/order-approval-gate`, one call for the whole house. The
 * facts the rules test — whether this is the first order to a vendor, how far
 * the price is above what the house last paid — are a single walk through the
 * order ledger, so they are computed there and never here: a browser cannot see
 * the ledger, and a per-row call would recompute the walk once per row and still
 * not agree with itself.
 */
export interface ApprovalGateRow {
  orderId: string;
  requiredRole: 'owner' | 'manager' | null;
  firedBy: string[];
  reasons: string[];
  untestable: string[];
  mayApprove: boolean;
  /** The whole sentence, when the caller may not seal it. Null when they may. */
  sentence: string | null;
}

export interface ApprovalGate {
  restaurantId: string;
  callerRole: string | null;
  policySet: boolean;
  policyNote: string;
  readable: boolean;
  reason: string | null;
  orders: ApprovalGateRow[];
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
  /**
   * Per-order approval verdicts, keyed by order id. `null` while the gate has
   * not been read, so an absent entry can never be mistaken for "anyone may
   * seal this" — the page renders the ceremony as it always did until the gate
   * actually answers.
   */
  approvalByOrder: Map<string, ApprovalGateRow> | null;
  /** Why the gate could not be read. Rendered in words, never swallowed. */
  approvalGateError: string | null;
  /** The house's policy in one sentence, once the gate has answered. */
  approvalPolicyNote: string | null;
}

/** The order's own quantity unit, when it is one of the seven the schema allows. */
function readUnitType(v: unknown): PriceUom | null {
  const raw = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (PRICE_UOMS as readonly string[]).includes(raw) ? (raw as PriceUom) : null;
}

/**
 * One wire row into one ledger row. Exported so the mapping can be tested on
 * the payload `GET /procurement/orders` ACTUALLY sends — the defect this pass
 * found lived entirely in the key names, and a test that builds an `OrderRowVM`
 * by hand cannot see a key name that was never read.
 */
export function toRow(o: OrderWire, providerNameById: Map<string, string>): OrderRowVM {
  const status = canonicalStatus(o.status);
  const quantity = num(o.quantity);

  /*
   * `finalPrice` and `totalCost` FIRST, because those are the keys the route
   * actually sends.
   *
   * `OrderResponseDto` has always called them that (`mapOrderRow`); the shared
   * `Order` type calls them `unitPrice` / `totalPrice`, which appear nowhere in
   * the list route's payload. Reading only the shared names made both figures
   * `undefined` for every live row, so `total` was null and the ledger printed
   * an em dash in the money column, the working line, and the seal's own label
   * ("Hold to approve · —"). The em dash was honest about a number the page did
   * not have; it was not honest about WHY. Proven by `LedgerUnit.test.tsx`
   * case 1, which fails against the pre-fix hook.
   *
   * The `?? o.unitPrice` / `?? o.totalPrice` fallbacks that stood here until
   * 2026-09-05 are gone with the keys themselves: the shared type no longer
   * declares a name the route does not send, so there is nothing to fall back
   * to and nothing that could quietly supply one.
   */
  const unitPrice = num(o.finalPrice);
  const listedTotal = num(o.totalCost);
  const bottlesTotal = num(o.bottlesTotal);
  const unitType = readUnitType(o.unitType);
  const priceUnit = readPriceUnitFromWire(o);
  const fees = readFeesFromWire(o);

  /*
   * The working, drawn from the PRICE's unit — the same arithmetic the gateway
   * did (`agreedOrderTotal`), via the same function `AgreementSheet` shows
   * before saving.
   *
   * ATTEMPTED ONLY WHEN THE PRICE'S UNIT IS STATED, and that guard is the whole
   * point rather than a cheap exit. `agreementTotal` will happily total an
   * UNSTATED price on "the old per-bottle convention" — the gateway does the
   * same when it writes `total_cost`, and it must, because a stored total
   * cannot be null. A PAGE has no such obligation, and printing that figure was
   * measurably worse than printing nothing: the first capture of this row
   * (2026-09-05, `$SP/shots-ledger-unit/`) showed a $420-per-case agreement
   * whose unit was unstated rendering "60 × $420.00 = $25,200.00" in bold
   * beside the ledger's own $2,100.00 — the exact twelve-times error ADR 0119
   * exists to end, reprinted by the screen that was built to end it. An
   * unstated unit now yields NO working, and the row says why.
   *
   * The other two operands — the order's own unit, and how many bottles are in
   * one of them — are required for the same reason: defaulting `bottlesPerUnit`
   * to 1 is the per-bottle assumption wearing a different hat.
   */
  const bottlesPerUnit =
    quantity !== null && quantity > 0 && bottlesTotal !== null && bottlesTotal > 0
      ? bottlesTotal / quantity
      : null;
  const agreement =
    priceUnit.stated !== null && unitType !== null && bottlesPerUnit !== null
      ? agreementTotal({
          price: unitPrice,
          stated: priceUnit.stated,
          quantity,
          unitType,
          bottlesPerUnit,
          // Only what the route actually read. A row whose fee columns were
          // never selected totals the goods alone — which is what it did before
          // ADR 0119 phase 2 — rather than a total built on three assumed
          // zeroes.
          fees: fees.read ? fees.fees : undefined,
        })
      : null;
  const computedTotal = agreement && agreement.ok ? agreement.total : null;

  /*
   * The route sends NO vendor name, NO producer, NO recurrence and NO notes.
   * All four were read off the shared `Order` type until 2026-09-05, and all
   * four were `undefined` on every live row:
   *
   *   providerName  the vendor was ALREADY resolved from `providerId` through
   *                 the providers query, so the page was right by accident —
   *                 `rawProvider` never once won that `??`.
   *   producer      always null, so the row's producer line never rendered.
   *   recurrence    always absent, so `recurring` was always false: the page's
   *                 RECURRING STATION HAS ALWAYS BEEN EMPTY and every order
   *                 fell into "one-time". Kept false, but as a stated fact
   *                 about the route rather than a fact about the order —
   *                 `06-pages/orders.md` §13.12 owns the station.
   *   notes         always null, so the note clause never rendered.
   *
   * Reading them again would need the route to send them; asserting them from
   * absence is the fault this whole pass exists to remove.
   */
  const recurring = false;
  return {
    id: o.id,
    orderNumber: o.orderNumber ?? null,
    wineName: o.wineName && !isUuid(o.wineName) ? o.wineName : null,
    producer: null,
    providerName: providerNameById.get(o.providerId) ?? null,
    quantity,
    unitPrice,
    bottlesTotal,
    unitType,
    priceUnit,
    fees,
    agreement,
    computedTotal,
    listedTotal,
    total: listedTotal ?? computedTotal,
    stage: stageOf(status),
    status,
    recurring,
    recurrenceLabel: null,
    requestedAt: o.requestedAt ?? null,
    approvedAt: o.approvedAt ?? null,
    deliveredAt: o.deliveredAt ?? null,
    notes: null,
  };
}

export function useOrdersNextData(): OrdersNextData {
  const { activeRestaurantId, user } = useAuth();
  const restaurantId = activeRestaurantId || user?.restaurantId || '';
  const ordersQuery = useOrders();
  const providersQuery = useProviders(restaurantId);

  // Tenant-keyed: a restaurant switch must never carry the previous house's
  // verdicts. `retry: false` because a 403/500 here is a real state the page
  // renders in words — silently retrying would make the page look like it is
  // still loading while it has an answer.
  const gateQuery = useQuery<ApprovalGate>({
    queryKey: ['procurement', 'order-approval-gate', restaurantId],
    enabled: !!restaurantId,
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.get<ApprovalGate>(
        '/procurement/order-approval-gate',
      );
      return data;
    },
  });

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

    // A gate that has not answered is `null`, not an empty map: an empty map
    // reads as "every order is unrestricted", which is the one thing an
    // unanswered gate must never be taken to mean.
    const gate = gateQuery.data ?? null;
    const approvalByOrder =
      gate && gate.readable
        ? new Map(gate.orders.map((o) => [o.orderId, o]))
        : null;
    const gateErr = gateQuery.error as { message?: string } | null;
    const approvalGateError = gateQuery.isError
      ? gateErr?.message ?? 'the approval rules could not be read'
      : gate && !gate.readable
        ? gate.reason ?? 'the approval rules could not be read'
        : null;

    return {
      approvalByOrder,
      approvalGateError,
      approvalPolicyNote: gate?.readable ? gate.policyNote : null,
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
  }, [ordersQuery.data, ordersQuery.isLoading, ordersQuery.isError, ordersQuery.error, ordersQuery.refetch, providerNameById, gateQuery.data, gateQuery.isError, gateQuery.error]);
}
