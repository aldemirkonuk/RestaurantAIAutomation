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
import { normalizeInventoryItem } from '../../services/api/inventory'
import type { InventoryItem, InventorySummary, CreateInventoryItemRequest } from '../../services/api/types'
import { useAuth } from '../../contexts/AuthContext'
import { useInventorySubscription } from '../../contexts/RealtimeContext'
import { isQueryAffectedByStockUpdate, type StockUpdatedEvent } from '../../lib/websocket'
import { useCallback } from 'react'

// ---------------------------------------------------------------------------
// Query: Inventory list
// ---------------------------------------------------------------------------

export function useInventory() {
  const { activeRestaurantId, isAuthenticated } = useAuth()
  const queryClient = useQueryClient()

  // Real-time: invalidate on WS event from agent bridge.
  //
  // This runs the SAME predicate as the socket handler that raised the event
  // (lib/websocket.tsx `isQueryAffectedByStockUpdate`). It has to: the
  // `stock:updated` handler narrows its own `invalidateQueries` and then
  // dispatches the `inventory_change` CustomEvent three lines below, which
  // lands here — so a blanket `['inventory']` invalidation at this end undoes
  // the narrowing entirely and the whole tree refetches anyway. One rule, two
  // entry points.
  //
  // Only a payload carrying a `restaurant_id` is narrowed. `inventory_change`
  // is also dispatched locally with `InventoryUpdatePayload`
  // (contexts/RealtimeContext.tsx `dispatchInventoryUpdate`), a different shape
  // with no restaurant or inventory id and no promise of being stock-shaped at
  // all — an add, a removal or a reconciliation. Those keep the blanket
  // invalidation they have always had, because narrowing a payload we cannot
  // read would be muting, and a missing field must widen a refresh, never
  // silence it.
  useInventorySubscription(
    useCallback(
      (payload: unknown) => {
        if (!activeRestaurantId) return
        const data = (payload as { new?: Partial<StockUpdatedEvent['data']> } | undefined)?.new
        if (typeof data?.restaurant_id === 'string' && data.restaurant_id.length > 0) {
          queryClient.invalidateQueries({
            predicate: (query) => isQueryAffectedByStockUpdate(query.queryKey, data),
          })
          return
        }
        queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all })
      },
      [activeRestaurantId, queryClient],
    ),
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
    // Normalized at the service boundary — `getLowStockItems` maps the raw
    // `v_low_stock_items` row to the declared type before it gets here.
    queryFn: () => inventoryApi.getLowStockItems(activeRestaurantId!),
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
