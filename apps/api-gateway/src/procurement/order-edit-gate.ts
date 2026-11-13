import { ProcurementOrderStatus } from "./dto/procurement.dto";
import {
  ORDER_GOODS_ARRIVED_STATUSES,
  ORDER_TERMINAL_STATUSES,
  statusInWords,
} from "./order-transitions";

/**
 * WHAT `PATCH /procurement/orders/:id` MAY STILL DO, AFTER ADR 0254 RULES 1-3.
 *
 * ADR 0254 rule 4 (founder, 2026-10-01, *"Owner, manager or given
 * (Recommended)"*): moving an approved order on needs an owner, a manager or
 * someone given the right, and "delivered" comes only from receiving at the
 * door. Rules 1-3 shipped on `fix/order-patch-cannot-approve`; rule 4 was
 * named "the next fix". This is it, plus the r25 brief's "no edits to a
 * received or closed order" (QA round 3b, H4).
 *
 * No page calls this route (measured 2026-11-13: `updateOrder` and
 * `updateOrderStatus` in apps/web/src/services/api/orders.ts are imported by
 * nothing; mobile never PATCHes an order), so nothing a person does today is
 * refused. The rules close what the route allows.
 *
 * "Someone given the right" is read as a live `vendor_send` grant: the only
 * right an owner can give today (`authority_grants.scope`), and the one that
 * already decides who may place an order with a vendor in one hold.
 */

/** Statuses another act writes. A PATCH naming one is refused with that act's name. */
export const STATUS_OWNED_BY_AN_ACT: Partial<Record<ProcurementOrderStatus, string>> = {
  [ProcurementOrderStatus.DELIVERED]:
    "A delivery is recorded at the receiving door, which books what arrived into stock, not by editing the order's status. Nothing was changed.",
  [ProcurementOrderStatus.PARTIALLY_RECEIVED]:
    "A delivery is recorded at the receiving door, which books what arrived into stock, not by editing the order's status. Nothing was changed.",
  [ProcurementOrderStatus.COMPLETED]:
    "An order is completed when its delivery is checked against it, not by editing its status. Nothing was changed.",
};

/** Arrived or closed: nothing on the order is edited through this route. */
export const ORDER_CLOSED_TO_EDITS: readonly ProcurementOrderStatus[] = Array.from(
  new Set([...ORDER_GOODS_ARRIVED_STATUSES, ...ORDER_TERMINAL_STATUSES]),
);

/** An approved order, on its way: a status move from here needs the right (rule 4). */
export const ORDER_MOVED_ON_BY_AUTHORITY_FROM: readonly ProcurementOrderStatus[] = [
  ProcurementOrderStatus.APPROVED,
  ProcurementOrderStatus.CONFIRMED,
  ProcurementOrderStatus.IN_TRANSIT,
];

export function refuseEditOfClosedOrder(status: ProcurementOrderStatus): string {
  return ORDER_GOODS_ARRIVED_STATUSES.includes(status)
    ? `This order is ${statusInWords(status)}, so it is no longer edited. What arrived is recorded at the receiving door and what it cost when the delivery is checked. Nothing was changed.`
    : `This order is ${statusInWords(status)}, so it is no longer edited. Nothing was changed.`;
}

export const MOVING_ON_NEEDS_THE_RIGHT =
  "Moving an approved order on takes an owner, a manager or someone an owner has given the right to send to vendors. Nothing was changed.";

export const CLOSED_WHILE_EDITING =
  "This order was received or closed while it was being edited, so it was not changed. Open it again to see where it is.";
