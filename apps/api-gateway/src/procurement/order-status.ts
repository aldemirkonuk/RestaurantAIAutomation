/**
 * The one place that decides which `procurement_orders.status` values mean
 * "this order arrived".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `procurement_orders.status` is written from `ProcurementOrderStatus`, whose
 * members are UPPERCASE. Nine read sites across analytics, dashboard and goals
 * compared the column to the lowercase string `"delivered"`. No row has ever
 * matched. Every vendor scorecard, lead-time statistic, on-time rate, HHI,
 * spend total, spend-by-month, bottles-delivered figure and the goals engine's
 * purchase-spend series read a STRUCTURAL ZERO — not "no data yet", but a
 * number that could never be anything else, rendered as though it were
 * measured. See ADR 0058.
 *
 * The fix is not "spell it uppercase at nine call sites". It is that no call
 * site should be spelling it at all: the sets below are the vocabulary, and
 * `scripts/check_order_status_literals.py` fails the build when a status
 * literal reappears in application code.
 *
 * WHY THREE SETS AND NOT ONE
 * --------------------------
 * "Delivered" is not one question. The three sets differ ONLY in how they treat
 * `PARTIALLY_RECEIVED`, and that difference is deliberate — see each set.
 */
import { ProcurementOrderStatus } from "./dto/procurement.dto";

/**
 * A delivery physically happened: the truck came, someone counted at the door,
 * and `delivered_at` is a real timestamp.
 *
 * INCLUDES `PARTIALLY_RECEIVED`. A short delivery still arrived — the door
 * event happened and its timing is exactly what a lead-time or on-time
 * measurement is asking about. Excluding it would silently drop a vendor's
 * worst deliveries from its own punctuality score, which is the subset most
 * worth measuring.
 *
 * Use for: lead time (mean/median/p90/stdev), on-time rate, delivery-timing
 * vendor scorecards — anything keyed on `delivered_at`.
 */
export const ORDER_ARRIVED_STATUSES: readonly ProcurementOrderStatus[] = [
  ProcurementOrderStatus.DELIVERED,
  ProcurementOrderStatus.PARTIALLY_RECEIVED,
  ProcurementOrderStatus.COMPLETED,
] as const;

/**
 * The order's money and quantity columns are FINAL and describe what was
 * actually received.
 *
 * EXCLUDES `PARTIALLY_RECEIVED`, and this is the one genuine judgement call in
 * this file. A partially-received order has physically arrived, so it is in
 * `ORDER_ARRIVED_STATUSES` — but its `final_price`, `total_cost`,
 * `bottles_total` and `quantity` columns still describe the PURCHASE ORDER,
 * not the short delivery, because the remainder stays open as a backorder
 * (see the enum member's own docstring). Counting such a row here would add
 * the full PO value for a partial shipment, overstating every spend, cashflow
 * and bottle-count figure by the backordered remainder.
 *
 * So the choice is between understating by goods-received-on-open-backorders
 * and overstating by goods-ordered-but-never-delivered. For a money figure the
 * founder reads as fact, understating is the safer error, and it self-corrects:
 * the order moves to `COMPLETED` once the three-way match closes it, at which
 * point its figures ARE final and it counts here.
 *
 * Use for: spend totals, spend-by-month, cashflow, bottles delivered,
 * purchase-spend goals.
 */
export const ORDER_SPEND_STATUSES: readonly ProcurementOrderStatus[] = [
  ProcurementOrderStatus.DELIVERED,
  ProcurementOrderStatus.COMPLETED,
] as const;

/**
 * The order is closed. Nothing further will be negotiated, chased, received or
 * paid, and it must not be offered as a live thing to act on.
 *
 * Use for: "is this order still actionable" gates — Ask AI candidate lists,
 * vendor-reply drafting guards.
 */
export const ORDER_CLOSED_STATUSES: readonly ProcurementOrderStatus[] = [
  ProcurementOrderStatus.DELIVERED,
  ProcurementOrderStatus.COMPLETED,
  ProcurementOrderStatus.CANCELLED,
  ProcurementOrderStatus.REJECTED,
  ProcurementOrderStatus.FAILED,
] as const;

/**
 * The order has been placed with the vendor and is on its way, but has not
 * arrived. Used by delivery-reminder scheduling.
 */
export const ORDER_IN_FLIGHT_STATUSES: readonly ProcurementOrderStatus[] = [
  ProcurementOrderStatus.CONFIRMED,
  ProcurementOrderStatus.IN_TRANSIT,
] as const;

/**
 * The order is waiting on a human before it can go to the vendor.
 */
export const ORDER_AWAITING_APPROVAL_STATUSES: readonly ProcurementOrderStatus[] =
  [
    ProcurementOrderStatus.PENDING,
    ProcurementOrderStatus.APPROVAL_NEEDED,
  ] as const;

/**
 * Placed and not yet arrived — what the dashboard calls "in transit".
 */
export const ORDER_OPEN_WITH_VENDOR_STATUSES: readonly ProcurementOrderStatus[] =
  [
    ProcurementOrderStatus.CONFIRMED,
    ProcurementOrderStatus.IN_TRANSIT,
  ] as const;

/**
 * Anything not yet resolved: still needs approval, or is out with the vendor.
 * Used by the reorder/overdue widget.
 */
export const ORDER_OUTSTANDING_STATUSES: readonly ProcurementOrderStatus[] = [
  ProcurementOrderStatus.PENDING,
  ProcurementOrderStatus.APPROVAL_NEEDED,
  ProcurementOrderStatus.CONFIRMED,
  ProcurementOrderStatus.IN_TRANSIT,
] as const;

/** Membership test that survives `status` being typed as `string | null`. */
export function hasStatus(
  status: string | null | undefined,
  set: readonly ProcurementOrderStatus[],
): boolean {
  return status != null && (set as readonly string[]).includes(status);
}

/**
 * Render a set for PostgREST's `in`/`not.in` filters, which take a
 * parenthesised, comma-separated list: `("DELIVERED","COMPLETED")`.
 */
export function toPostgrestInList(
  set: readonly ProcurementOrderStatus[],
): string {
  return `(${set.map((s) => `"${s}"`).join(",")})`;
}
