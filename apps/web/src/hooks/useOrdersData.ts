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
 * =============================================================================
 * MEASURED 2026-09-04: THIS HOOK HAS NO CONSUMERS.
 * =============================================================================
 * `grep -rn useOrdersData apps packages` finds exactly two live references: the
 * barrel re-export in `hooks/index.ts:9` and this definition. `pages/Orders.tsx`
 * uses `pages/orders/useOrdersPage.ts` and posted `/approve` through `apiClient`
 * directly; nothing imports this. ADR 0116's addendum said the legacy page
 * approved "via `hooks/useOrdersData.ts`" — that sentence was wrong, and the
 * addendum is corrected in the same pass that wrote this comment.
 *
 * It is still given the seal rather than deleted: the surface is exported, and
 * an exported approve that sends no seal is a refusal waiting for whoever
 * imports it next.
 *
 * =============================================================================
 * THE SEAL IS REDEEMED, NOT ASSERTED (founder, 2026-09-04; ADR 0116 addendum)
 * =============================================================================
 * `approveOrder` therefore takes the challenge minted when the gesture BEGAN,
 * and `mintOrderSeal` is exposed beside it so a caller has the whole path from
 * one hook. Calling `approveOrder` with no challenge still compiles and is
 * still refused by the gateway, in words — that refusal is the honest outcome
 * and must not be papered over by minting here: a token this call fetched for
 * itself is the assertion model with extra steps.
 */

import type { Order, OrderStatus, CreateOrderRequest } from '../services/api/types';
import { mintOrderSeal } from '../services/api/orders';
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
  /**
   * Mint the one-time seal the approval has to carry back — when the gesture
   * BEGINS, never at the moment of approval.
   */
  mintOrderSeal: (orderId: string) => Promise<string | null>;
  approveOrder: (orderId: string, challenge?: string | null) => Promise<Order>;
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

  const approveOrder = async (
    orderId: string,
    challenge?: string | null,
  ): Promise<Order> => {
    return approveMutation.mutateAsync({ orderId, challenge: challenge ?? null });
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
    mintOrderSeal,
    approveOrder,
    cancelOrder,
    markDelivered,
  };
}
