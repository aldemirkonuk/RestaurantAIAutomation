/**
 * Inventory Data Hook (Bridge to TanStack Query)
 *
 * This hook maintains the legacy return shape expected by Inventory.tsx and
 * other consumers, but internally delegates to the TanStack Query hooks in
 * hooks/queries/useInventoryQueries.ts for:
 *  - Automatic cache dedup & stale-while-revalidate
 *  - Background refetch on WebSocket events
 *  - Optimistic mutations
 *
 * Consumers see the exact same interface — no migration needed.
 */

import type { InventoryItem, InventorySummary } from '../services/api/types';
import { useInventory, useInventorySummary, useLowStockItems, useUpdateInventoryItem } from './queries/useInventoryQueries';

export interface UseInventoryOptions {
  includeInactive?: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export interface UseInventoryResult {
  inventory: InventoryItem[];
  summary: InventorySummary | null;
  lowStockItems: InventoryItem[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  updateItem: (itemId: string, data: Partial<InventoryItem>) => Promise<void>;
}

export function useInventoryData(_options: UseInventoryOptions = {}): UseInventoryResult {
  const inventoryQuery = useInventory();
  const summaryQuery = useInventorySummary();
  const lowStockQuery = useLowStockItems();
  const updateMutation = useUpdateInventoryItem();

  const refetch = async () => {
    await Promise.all([
      inventoryQuery.refetch(),
      summaryQuery.refetch(),
      lowStockQuery.refetch(),
    ]);
  };

  const updateItem = async (itemId: string, data: Partial<InventoryItem>) => {
    await updateMutation.mutateAsync({ itemId, data });
  };

  return {
    inventory: inventoryQuery.data || [],
    summary: summaryQuery.data || null,
    lowStockItems: lowStockQuery.data || [],
    isLoading: inventoryQuery.isLoading,
    error: inventoryQuery.error?.message || null,
    refetch,
    updateItem,
  };
}
