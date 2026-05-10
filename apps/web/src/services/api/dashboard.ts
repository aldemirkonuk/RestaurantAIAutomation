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
 * Get sales data for dashboard chart
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
    return response.data;
  } catch {
    return [];
  }
}

/**
 * Execute a one-tap action
 */
export async function executeOneTapAction(
  actionId: string,
  restaurantId?: string
): Promise<{ success: boolean; message: string }> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.post(`/one-tap-actions/${actionId}/execute`, {}, {
    params: { restaurantId: id },
  });
  return response.data;
}

/**
 * Get calendar-revenue data for a specific month
 * Returns per-day data with revenue from delivered orders and calendar events
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
    revenue: number;
    bottles_sold: number;
    events: any[];
    order_count: number;
  }>;
  monthly_total: number;
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
      monthly_total: 0,
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
  getCalendarRevenue,
};

export default dashboardApi;
