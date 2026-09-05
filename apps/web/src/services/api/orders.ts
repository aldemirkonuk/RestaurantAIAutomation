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
 * Cancel an order
 */
export async function cancelOrder(
  orderId: string,
  reason?: string,
  restaurantId?: string
): Promise<Order> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.post<Order>(`${ORDERS_PATH}/${orderId}/cancel`, { reason });
  return response.data;
}

/**
 * Mark order as delivered
 */
export async function markOrderDelivered(
  orderId: string,
  notes?: string,
  restaurantId?: string
): Promise<Order> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.post<Order>(`${ORDERS_PATH}/${orderId}/deliver`, { notes });
  return response.data;
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
  cancelOrder,
  markOrderDelivered,
  getPendingOrdersCount,
  getOrdersNeedingApproval,
  getOrderHistory,
};

export default ordersApi;
