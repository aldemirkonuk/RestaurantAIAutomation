import type { FeedItem } from "@/api/types";

/**
 * The "Counts match" tap's request for a receipt card, or null when the card
 * names no order (F-372). An `invoice_received` notice can arrive with no
 * order id; posting it would hit `/procurement/orders/undefined/verify-receipt`.
 * With no order there is nothing to verify, so the card only clears.
 */
export function countsMatchRequest(
  item: Pick<FeedItem, "orderId">,
): { path: string; body: { adjustments: [] } } | null {
  if (!item.orderId) return null;
  return {
    path: `/procurement/orders/${item.orderId}/verify-receipt`,
    body: { adjustments: [] },
  };
}
