/**
 * Orders API Service
 * 
 * Handles all procurement order-related API calls to the NestJS backend.
 */

import axios from 'axios';
import { apiClient, getActiveRestaurantId, getErrorMessage } from './client';
import type {
  Order,
  OrderStatus,
  CreateOrderRequest,
  UpdateOrderRequest,
  PaginationParams,
  PaginatedResponse,
} from './types';

const ORDERS_PATH = '/procurement/orders';

/**
 * Maps a UI OrderStatus (lowercase) to the backend ProcurementOrderStatus enum (SCREAMING_SNAKE).
 * The backend uses `@IsEnum(ProcurementOrderStatus)` with `forbidNonWhitelisted: true`, so any
 * lowercase value triggers a 400. The mapping intentionally picks the most query-useful backend
 * variant for each UI alias (e.g. 'pending_approval' → 'APPROVAL_NEEDED').
 */
function toBackendStatus(status: string | undefined): string | undefined {
  if (!status) return undefined;
  const map: Record<string, string> = {
    pending_approval: 'APPROVAL_NEEDED',
    pending: 'PENDING',
    approved: 'APPROVED',
    ordered: 'CONFIRMED',
    in_transit: 'IN_TRANSIT',
    delivered: 'DELIVERED',
    partially_received: 'PARTIALLY_RECEIVED',
    cancelled: 'CANCELLED',
  };
  return map[status] ?? status.toUpperCase();
}

/**
 * Get all orders for the active restaurant.
 * The backend returns { orders, total, page, limit, hasMore }; we extract the orders array
 * so callers get a flat Order[] as expected by hooks and metrics.
 */
export async function getOrders(
  params?: PaginationParams & { status?: OrderStatus },
  restaurantId?: string
): Promise<Order[]> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const apiParams = params ? { ...params, status: toBackendStatus(params.status) } : undefined;
  const response = await apiClient.get<{ orders: Order[]; total: number }>(`${ORDERS_PATH}`, {
    params: apiParams,
  });
  return response.data?.orders ?? (response.data as unknown as Order[]) ?? [];
}

/**
 * Get a single order by ID
 */
export async function getOrder(
  orderId: string,
  restaurantId?: string
): Promise<Order> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.get<Order>(`${ORDERS_PATH}/${orderId}`);
  return response.data;
}

/**
 * Create a new order
 */
export async function createOrder(
  data: CreateOrderRequest,
  restaurantId?: string
): Promise<Order> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.post<Order>(`${ORDERS_PATH}`, data);
  return response.data;
}

/**
 * Update an order
 */
export async function updateOrder(
  orderId: string,
  data: UpdateOrderRequest,
  restaurantId?: string
): Promise<Order> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.patch<Order>(`${ORDERS_PATH}/${orderId}`, data);
  return response.data;
}

/**
 * Update order status
 */
export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  restaurantId?: string
): Promise<Order> {
  return updateOrder(orderId, { status }, restaurantId);
}

/**
 * Mint the one-time seal an approval has to carry back — at the moment the
 * hold-to-approve gesture BEGINS.
 *
 * THE SEAL IS REDEEMED, NOT ASSERTED (founder, 2026-09-04; ADR 0116 addendum).
 * ADR 0114 shipped `sealed: true` as a claim made in the same request as the
 * thing it claimed about, and said so in its own text. The gateway now mints a
 * token bound to (this manager, this order, "approve", this order's own total
 * and vendor) and redeems it exactly once, so an approval proves a person did
 * it rather than asserting one did.
 *
 * It MUST be called when the gesture starts, never at the moment of approval: a
 * token this request fetched for itself is the assertion model with extra steps.
 * `HoldToApprove`'s `onChallenge` is the hook that guarantees the timing, and a
 * mint that fails or returns null does NOT approve.
 */
export async function mintOrderSeal(orderId: string): Promise<string | null> {
  const response = await apiClient.post<{ challenge?: string }>(
    `${ORDERS_PATH}/${orderId}/seal-challenge`,
    {},
  );
  return response.data?.challenge ?? null;
}

/**
 * Mint the one-time seal a CANCELLATION has to carry back (ADR 0125).
 *
 * A separate route and a separate act from `mintOrderSeal`, on purpose: a token
 * minted here says `cancel`, so it cannot be spent on an approval, and an
 * approval's cannot be spent on a cancellation. The gateway refuses each with
 * "That seal was issued for a different act on this order."
 *
 * It is also the first refusal a person meets. The gateway will not mint a seal
 * for a cancellation it would not perform — an order whose wine has arrived, or
 * one already closed — so the hold fails at its start with the reason, rather
 * than at its end after a second and a half of ceremony. Same timing rule as
 * the approval's: called from `onChallenge`, never at the moment of the write.
 */
export async function mintOrderCancelSeal(orderId: string): Promise<string | null> {
  try {
    const response = await apiClient.post<{ challenge?: string }>(
      `${ORDERS_PATH}/${orderId}/cancel-seal-challenge`,
      {},
    );
    return response.data?.challenge ?? null;
  } catch (error) {
    // THE REFUSAL HAS TO SURVIVE THE TRIP — and on this route it is the ONLY
    // place the sentence appears, because a refused mint means the write is
    // never attempted at all.
    //
    // Measured 2026-09-05 while capturing the ceremony: without this the 422
    // reached the control as "Request failed with status code 422" and the
    // page printed that, so "the wine has been counted into stock and its cost
    // is in the books" — the whole reason the house said no — was thrown away
    // by the client. `mintOrderSeal` above still has this gap; its consequence
    // is smaller (the approval gate is re-checked at `POST /approve`, where the
    // sentence does arrive) and it is named in ADR 0125 rather than changed in
    // a pass about cancellation.
    if (axios.isAxiosError(error)) {
      const spoken = getErrorMessage(error);
      if (spoken) error.message = spoken;
    }
    throw error;
  }
}

/**
 * Approve an order, carrying the seal minted when the hold began.
 *
 * `challenge` is not optional in practice — the gateway refuses an approval
 * without one, in words. It is typed optional only so the two callers that do
 * not yet mint (the legacy `pages/Orders.tsx` and `dashboard/next`'s
 * WaitingOnYou, both outside this pass's scope) keep COMPILING and receive the
 * gateway's refusal sentence rather than a type error. That refusal is the
 * honest outcome for them: they will say, in words, that the seal has to be
 * proven and that nothing was approved.
 */
export async function approveOrder(
  orderId: string,
  restaurantId?: string,
  challenge?: string | null
): Promise<Order> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  try {
    const response = await apiClient.post<Order>(
      `${ORDERS_PATH}/${orderId}/approve`,
      {},
      // The seal travels in a header, never in the body: it is not one of the
      // arguments it is a seal OVER.
      challenge ? { headers: { 'X-Seal-Challenge': challenge } } : undefined,
    );
    return response.data;
  } catch (error) {
    // THE REFUSAL HAS TO SURVIVE THE TRIP.
    //
    // Since ADR 0116 this endpoint answers 403 with a whole sentence — which
    // rule fired, what the number was, and who may sign — because a person told
    // only "forbidden" learns one thing: split the order in two. An axios error
    // carries that sentence in `response.data.message` and puts "Request failed
    // with status code 403" in `.message`, and every call site here reads
    // `.message`: `pages/orders/next/LedgerRow.tsx`, `BulkApproveBar.tsx`,
    // `pages/dashboard/next/WaitingOnYou.tsx` and the legacy `pages/Orders.tsx`.
    //
    // So the server's sentence is promoted onto `.message` and the SAME error
    // object is rethrown — `response`, `status` and `isAxiosError` all intact,
    // because callers branch on `err.response?.status` elsewhere. Rethrowing a
    // fresh `Error` would fix the copy and break those.
    if (axios.isAxiosError(error)) {
      const spoken = getErrorMessage(error);
      if (spoken) error.message = spoken;
    }
    throw error;
  }
}

/**
 * Cancel (reject) an order, with the reason written onto it.
 *
 * THIS POSTED TO A ROUTE THAT DOES NOT EXIST (measured 2026-09-05).
 * It sent `POST /procurement/orders/:id/cancel` with the reason in a body. The
 * gateway has no such route: `procurement.controller.ts` declares
 * `@Delete("orders/:id")` taking `@Query("reason")`, and `openapi.json` lists
 * `/api/v1/procurement/orders/{id}` as `get, patch, delete` with the only
 * `cancel` path being `cancel-scheduled-send`. Every call through
 * `useCancelOrder` was therefore a 404, and the reason a person typed went
 * nowhere. The service DOES record it — `cancelOrder` -> `updateOrder` writes
 * `procurement_orders.rejection_reason` — so nothing but the caller was wrong.
 *
 * The reason travels as a query parameter because that is what the route reads;
 * a body on a DELETE would be silently dropped by the same code path that
 * dropped this one.
 *
 * THE SEAL (ADR 0125, 2026-09-05). This route now redeems one, minted by
 * `mintOrderCancelSeal` when the hold BEGINS. The act is `cancel`, so an
 * approval's seal cannot be spent here and this one cannot be spent on
 * `POST orders/:id/approve`; the gateway refuses each with its own sentence.
 * The reason is no longer optional — the gateway answers 400 in words without
 * one — and a cancellation of an order whose wine has arrived is refused 422.
 * The note that used to sit on the responses sheet saying this act was recorded
 * rather than proven is retired with this change.
 */
export async function cancelOrder(
  orderId: string,
  reason?: string,
  restaurantId?: string,
  challenge?: string | null
): Promise<Order> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  try {
    const response = await apiClient.delete<Order>(`${ORDERS_PATH}/${orderId}`, {
      params: reason ? { reason } : undefined,
      // The same header the approval carries, so a caller has one thing to
      // learn. What separates the two acts is the act the token names, which
      // the gateway compares — not the shape of the request.
      headers: challenge ? { 'x-seal-challenge': challenge } : undefined,
    });
    return response.data;
  } catch (error) {
    // Same promotion as `approveOrder`: the gateway's sentence is what a person
    // needs, and every call site reads `.message`. The original error object is
    // rethrown so callers that branch on `err.response?.status` still can.
    if (axios.isAxiosError(error)) {
      const spoken = getErrorMessage(error);
      if (spoken) error.message = spoken;
    }
    throw error;
  }
}

/* ===========================================================================
 * ALREADY DELIVERED — 409, AND THE EARLIER DELIVERY TO SHOW INSTEAD
 * ===========================================================================
 * Founder, 2026-09-05 (batch 46): a second delivery of an already-delivered
 * order answers **409 Conflict, not 400** — *"the request is well-formed, the
 * order's state conflicts with it, and the door and the one-tap rail must be
 * able to tell 'already done' from 'you sent nonsense' and show the earlier
 * delivery instead of an error."*
 *
 * So every surface that can reach a delivery refusal reads it through THIS
 * parser and prints `summary`. One parser, because four screens each poking at
 * `err.response.data.earlierDelivery.receivedByName` is four chances to render
 * `undefined` as a person's name; and because the gateway shape is asserted in
 * exactly one place on this side.
 *
 * A 409 is never retried. That is the whole point of it not being a 500: the
 * request was fine, and repeating it cannot change the answer.
 */
export interface EarlierDelivery {
  deliveredAt: string | null;
  receivedBy: string | null;
  receivedByName: string | null;
  /** Why there is no name, when one was wanted. Distinguishes a failed lookup
   *  from an order nobody signed for — they are not the same fact. */
  receivedByNameReason: string | null;
  quantityReceived: number | null;
  /**
   * The unit `quantityReceived` is stated in, or `null` — a REFUSAL, not a
   * default. `procurement_orders.quantity_received` has four writers: three
   * write the order's own unit and the receiving door writes bottles, and the
   * row does not say which. For `case`/`pack`/`split_case` the two differ by
   * the pack size, so the gateway states no unit and `summary` omits the count
   * rather than printing one that could be off by twelve.
   */
  unitType: string | null;
  /** Why the unit is, or is not, stated. Always present. */
  quantityUnitWhy: string;
  bottlesTotal: number | null;
  /** "Delivered on 2026-09-04 at 14:05 UTC by Ada Lovelace, 12 bottles booked in." */
  summary: string;
}

export interface AlreadyDeliveredRefusal {
  reason: 'order_already_delivered';
  orderId: string;
  orderNumber: string | null;
  status: string | null;
  /** The whole refusal sentence: what happened, why, and what to do instead. */
  message: string;
  earlierDelivery: EarlierDelivery | null;
}

/**
 * Read a delivery refusal off an error, or `null` if this is not one.
 *
 * Structural rather than trusting the status alone: a proxy can answer 409 with
 * an HTML page, and a screen that printed `undefined` from one would be
 * inventing a delivery. Every field is checked before it is believed, and a body
 * that carries the reason but no `earlierDelivery` yields `earlierDelivery:
 * null` — which callers render as the refusal sentence alone, never as a
 * delivery with blanks in it.
 */
export function alreadyDeliveredRefusal(
  error: unknown
): AlreadyDeliveredRefusal | null {
  const res = (error as { response?: { status?: unknown; data?: unknown } } | null)?.response;
  if (!res || res.status !== 409) return null;
  const body = res.data as Record<string, unknown> | null | undefined;
  if (!body || typeof body !== 'object') return null;
  if (body.reason !== 'order_already_delivered') return null;

  const raw = body.earlierDelivery as Record<string, unknown> | null | undefined;
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

  // `summary` is the one field a caller PRINTS, so a body without a usable one
  // is treated as carrying no earlier delivery at all rather than rendering an
  // empty line where a fact belongs.
  const summary = raw ? str(raw.summary) : null;

  return {
    reason: 'order_already_delivered',
    orderId: str(body.orderId) ?? '',
    orderNumber: str(body.orderNumber),
    status: str(body.status),
    message: str(body.message) ?? 'That order has already been delivered.',
    earlierDelivery:
      raw && summary
        ? {
            deliveredAt: str(raw.deliveredAt),
            receivedBy: str(raw.receivedBy),
            receivedByName: str(raw.receivedByName),
            receivedByNameReason: str(raw.receivedByNameReason),
            quantityReceived: num(raw.quantityReceived),
            unitType: str(raw.unitType),
            quantityUnitWhy: str(raw.quantityUnitWhy) ?? '',
            bottlesTotal: num(raw.bottlesTotal),
            summary,
          }
        : null,
  };
}

/**
 * The words a screen shows in place of an error when a delivery was refused.
 *
 * The refusal sentence and, when the gateway could say it, the earlier delivery
 * on its own line. Never one without the other where both exist: the sentence
 * says why nothing changed, the summary says what already did.
 */
export function alreadyDeliveredWords(refusal: AlreadyDeliveredRefusal): string {
  return refusal.earlierDelivery
    ? `${refusal.earlierDelivery.summary} ${refusal.message}`
    : refusal.message;
}

/**
 * Mark order as delivered.
 *
 * Throws 409 when the order has already arrived — the gateway refuses a second
 * delivery for every caller, in words (`delivered-once.ts`). The sentence is
 * promoted onto `error.message` here, exactly as `approveOrder` and
 * `cancelOrder` do: every call site of this function reads `.message` (the
 * Action Center's `failureMessage`, the Orders desk's alert), and without the
 * promotion they would all show axios's own "Request failed with status code
 * 409" and the reason a person was stopped would never reach the screen. The
 * original error is rethrown so callers that branch on `err.response?.status`
 * or on the body's `reason` still can.
 */
export async function markOrderDelivered(
  orderId: string,
  notes?: string,
  restaurantId?: string
): Promise<Order> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  try {
    const response = await apiClient.post<Order>(`${ORDERS_PATH}/${orderId}/deliver`, { notes });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const spoken = getErrorMessage(error);
      if (spoken) error.message = spoken;
    }
    throw error;
  }
}

/**
 * Three-way match a delivered order: what we ordered, what the vendor billed, and what
 * physically arrived. The server recomputes the verdict itself and derives the ledger
 * correction — these fields are evidence, not instructions.
 *
 * Completes the order, or holds it open as PARTIALLY_RECEIVED when less was accepted than
 * ordered. Throws 422 if the invoice price differs from the agreed price and no
 * `priceOverrideReason` was given.
 *
 * `adjustments` carries unlisted extras that were not on the invoice.
 */
export async function verifyOrderReceipt(
  orderId: string,
  body: {
    adjustments?: Array<{ inventoryId: string; delta: number; reason?: string }>;
    /**
     * THE UNIT DECLARATIONS.
     *
     * Each quantity below names the declaration it belongs to in its own name.
     * Absent means "the unit the order was placed in", which is what this screen
     * already means — it seeds its count from the order's own quantity. An
     * unrecognised unit, or a case/pack/split_case whose pack size is nowhere
     * stated, is REFUSED with a 400 rather than assumed: a guessed unit produces
     * a confident wrong verdict that nothing downstream can detect.
     */
    invoiceUom?: string;
    invoiceBottlesPerUnit?: number;
    shippedUom?: string;
    shippedBottlesPerUnit?: number;
    countedUom?: string;
    countedBottlesPerUnit?: number;

    /** Omit when no invoice is in hand — the server reads absence as unknown, not agreement. */
    invoiceQuantityInInvoiceUom?: number;
    /** PER BOTTLE — compared directly against the agreed per-bottle price. */
    invoiceUnitPrice?: number;
    /**
     * From the vendor's own packing slip / EDI 856. When this disagrees with the
     * invoice quantity, the overbill is proven by their paperwork and the resulting
     * claim needs no argument.
     */
    shippedQuantityInShippedUom?: number;
    /** Agreed free goods, so a negotiated 11-for-10 stops reading as an overage. */
    freeGoodsQuantityInCountedUom?: number;
    /** Freight and fees from the invoice header, folded into landed cost. */
    allocatedCharges?: number;
    acceptedQuantityInCountedUom?: number;
    rejectedQuantityInCountedUom?: number;
    rejectedReason?: string;
    priceOverrideReason?: string;
    note?: string;

    /**
     * What the extraction PROPOSED in the form, before the human answered
     * (ADR 0059).
     *
     * The four fields above are what the manager submitted; these four are what
     * the machine put there first. A manager correcting a misread invoice
     * quantity from 22 to 24 used to leave no trace at all — the submitted 24
     * was indistinguishable from a 24 the model had read correctly, which makes
     * every correction invisible in exactly the corpus that needs them.
     *
     * Omitted when the form was not pre-filled from a document: then the final
     * value is not a correction of anything, and claiming otherwise would
     * manufacture a label.
     */
    prefilledInvoiceQuantityInInvoiceUom?: number;
    prefilledInvoiceUnitPrice?: number;
    prefilledShippedQuantityInShippedUom?: number;
    prefilledFreeGoodsQuantityInCountedUom?: number;
  }
): Promise<Order> {
  const response = await apiClient.post<Order>(
    `${ORDERS_PATH}/${orderId}/verify-receipt`,
    body
  );
  return response.data;
}

/**
 * Get pending orders count
 */
export async function getPendingOrdersCount(restaurantId?: string): Promise<number> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.get<{ count: number }>(`${ORDERS_PATH}/pending/count`);
  return response.data.count;
}

/**
 * Get orders needing approval
 */
export async function getOrdersNeedingApproval(restaurantId?: string): Promise<Order[]> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.get<Order[]>(`${ORDERS_PATH}/pending`);
  return response.data;
}

/**
 * Get order history with pagination.
 * The backend returns { orders, total, page, limit, hasMore }; we normalize to the
 * PaginatedResponse<Order> shape ({ data, total, page, limit, hasMore }) used by callers.
 */
export async function getOrderHistory(
  params?: PaginationParams & {
    startDate?: string;
    endDate?: string;
    dateFrom?: string;
    dateTo?: string;
    status?: OrderStatus;
    providerId?: string;
  },
  restaurantId?: string
): Promise<PaginatedResponse<Order>> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const apiParams = params ? { ...params, status: toBackendStatus(params.status) } : undefined;
  const response = await apiClient.get<{ orders: Order[]; total: number; page: number; limit: number; hasMore: boolean }>(
    `${ORDERS_PATH}/history`,
    { params: apiParams },
  );
  const raw = response.data;
  // Normalize { orders } → { data } so callers using PaginatedResponse<Order>.data still work
  return {
    data: raw?.orders ?? (raw as any)?.data ?? [],
    total: raw?.total ?? 0,
    page: raw?.page ?? (params?.page ?? 1),
    limit: raw?.limit ?? (params?.limit ?? 50),
    hasMore: raw?.hasMore ?? false,
  };
}

// ==================== Export all functions ====================

export const ordersApi = {
  getOrders,
  getOrder,
  createOrder,
  updateOrder,
  updateOrderStatus,
  approveOrder,
  mintOrderSeal,
  mintOrderCancelSeal,
  cancelOrder,
  markOrderDelivered,
  getPendingOrdersCount,
  getOrdersNeedingApproval,
  getOrderHistory,
};

export default ordersApi;
