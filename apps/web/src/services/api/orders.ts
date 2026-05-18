/**
 * Orders API Service
 * 
 * Handles all procurement order-related API calls to the NestJS backend.
 */

import { apiClient, getActiveRestaurantId } from './client';
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
 * Approve an order
 */
export async function approveOrder(
  orderId: string,
  restaurantId?: string
): Promise<Order> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.post<Order>(`${ORDERS_PATH}/${orderId}/approve`, {});
  return response.data;
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
  cancelOrder,
  markOrderDelivered,
  getPendingOrdersCount,
  getOrdersNeedingApproval,
  getOrderHistory,
};

export default ordersApi;
