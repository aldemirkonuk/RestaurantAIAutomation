/**
 * Open orders per vendor, counted by the gateway over the whole order book.
 *
 * /vendors' cards used `useOrders()`, which reads the newest 50 orders, and
 * counted from those rows — so a vendor with three approved, undelivered
 * orders older than the newest fifty read "0" (r21, 2026-11-13). The gateway
 * now counts the whole book (`GET /procurement/orders/open/by-vendor`), and a
 * refusal is an error here, never an empty map.
 *
 * The key sits under `queryKeys.orders.all`, so every order write that
 * invalidates the orders family (approve, cancel, receive, the realtime
 * bridge) refreshes these counts too.
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/query-keys';
import { getOpenOrdersByVendor } from '../../services/api/orders';
import { useAuth } from '../../contexts/AuthContext';
import { useOrdersSubscription } from '../../contexts/RealtimeContext';

export function openOrdersByVendorKey(restaurantId: string) {
  return [...queryKeys.orders.all, 'open-by-vendor', restaurantId] as const;
}

export function useOpenOrdersByVendor() {
  const { activeRestaurantId, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  useOrdersSubscription(
    useCallback(() => {
      if (activeRestaurantId) {
        queryClient.invalidateQueries({ queryKey: openOrdersByVendorKey(activeRestaurantId) });
      }
    }, [activeRestaurantId, queryClient]),
  );

  return useQuery({
    queryKey: openOrdersByVendorKey(activeRestaurantId ?? ''),
    queryFn: getOpenOrdersByVendor,
    enabled: !!activeRestaurantId && isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
