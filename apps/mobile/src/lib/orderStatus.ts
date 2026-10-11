/**
 * What the phone says and shows for each order status — one place, so the
 * list, the row and the order screen cannot disagree. Pure: no native imports.
 *
 * PARTIALLY_RECEIVED (F-589) is the phone's DEFAULT receive path: "Record
 * count — invoice pending" sends no invoice figures, the gateway matches that
 * as `unmatched` and writes PARTIALLY_RECEIVED (procurement.service.ts, the
 * `awaitingInvoice` branch). The phone knew no such status, so a counted truck
 * showed the raw enum, filed under Done, sat on the first timeline dot and
 * offered no way to add the paper.
 */

export const STATUS_LABEL: Record<string, string> = {
  PENDING: "Awaiting approval",
  APPROVAL_NEEDED: "Awaiting approval",
  NEGOTIATING: "Negotiating",
  APPROVED: "Approved",
  CONFIRMED: "Confirmed",
  IN_TRANSIT: "On its way",
  DELIVERED: "Delivered — verify",
  PARTIALLY_RECEIVED: "Counted — invoice to come",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REJECTED: "Rejected",
  FAILED: "Failed",
};

/** Still needs someone: listed under Open, not Done. */
export const OPEN_STATUSES = new Set([
  "PENDING",
  "APPROVAL_NEEDED",
  "NEGOTIATING",
  "APPROVED",
  "CONFIRMED",
  "IN_TRANSIT",
  "DELIVERED",
  "PARTIALLY_RECEIVED",
]);

export const TIMELINE: string[] = [
  "PENDING",
  "APPROVED",
  "CONFIRMED",
  "DELIVERED",
  "PARTIALLY_RECEIVED",
  "COMPLETED",
];

export function timelineIndex(status: string): number {
  if (status === "APPROVAL_NEEDED" || status === "NEGOTIATING") return 0;
  if (status === "IN_TRANSIT") return 2;
  const i = TIMELINE.indexOf(status);
  return i === -1 ? 0 : i;
}

/**
 * The receive button's words, or null when the order is not at the door.
 * Both open the same receive screen: a delivered truck is counted there, and a
 * counted one gets its invoice figures there.
 */
export function receiveActionLabel(status: string): string | null {
  if (status === "DELIVERED") return "Count & verify receipt";
  if (status === "PARTIALLY_RECEIVED") return "Add the invoice";
  return null;
}

/**
 * The delivery mark, carrying the count that came off the truck (F-1182,
 * rehit of F-1126). Sent with no count, the gateway books the whole ordered
 * quantity (`quantityReceived ?? order.quantity`), so a short truck went on
 * the shelf in full. The count is in the order's own unit and rides the query
 * (`procurement.controller.ts` `quantityReceivedInOrderUom`). Null when the
 * count is not a whole number of zero or more: nothing is sent then.
 */
export function deliverWithCountPath(
  orderId: string,
  count: number,
): string | null {
  if (!Number.isSafeInteger(count) || count < 0) return null;
  return `/procurement/orders/${orderId}/deliver?quantityReceivedInOrderUom=${count}`;
}

/** "3 cases", "1 bottle": the order's unit, in words, for a count. */
export function orderUnitWords(
  unitType: string | null | undefined,
  n: number,
): string {
  const raw = String(unitType || "bottle").toLowerCase();
  // "each" is a bottle on this app, as the receive screen counts it.
  const unit = raw === "each" ? "bottle" : raw.replace(/_/g, " ");
  return `${n} ${n === 1 ? unit : `${unit}s`}`;
}
