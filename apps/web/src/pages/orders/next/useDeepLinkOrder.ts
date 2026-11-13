/**
 * A link INTO one order (`/orders/:id`, `?order=`) whose order is not among
 * the rows the ledger loaded. The ledger reads one page (the gateway's 50
 * newest), so "not loaded here" alone cannot say whether the order exists.
 * The gateway can: `GET /procurement/orders/:id` answers a missing order, or
 * another house's, with ONE 404 whose `reason` is `order_not_found` (#1284,
 * #1331; another house's order gets the same answer, ADR 0147). So the page
 * asks it once, and only says "no such order" on that exact answer.
 *
 * r29 walk, finding 2 (2026-11-13): the banner said the order "may exist
 * further back, or belong to a different house" for an id the gateway would
 * have called missing outright.
 */
import { useQuery } from '@tanstack/react-query';
import { getOrder } from '@/services/api/orders';
import { getErrorMessage, getErrorStatus } from '@/services/api/client';

export type DeepLinkLookup =
  /** The one read is in flight. */
  | { kind: 'looking' }
  /** The gateway's definite 404 (`order_not_found`): no order with this id is this house's. */
  | { kind: 'none' }
  /** The order is this house's, just older than the loaded page. */
  | { kind: 'older'; orderNumber: string | null }
  /** The read failed some other way (a 5xx, no answer, a 404 with no reason): nothing is known. */
  | { kind: 'unread'; why: string };

type Answer = { kind: 'none' } | { kind: 'older'; orderNumber: string | null };

/** Exported for the test: only this exact answer means "no such order". */
export function isOrderNotFound(error: unknown): boolean {
  if (getErrorStatus(error) !== 404) return false;
  const body = (error as { response?: { data?: { reason?: unknown } } })?.response?.data;
  return body?.reason === 'order_not_found';
}

export function useDeepLinkOrder(orderId: string | null, enabled: boolean): DeepLinkLookup | null {
  const on = enabled && Boolean(orderId);
  const q = useQuery<Answer>({
    queryKey: ['orders', 'deep-link', orderId],
    enabled: on,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const order = await getOrder(orderId as string);
        const n = (order as { orderNumber?: unknown } | null)?.orderNumber;
        return { kind: 'older', orderNumber: typeof n === 'string' && n.trim() ? n : null };
      } catch (error) {
        if (isOrderNotFound(error)) return { kind: 'none' };
        throw error;
      }
    },
  });
  if (!on) return null;
  if (q.isError) return { kind: 'unread', why: getErrorMessage(q.error) };
  if (!q.data) return { kind: 'looking' };
  return q.data;
}
