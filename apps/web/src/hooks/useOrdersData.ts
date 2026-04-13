/**
 * Orders Data Hook (Bridge to TanStack Query)
 *
 * This hook maintains the legacy return shape expected by Orders.tsx, Dashboard,
 * and other consumers, but internally delegates to the TanStack Query hooks in
 * hooks/queries/useOrderQueries.ts for:
 *  - Automatic cache dedup & stale-while-revalidate
 *  - Background refetch on WebSocket events
 *  - Optimistic mutations
 *
 * Consumers see the exact same interface — no migration needed.
 */

import type { Order, OrderStatus, CreateOrderRequest } from '../services/api/types';
import {
  useOrders,
  usePendingOrders,
  useCreateOrder,
  useApproveOrder,
  useCancelOrder,
  useMarkOrderDelivered,
} from './queries/useOrderQueries';

export interface UseOrdersOptions {
  status?: OrderStatus;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export interface UseOrdersResult {
  orders: Order[];
  pendingOrders: Order[];
  pendingCount: number;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createOrder: (data: CreateOrderRequest) => Promise<Order>;
  approveOrder: (orderId: string) => Promise<Order>;
  cancelOrder: (orderId: string, reason?: string) => Promise<Order>;
  markDelivered: (orderId: string, notes?: string) => Promise<Order>;
}

export function useOrdersData(options: UseOrdersOptions = {}): UseOrdersResult {
  const { status } = options;

  const ordersQuery = useOrders(status ? { status } : undefined);
  const pendingQuery = usePendingOrders();
  const createMutation = useCreateOrder();
  const approveMutation = useApproveOrder();
  const cancelMutation = useCancelOrder();
  const deliverMutation = useMarkOrderDelivered();

  const refetch = async () => {
    await Promise.all([ordersQuery.refetch(), pendingQuery.refetch()]);
  };

  const createOrder = async (data: CreateOrderRequest): Promise<Order> => {
    return createMutation.mutateAsync(data);
  };

  const approveOrder = async (orderId: string): Promise<Order> => {
    return approveMutation.mutateAsync(orderId);
  };

  const cancelOrder = async (orderId: string, reason?: string): Promise<Order> => {
    return cancelMutation.mutateAsync({ orderId, reason });
  };

  const markDelivered = async (orderId: string, notes?: string): Promise<Order> => {
    return deliverMutation.mutateAsync({ orderId, notes });
  };

  return {
    orders: ordersQuery.data || [],
    pendingOrders: pendingQuery.data || [],
    pendingCount: pendingQuery.data?.length || 0,
    isLoading: ordersQuery.isLoading,
    error: ordersQuery.error?.message || null,
    refetch,
    createOrder,
    approveOrder,
    cancelOrder,
    markDelivered,
  };
}
