/**
 * Custom Hooks Index
 * 
 * Export all custom hooks for easy importing.
 */

export { useDashboardData, useSalesChartData, useToastSalesSummary } from './useDashboardData';
export { useInventoryData } from './useInventoryData';
export { useOrdersData } from './useOrdersData';

// Sync and offline hooks
export { useSyncManager, type UseSyncManagerReturn } from './useSyncManager';
export { useOnlineStatus, type UseOnlineStatusReturn } from './useOnlineStatus';

// Storage location hooks
export { 
  useStorageLocations, 
  type StorageLocation, 
  type WineLocationMapping,
  DEFAULT_LOCATIONS 
} from './useStorageLocations';

// Orders metrics hooks
export {
  useOrdersMetrics,
  type StoredOrder,
  type OrderMetrics
} from './useOrdersMetrics';
