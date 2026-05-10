/**
 * Toast POS API Service
 * 
 * Handles all Toast POS-related API calls through the NestJS proxy.
 */

import { apiClient, getActiveRestaurantId } from './client';
import type {
  ToastMenu,
  ToastSalesResponse,
} from './types';

const TOAST_PATH = '/toast';

/**
 * Get Toast menus
 */
export async function getMenus(restaurantId?: string): Promise<{ menus: ToastMenu[]; total: number }> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.get<{ menus: ToastMenu[]; total: number }>(
    `${TOAST_PATH}/menus`,
    { params: { restaurantId: id } }
  );
  return response.data;
}

/**
 * Get a single Toast menu
 */
export async function getMenu(menuId: string): Promise<ToastMenu> {
  const response = await apiClient.get<ToastMenu>(`${TOAST_PATH}/menus/${menuId}`);
  return response.data;
}

/**
 * Refresh Toast menu cache
 */
export async function refreshMenuCache(
  restaurantId?: string,
  menuId?: string
): Promise<{ cleared: number }> {
  const response = await apiClient.post<{ cleared: number }>(
    `${TOAST_PATH}/cache/refresh`,
    { restaurantId, menuId }
  );
  return response.data;
}

/**
 * Create a Toast order
 */
export async function createOrder(
  items: Array<{
    itemGuid: string;
    name: string;
    quantity: number;
    unitPrice: number;
    specialInstructions?: string;
  }>,
  tableName?: string,
  serverName?: string,
  notes?: string,
  restaurantId?: string
): Promise<any> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.post(
    `${TOAST_PATH}/orders`,
    { items, tableName, serverName, notes },
    { params: { restaurantId: id } }
  );
  return response.data;
}

/**
 * Get a Toast order
 */
export async function getOrder(orderId: string): Promise<any> {
  const response = await apiClient.get(`${TOAST_PATH}/orders/${orderId}`);
  return response.data;
}

/**
 * Get Toast sales data
 */
export async function getSalesData(
  startTime: Date,
  endTime: Date,
  restaurantId?: string
): Promise<ToastSalesResponse> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.get<ToastSalesResponse>(`${TOAST_PATH}/sales`, {
    params: {
      restaurantId: id,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    },
  });
  return response.data;
}

/**
 * Get Toast API statistics
 */
export async function getStatistics(): Promise<any> {
  const response = await apiClient.get(`${TOAST_PATH}/statistics`);
  return response.data;
}

/**
 * Get Toast webhook metrics
 */
export async function getWebhookMetrics(): Promise<{
  received: number;
  processed: number;
  errors: number;
  byType: Record<string, number>;
}> {
  const response = await apiClient.get(`${TOAST_PATH}/webhook/metrics`);
  return response.data;
}

/**
 * Check Toast API health
 */
export async function checkHealth(): Promise<{
  status: string;
  service: string;
  timestamp: string;
}> {
  const response = await apiClient.get(`${TOAST_PATH}/health`);
  return response.data;
}

/**
 * Get today's sales summary
 */
export async function getTodaySalesSummary(restaurantId?: string): Promise<{
  totalSales: number;
  totalRevenue: number;
  topItems: Array<{
    itemName: string;
    quantity: number;
    revenue: number;
  }>;
}> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  const sales = await getSalesData(startOfDay, now, restaurantId);
  
  // Aggregate by item
  const itemMap = new Map<string, { quantity: number; revenue: number }>();
  
  for (const sale of sales.sales) {
    const existing = itemMap.get(sale.itemName) || { quantity: 0, revenue: 0 };
    itemMap.set(sale.itemName, {
      quantity: existing.quantity + sale.quantity,
      revenue: existing.revenue + sale.totalPrice,
    });
  }
  
  const topItems = Array.from(itemMap.entries())
    .map(([itemName, stats]) => ({
      itemName,
      quantity: stats.quantity,
      revenue: stats.revenue,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
  
  return {
    totalSales: sales.total,
    totalRevenue: sales.totalRevenue,
    topItems,
  };
}

// ==================== Export all functions ====================

export const toastApi = {
  getMenus,
  getMenu,
  refreshMenuCache,
  createOrder,
  getOrder,
  getSalesData,
  getStatistics,
  getWebhookMetrics,
  checkHealth,
  getTodaySalesSummary,
};

export default toastApi;
