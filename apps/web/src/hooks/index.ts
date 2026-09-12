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
// NB no DEFAULT_LOCATIONS: there is no such thing as a default zone. A tenant
// has the zones it created, or it has none. See ADR 0051 and the header of
// useStorageLocations.ts.
export {
  useStorageLocations,
  type StorageLocation,
  type WineLocationMapping
} from './useStorageLocations';

// Orders metrics hooks
export {
  useOrdersMetrics,
  type StoredOrder,
  type OrderMetrics
} from './useOrdersMetrics';
