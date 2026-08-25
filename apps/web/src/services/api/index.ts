/**
 * API Services Index
 * 
 * Central export for all API service modules.
 * 
 * Usage:
 *   import { inventoryApi, ordersApi } from '@/services/api';
 *   
 *   // Or import specific functions
 *   import { getInventory, getLowStockItems } from '@/services/api/inventory';
 */

// Core client and utilities
export { apiClient, getErrorMessage, getActiveRestaurantId } from './client';

// Types
export * from './types';

// Domain-specific APIs
export { inventoryApi, default as inventoryApiDefault } from './inventory';
export { ordersApi, default as ordersApiDefault } from './orders';
export { winesApi, default as winesApiDefault } from './wines';
export { toastApi, default as toastApiDefault } from './toast';
export { dashboardApi, default as dashboardApiDefault } from './dashboard';

// Re-export individual functions for convenience
export {
  getInventory,
  getLowStockItems,
  getInventorySummary,
  getInventoryItem,
  updateInventoryItem,
  getUnmappedToastItems,
  findByToastGuid,
  mapToastItem,
  bulkMapToastItems,
  unmapToastItem,
} from './inventory';

export {
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
} from './orders';

export {
  searchWines,
  getWineById,
  getWinesByIds,
  getWineCategories,
  getWineRegions,
  getWineCountries,
  getWineSuggestions,
  getSimilarWines,
  addWineToInventory,
} from './wines';

export {
  getMenus as getToastMenus,
  getMenu as getToastMenu,
  refreshMenuCache,
  getSalesData,
  getStatistics as getToastStatistics,
  getWebhookMetrics,
  checkHealth as checkToastHealth,
  getTodaySalesSummary,
} from './toast';

export {
  getDashboardStats,
  getDashboardSummary,
  getRecentActivity,
  getAlerts,
  getSalesChartData,
  getInventoryBreakdown,
  getOneTapActions,
  executeOneTapAction,
  cancelOneTapAction,
} from './dashboard';

/**
 * Combined API object for convenience
 */
export const api = {
  inventory: () => import('./inventory').then(m => m.inventoryApi),
  orders: () => import('./orders').then(m => m.ordersApi),
  wines: () => import('./wines').then(m => m.winesApi),
  toast: () => import('./toast').then(m => m.toastApi),
  dashboard: () => import('./dashboard').then(m => m.dashboardApi),
};

export default api;
