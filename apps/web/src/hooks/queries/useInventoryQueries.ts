/**
 * Inventory TanStack Query Hooks
 *
 * Modern replacement for the legacy useInventoryData hook.
 * Benefits: cache dedup, background refetch, optimistic updates,
 * stale-while-revalidate, real-time invalidation via WebSocket bridge.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../lib/query-keys'
import { inventoryApi } from '../../services/api'
import type { InventoryItem, InventorySummary, CreateInventoryItemRequest } from '../../services/api/types'
import { useAuth } from '../../contexts/AuthContext'
import { useInventorySubscription } from '../../contexts/RealtimeContext'
import { useCallback } from 'react'

// ---------------------------------------------------------------------------
// Normalize helper (handles snake_case <-> camelCase from API)
// ---------------------------------------------------------------------------

function normalizeInventoryItem(item: any): InventoryItem {
  return {
    ...item,
    wineId: item.wineId ?? item.master_wine_id,
    wineName: item.wineName ?? item.wine_name,
    stockLive: item.stockLive ?? item.stock_live ?? 0,
    shadowStock: item.shadowStock ?? item.shadow_stock ?? 0,
    thresholdMin: item.thresholdMin ?? item.threshold_min ?? 0,
    thresholdMax: item.thresholdMax ?? item.threshold_max ?? 0,
    toastItemGuid: item.toastItemGuid ?? item.toast_item_guid,
    isActive: item.isActive ?? item.is_active ?? true,
  }
}

// ---------------------------------------------------------------------------
// Query: Inventory list
// ---------------------------------------------------------------------------

export function useInventory() {
  const { activeRestaurantId, isAuthenticated } = useAuth()
  const queryClient = useQueryClient()

  // Real-time: invalidate on WS event from agent bridge
  useInventorySubscription(
    useCallback(() => {
      if (activeRestaurantId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all })
      }
    }, [activeRestaurantId, queryClient]),
  )

  return useQuery({
    queryKey: queryKeys.inventory.list(activeRestaurantId ?? ''),
    queryFn: async () => {
      const items = await inventoryApi.getInventory(activeRestaurantId!)
      return items.map(normalizeInventoryItem)
    },
    enabled: !!activeRestaurantId && isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

// ---------------------------------------------------------------------------
// Query: Inventory summary (counts, totals)
// ---------------------------------------------------------------------------

export function useInventorySummary() {
  const { activeRestaurantId, isAuthenticated } = useAuth()

  return useQuery<InventorySummary | null>({
    queryKey: queryKeys.inventory.summary(activeRestaurantId ?? ''),
    queryFn: () => inventoryApi.getInventorySummary(activeRestaurantId!),
    enabled: !!activeRestaurantId && isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

// ---------------------------------------------------------------------------
// Query: Low stock items
// ---------------------------------------------------------------------------

export function useLowStockItems() {
  const { activeRestaurantId, isAuthenticated } = useAuth()

  return useQuery({
    queryKey: queryKeys.inventory.lowStock(activeRestaurantId ?? ''),
    queryFn: async () => {
      const items = await inventoryApi.getLowStockItems(activeRestaurantId!)
      return items.map(normalizeInventoryItem)
    },
    enabled: !!activeRestaurantId && isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

// ---------------------------------------------------------------------------
// Mutation: Update inventory item
// ---------------------------------------------------------------------------

export function useUpdateInventoryItem() {
  const { activeRestaurantId } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      itemId,
      data,
    }: {
      itemId: string
      data: Partial<InventoryItem>
    }) => {
      if (!activeRestaurantId) throw new Error('No restaurant selected')
      return inventoryApi.updateInventoryItem(
        itemId,
        {
          stockLive: data.stockLive,
          shadowStock: data.shadowStock,
          thresholdMin: data.thresholdMin,
          thresholdMax: data.thresholdMax,
          toastItemGuid: data.toastItemGuid,
          isActive: data.isActive,
        },
        activeRestaurantId,
      )
    },
    onMutate: async ({ itemId, data }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: queryKeys.inventory.all })
      const prevItems = queryClient.getQueryData<InventoryItem[]>(
        queryKeys.inventory.list(activeRestaurantId ?? ''),
      )
      if (prevItems) {
        queryClient.setQueryData(
          queryKeys.inventory.list(activeRestaurantId ?? ''),
          prevItems.map((item) =>
            item.id === itemId ? { ...item, ...data } : item,
          ),
        )
      }
      return { prevItems }
    },
    onError: (_err, _vars, context) => {
      if (context?.prevItems) {
        queryClient.setQueryData(
          queryKeys.inventory.list(activeRestaurantId ?? ''),
          context.prevItems,
        )
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Toast Mapping
// ---------------------------------------------------------------------------

export function useUnmappedToastItems() {
  const { activeRestaurantId, isAuthenticated } = useAuth()

  return useQuery({
    queryKey: [...queryKeys.inventory.all, 'unmapped-toast', activeRestaurantId],
    queryFn: () => inventoryApi.getUnmappedToastItems(activeRestaurantId!),
    enabled: !!activeRestaurantId && isAuthenticated,
    staleTime: 120_000,
  })
}

// ---------------------------------------------------------------------------
// Mutation: Create inventory item
// ---------------------------------------------------------------------------

export function useCreateInventoryItem() {
  const { activeRestaurantId } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateInventoryItemRequest) => {
      if (!activeRestaurantId) throw new Error('No restaurant selected')
      return inventoryApi.createInventoryItem(data, activeRestaurantId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all })
    },
  })
}

export function useMapToastItem() {
  const { activeRestaurantId } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      inventoryId,
      toastItemGuid,
    }: {
      inventoryId: string
      toastItemGuid: string
    }) => {
      if (!activeRestaurantId) throw new Error('No restaurant selected')
      return inventoryApi.mapToastItem(
        { inventoryId, toastItemGuid },
        activeRestaurantId,
      )
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all })
    },
  })
}
