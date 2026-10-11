/**
 * Order TanStack Query Hooks
 *
 * Modern replacement for the legacy useOrdersData hook.
 * Benefits: cache dedup, background refetch, optimistic updates,
 * stale-while-revalidate, offline support via persister.
 */

import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../lib/query-keys'
import { ordersApi } from '../../services/api'
import type { Order, OrderStatus, CreateOrderRequest } from '../../services/api/types'
import { useAuth } from '../../contexts/AuthContext'
import { useOrdersSubscription } from '../../contexts/RealtimeContext'
import { useCallback } from 'react'

// ---------------------------------------------------------------------------
// Query: Fetch all orders
// ---------------------------------------------------------------------------

export function useOrders(filters?: { status?: OrderStatus }) {
  const { activeRestaurantId, isAuthenticated } = useAuth()
  const queryClient = useQueryClient()

  // Real-time: invalidate on WS event
  useOrdersSubscription(
    useCallback(() => {
      if (activeRestaurantId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
      }
    }, [activeRestaurantId, queryClient]),
  )

  return useQuery({
    queryKey: queryKeys.orders.list(activeRestaurantId ?? '', filters),
    // The whole book, not the gateway's newest 50 (F-1132): /orders counts its
    // stages and sums its month from this list, and so does the calendar.
    queryFn: () => ordersApi.getOrderBook(filters, activeRestaurantId!),
    enabled: !!activeRestaurantId && isAuthenticated,
    staleTime: 30_000, // 30s stale window (agent bridge pushes updates)
    refetchInterval: 60_000, // 60s polling fallback
    refetchOnWindowFocus: true,
  })
}

// ---------------------------------------------------------------------------
// Query: The ledger's window and the whole book's figures (/orders, F-1368)
// ---------------------------------------------------------------------------

/**
 * The newest orders, a page of 100 at a time; `fetchNextPage` loads older
 * ones. The poll and the focus re-read touch only the pages already loaded,
 * not the house's whole history (a 5,000-order house was read in 50 serial
 * requests every minute). The first page also carries the whole book's stage
 * counts and month, counted by the gateway. Keyed under `orders.all`, so
 * realtime, placements and approvals re-read it.
 */
export function useOrderWindow() {
  const { activeRestaurantId, isAuthenticated } = useAuth()
  const queryClient = useQueryClient()
  let zone: string | null = null
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    zone = null
  }

  useOrdersSubscription(
    useCallback(() => {
      if (activeRestaurantId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
      }
    }, [activeRestaurantId, queryClient]),
  )

  return useInfiniteQuery({
    queryKey: [...queryKeys.orders.all, 'window', activeRestaurantId ?? '', zone] as const,
    queryFn: ({ pageParam }) =>
      ordersApi.getOrderPage(pageParam, activeRestaurantId!, { summary: pageParam === 1, zone }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: !!activeRestaurantId && isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

/**
 * The orders these ids name, read by id in chunks (F-1368): /calendar needs
 * only the orders its visible entries link to, never the whole book. An empty
 * list is answered at once, without a request.
 */
export function useOrdersByIds(ids: string[]) {
  const { activeRestaurantId, isAuthenticated } = useAuth()
  const key = [...new Set(ids)].sort()
  return useQuery({
    queryKey: [...queryKeys.orders.all, 'by-id', activeRestaurantId ?? '', key] as const,
    queryFn: () =>
      key.length === 0 ? Promise.resolve([] as Order[]) : ordersApi.getOrdersByIds(key, activeRestaurantId!),
    enabled: !!activeRestaurantId && isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

// ---------------------------------------------------------------------------
// Query: Open orders per vendor, counted by the gateway
// ---------------------------------------------------------------------------

/**
 * `{ [providerId]: n }` over the house's whole book, not the newest page
 * (open orders per vendor, F-905). Keyed under `orders.all` so the same
 * realtime invalidation reaches it.
 */
export function useOpenOrderCountsByProvider() {
  const { activeRestaurantId, isAuthenticated } = useAuth()
  const queryClient = useQueryClient()

  useOrdersSubscription(
    useCallback(() => {
      if (activeRestaurantId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
      }
    }, [activeRestaurantId, queryClient]),
  )

  return useQuery({
    queryKey: [...queryKeys.orders.all, 'open-by-provider', activeRestaurantId ?? ''] as const,
    queryFn: () => ordersApi.getOpenOrderCountsByProvider(activeRestaurantId!),
    enabled: !!activeRestaurantId && isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

// ---------------------------------------------------------------------------
// Query: Pending orders (approval needed)
// ---------------------------------------------------------------------------

export function usePendingOrders() {
  const { activeRestaurantId, isAuthenticated } = useAuth()

  return useQuery({
    queryKey: queryKeys.orders.pending(activeRestaurantId ?? ''),
    queryFn: () => ordersApi.getOrdersNeedingApproval(activeRestaurantId!),
    enabled: !!activeRestaurantId && isAuthenticated,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}

// ---------------------------------------------------------------------------
// Query: Pending count (badge number)
// ---------------------------------------------------------------------------

export function usePendingOrdersCount() {
  const { activeRestaurantId, isAuthenticated } = useAuth()

  return useQuery({
    queryKey: [...queryKeys.orders.pending(activeRestaurantId ?? ''), 'count'],
    queryFn: () => ordersApi.getPendingOrdersCount(activeRestaurantId!),
    enabled: !!activeRestaurantId && isAuthenticated,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

// ---------------------------------------------------------------------------
// Query: Order history with pagination
// ---------------------------------------------------------------------------

export function useOrderHistory(options: {
  page?: number
  limit?: number
  startDate?: string
  endDate?: string
  status?: OrderStatus
  providerId?: string
} = {}) {
  const { activeRestaurantId, isAuthenticated } = useAuth()

  return useQuery({
    queryKey: [...queryKeys.orders.history(activeRestaurantId ?? ''), options],
    queryFn: () => ordersApi.getOrderHistory(options, activeRestaurantId!),
    enabled: !!activeRestaurantId && isAuthenticated,
    staleTime: 60_000,
  })
}

// ---------------------------------------------------------------------------
// Mutation: Create order
// ---------------------------------------------------------------------------

export function useCreateOrder() {
  const { activeRestaurantId } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateOrderRequest) => {
      if (!activeRestaurantId) throw new Error('No restaurant selected')
      return ordersApi.createOrder(data, activeRestaurantId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Mutation: Approve order
// ---------------------------------------------------------------------------

/**
 * What an approval is asked for.
 *
 * A bare id is still accepted, and that is deliberate rather than lazy: the two
 * callers outside this pass's scope (the legacy `pages/Orders.tsx` via
 * `useOrdersData`, and `dashboard/next`'s WaitingOnYou) pass one, and widening
 * the type to `{ orderId, challenge }` alone would have broken their build in
 * a pass that was told not to change them. They send no seal, so the gateway
 * refuses them in words — which is a visible, explained refusal rather than a
 * silent approval, and is the honest state until they mint too.
 */
export type ApproveOrderInput = string | { orderId: string; challenge?: string | null }

function readApproveInput(input: ApproveOrderInput): {
  orderId: string
  challenge: string | null
} {
  if (typeof input === 'string') return { orderId: input, challenge: null }
  return { orderId: input.orderId, challenge: input.challenge ?? null }
}

export function useApproveOrder() {
  const { activeRestaurantId } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: ApproveOrderInput) => {
      if (!activeRestaurantId) throw new Error('No restaurant selected')
      const { orderId, challenge } = readApproveInput(input)
      return ordersApi.approveOrder(orderId, activeRestaurantId, challenge)
    },
    onMutate: async (input) => {
      const { orderId } = readApproveInput(input)
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: queryKeys.orders.all })
      const prevOrders = queryClient.getQueryData<Order[]>(
        queryKeys.orders.list(activeRestaurantId ?? ''),
      )
      if (prevOrders) {
        queryClient.setQueryData(
          queryKeys.orders.list(activeRestaurantId ?? ''),
          prevOrders.map((o) =>
            o.id === orderId ? { ...o, status: 'approved' as OrderStatus } : o,
          ),
        )
      }
      return { prevOrders }
    },
    onError: (_err, _orderId, context) => {
      if (context?.prevOrders) {
        queryClient.setQueryData(
          queryKeys.orders.list(activeRestaurantId ?? ''),
          context.prevOrders,
        )
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Mutation: Cancel order
// ---------------------------------------------------------------------------

export function useCancelOrder() {
  const { activeRestaurantId } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      orderId,
      reasonCode,
      reason,
      challenge,
    }: {
      orderId: string
      /** ADR 0207 round 4 — required; see `services/api/orders.ts` `cancelOrder`. */
      reasonCode: 'never_arrived' | 'vendor_cannot_supply' | 'house_decision'
      reason?: string
      /**
       * The one-time seal minted when the hold began (ADR 0125). Typed optional
       * so a caller that does not yet mint keeps COMPILING and receives the
       * gateway's refusal sentence rather than a type error — the same
       * arrangement `approveOrder` uses, and the honest outcome for such a
       * caller: it will say, in words, that the seal has to be proven and that
       * nothing was cancelled.
       */
      challenge?: string | null
    }) => {
      if (!activeRestaurantId) throw new Error('No restaurant selected')
      return ordersApi.cancelOrder(orderId, reasonCode, reason, activeRestaurantId, challenge)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Mutation: Mark delivered
// ---------------------------------------------------------------------------

export function useMarkOrderDelivered() {
  const { activeRestaurantId } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orderId, notes }: { orderId: string; notes?: string }) => {
      if (!activeRestaurantId) throw new Error('No restaurant selected')
      return ordersApi.markOrderDelivered(orderId, notes, activeRestaurantId)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all })
    },
  })
}
