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

import { useCallback } from 'react';
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
  /**
   * `error` above reflects only the inventory-list query, for back-compat
   * with the consumers that read this hook without a summary or low-stock
   * concept of their own. `summaryError`/`lowStockError` are additive so a
   * failed-read banner (InventoryCommandPage, go-live sweep 2026-09-18,
   * wave5/live-fix.md) can also key on the two queries whose failures used
   * to render as a silent empty success.
   */
  summaryError: string | null;
  lowStockError: string | null;
  /**
   * True while any of the three reads has no data to show yet -- the first
   * mount, or a refetch that (TanStack v5) resets the query to `pending` and
   * clears `error` for its duration. `isLoading` above only catches the
   * inventory-list query's own first fetch; a consumer that needs to know
   * "no query has settled with data" for ALL three reads (go-live sweep
   * 2026-09-18, wave5/live-confirm.md B2: a page that keyed on `error` alone
   * printed literal zeros for up to 72% of samples while a refetch loop kept
   * resetting the query to pending) should read this instead. Additive, like
   * `summaryError`/`lowStockError` above -- `isLoading` keeps its old meaning
   * for its other four consumers.
   */
  isPending: boolean;
  refetch: () => Promise<void>;
  updateItem: (itemId: string, data: Partial<InventoryItem>) => Promise<void>;
}

export function useInventoryData(_options: UseInventoryOptions = {}): UseInventoryResult {
  const inventoryQuery = useInventory();
  const summaryQuery = useInventorySummary();
  const lowStockQuery = useLowStockItems();
  const updateMutation = useUpdateInventoryItem();

  // Memoized (wave5/live-confirm.md B2): an inline `async () => {...}` here
  // is a fresh function every render. A consumer that watches it as an
  // effect dependency (InventoryCommandPage's spot-count-outbox watcher)
  // then re-runs that effect on every render, which -- combined with the
  // watcher firing on mount -- refetches the three queries in a loop. The
  // three underlying `.refetch` functions are themselves stable across
  // renders for an unchanged query key (TanStack Query), so this is now
  // stable too.
  const refetch = useCallback(async () => {
    await Promise.all([
      inventoryQuery.refetch(),
      summaryQuery.refetch(),
      lowStockQuery.refetch(),
    ]);
  }, [inventoryQuery.refetch, summaryQuery.refetch, lowStockQuery.refetch]);

  const updateItem = async (itemId: string, data: Partial<InventoryItem>) => {
    await updateMutation.mutateAsync({ itemId, data });
  };

  return {
    inventory: inventoryQuery.data || [],
    summary: summaryQuery.data || null,
    lowStockItems: lowStockQuery.data || [],
    isLoading: inventoryQuery.isLoading,
    error: inventoryQuery.error?.message || null,
    summaryError: summaryQuery.error?.message || null,
    lowStockError: lowStockQuery.error?.message || null,
    isPending: inventoryQuery.isPending || summaryQuery.isPending || lowStockQuery.isPending,
    refetch,
    updateItem,
  };
}
