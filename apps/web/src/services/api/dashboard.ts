/**
 * Dashboard API Service
 * 
 * Handles dashboard-related API calls for aggregated data.
 */

import { apiClient, getActiveRestaurantId } from './client';
import { inventoryApi } from './inventory';
import { ordersApi } from './orders';
import type { DashboardStats } from './types';

const DASHBOARD_PATH = '/dashboard';

/**
 * Get dashboard statistics
 */
export async function getDashboardStats(restaurantId?: string): Promise<DashboardStats> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  try {
    // Try to get from API endpoint first
    const response = await apiClient.get<DashboardStats>(`${DASHBOARD_PATH}/stats/${id}`);
    return response.data;
  } catch (error) {
    // Fallback to aggregating from individual APIs
    const [summary, pendingOrders] = await Promise.all([
      inventoryApi.getInventorySummary(id),
      ordersApi.getPendingOrdersCount(id).catch(() => 0),
    ]);

    return {
      totalWines: summary.totalItems,
      totalBottles: summary.totalBottles,
      lowStockItems: summary.lowStockCount,
      pendingOrders,
      totalVolumeMl: 0,
      totalVolumeOz: 0,
    };
  }
}

/**
 * Get dashboard summary with all widgets
 */
export async function getDashboardSummary(restaurantId?: string): Promise<{
  stats: DashboardStats;
  recentActivity: any[];
  upcomingEvents: any[];
  alerts: any[];
}> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.get(`${DASHBOARD_PATH}/summary/${id}`);
  return response.data;
}

/**
 * Get recent activity for dashboard
 */
export async function getRecentActivity(
  limit: number = 10,
  restaurantId?: string
): Promise<any[]> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  try {
    const response = await apiClient.get(`${DASHBOARD_PATH}/activity/${id}`, {
      params: { limit },
    });
    return response.data;
  } catch {
    return [];
  }
}

/**
 * Get alerts/notifications for dashboard
 */
export async function getAlerts(restaurantId?: string): Promise<any[]> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  try {
    const response = await apiClient.get(`${DASHBOARD_PATH}/alerts/${id}`);
    return response.data;
  } catch {
    return [];
  }
}

/**
 * Chart series for the dashboard.
 *
 * The endpoint path `GET /dashboard/sales-chart/:id` is frozen and is a
 * misnomer: it does NOT return sales. The gateway builds this series from
 * delivered `procurement_orders.total_cost` — money the restaurant PAYS its
 * vendors, published as `procurementSpend` — plus a `wine_consumption_log`
 * glasses count. See `apps/api-gateway/src/dashboard/dashboard.service.ts`
 * `getSalesChart`. Sales revenue lives in `pos_checks` and is not returned here.
 */
export async function getSalesChartData(
  period: 'day' | 'week' | 'month' = 'week',
  restaurantId?: string
): Promise<{
  labels: string[];
  data: number[];
  total: number;
}> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  try {
    const response = await apiClient.get(`${DASHBOARD_PATH}/sales-chart/${id}`, {
      params: { period },
    });
    return response.data;
  } catch {
    // Fallback: generate empty chart data
    const now = new Date();
    const labels: string[] = [];
    const data: number[] = [];
    
    const days = period === 'day' ? 24 : period === 'week' ? 7 : 30;
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      if (period === 'day') {
        date.setHours(date.getHours() - i);
        labels.push(date.toLocaleTimeString('en-US', { hour: 'numeric' }));
      } else {
        date.setDate(date.getDate() - i);
        labels.push(date.toLocaleDateString('en-US', { weekday: 'short' }));
      }
      data.push(0);
    }
    
    return { labels, data, total: 0 };
  }
}

/**
 * Get inventory breakdown for dashboard chart
 */
export async function getInventoryBreakdown(restaurantId?: string): Promise<{
  categories: Array<{
    name: string;
    count: number;
    value: number;
  }>;
}> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  try {
    const response = await apiClient.get(`${DASHBOARD_PATH}/inventory-breakdown/${id}`);
    return response.data;
  } catch {
    return { categories: [] };
  }
}

/**
 * Get one-tap actions for dashboard
 */
export async function getOneTapActions(restaurantId?: string): Promise<any[]> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  try {
    const response = await apiClient.get('/one-tap-actions', {
      params: { restaurantId: id },
    });
    // The endpoint returns { actions, total }; older callers expected a bare array.
    return Array.isArray(response.data) ? response.data : (response.data?.actions ?? []);
  } catch (err) {
    // An empty list is a legitimate answer; a broken endpoint is not, and
    // returning [] for both is why this stayed broken. Both routes this function
    // calls 404'd for months — the dashboard rendered "no actions" and nobody
    // could tell that from "the feature is gone". Log before degrading.
    console.error('[dashboard] one-tap actions request failed:', err);
    return [];
  }
}

/**
 * Execute a one-tap action.
 *
 * The gateway marks the row completed, stamps `executed_by` with the caller's
 * user id, records `execution_result`, and broadcasts `action_executed` over the
 * WebSocket. `result` is the optional `ExecuteActionDto.result` payload.
 *
 * This throws on failure — deliberately. Callers show optimistic UI and must
 * roll it back, so swallowing the error here would recreate the fabricated
 * success this endpoint exists to replace.
 */
export async function executeOneTapAction(
  actionId: string,
  restaurantId?: string,
  result?: Record<string, unknown>
): Promise<{ success: boolean; message: string }> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.post(
    `/one-tap-actions/${actionId}/execute`,
    result ? { result } : {},
    { params: { restaurantId: id } }
  );
  return response.data;
}

/**
 * Cancel a one-tap action — the server-side counterpart of "Reject".
 *
 * Sets status to `cancelled` and broadcasts `action_cancelled`. Distinct from
 * delete: the row stays, so a rejection is auditable.
 */
export async function cancelOneTapAction(
  actionId: string,
  restaurantId?: string
): Promise<{ success: boolean; message: string }> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.post(`/one-tap-actions/${actionId}/cancel`, {});
  return response.data;
}

/**
 * Per-day figures for the dashboard calendar.
 *
 * The endpoint path `GET /dashboard/calendar-revenue/:id` is frozen and is a
 * misnomer: `daily[].procurement_spend` and `monthly_procurement_spend` are
 * summed from delivered `procurement_orders` — vendor SPEND, not sales revenue.
 * `bottles_sold` counts bottles DELIVERED by vendors, for the same reason. See
 * `apps/api-gateway/src/dashboard/dashboard.service.ts` `getCalendarRevenue`.
 */
export async function getCalendarRevenue(
  year?: number,
  month?: number,
  restaurantId?: string
): Promise<{
  year: number;
  month: number;
  restaurant_id: string;
  daily: Array<{
    date: string;
    procurement_spend: number;
    bottles_sold: number;
    events: any[];
    order_count: number;
  }>;
  monthly_procurement_spend: number;
  monthly_bottles: number;
}> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const now = new Date();
  const y = year ?? now.getFullYear();
  const m = month ?? now.getMonth() + 1;

  try {
    const response = await apiClient.get(`${DASHBOARD_PATH}/calendar-revenue/${id}`, {
      params: { year: y, month: m },
    });
    return response.data;
  } catch {
    // Return empty structure on failure
    return {
      year: y,
      month: m,
      restaurant_id: id,
      daily: [],
      monthly_procurement_spend: 0,
      monthly_bottles: 0,
    };
  }
}

// ==================== Export all functions ====================

export const dashboardApi = {
  getDashboardStats,
  getDashboardSummary,
  getRecentActivity,
  getAlerts,
  getSalesChartData,
  getInventoryBreakdown,
  getOneTapActions,
  executeOneTapAction,
  cancelOneTapAction,
  getCalendarRevenue,
};

export default dashboardApi;
