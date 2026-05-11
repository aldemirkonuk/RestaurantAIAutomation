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
 * Get all orders for the active restaurant
 */
export async function getOrders(
  params?: PaginationParams & { status?: OrderStatus },
  restaurantId?: string
): Promise<Order[]> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.get<Order[]>(`${ORDERS_PATH}`, {
    params: {
      restaurantId: id,
      ...params,
    },
  });
  return response.data;
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

  const response = await apiClient.get<Order>(`${ORDERS_PATH}/${orderId}`, {
    params: { restaurantId: id },
  });
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

  const response = await apiClient.post<Order>(`${ORDERS_PATH}`, {
    ...data,
    restaurantId: id,
  });
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

  const response = await apiClient.patch<Order>(`${ORDERS_PATH}/${orderId}`, data, {
    params: { restaurantId: id },
  });
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

  const response = await apiClient.post<Order>(`${ORDERS_PATH}/${orderId}/approve`, {}, {
    params: { restaurantId: id },
  });
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

  const response = await apiClient.post<Order>(`${ORDERS_PATH}/${orderId}/cancel`, {
    reason,
  }, {
    params: { restaurantId: id },
  });
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

  const response = await apiClient.post<Order>(`${ORDERS_PATH}/${orderId}/deliver`, {
    notes,
  }, {
    params: { restaurantId: id },
  });
  return response.data;
}

/**
 * Get pending orders count
 */
export async function getPendingOrdersCount(restaurantId?: string): Promise<number> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.get<{ count: number }>(`${ORDERS_PATH}/pending/count`, {
    params: { restaurantId: id },
  });
  return response.data.count;
}

/**
 * Get orders needing approval
 */
export async function getOrdersNeedingApproval(restaurantId?: string): Promise<Order[]> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.get<Order[]>(`${ORDERS_PATH}/pending`, {
    params: { restaurantId: id },
  });
  return response.data;
}

/**
 * Get order history with pagination
 */
export async function getOrderHistory(
  params?: PaginationParams & {
    startDate?: string;
    endDate?: string;
    status?: OrderStatus;
    providerId?: string;
  },
  restaurantId?: string
): Promise<PaginatedResponse<Order>> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.get<PaginatedResponse<Order>>(`${ORDERS_PATH}/history`, {
    params: {
      restaurantId: id,
      ...params,
    },
  });
  return response.data;
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
