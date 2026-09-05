/**
 * delivered-once — the words an order is refused with when it has already
 * arrived, and the set of states that counts as "already arrived".
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * `markDelivered` is the only writer of `procurement_orders.status =
 * 'DELIVERED'` in this gateway (measured 2026-09-05: the two other string
 * literals are a `procurement_conversations.status` and a websocket payload,
 * neither of them the order's own column). Until this pass it read the order,
 * wrote DELIVERED, and booked stock — with no question asked about where the
 * order already was.
 *
 * The refusal that existed was one caller deep. `one-tap-actions.service.ts`
 * carries its own DELIVERED check, at the mint and at the write, and says so in
 * its comment: "`markDelivered` has no already-delivered guard of its own". So
 * the dashboard's sealed one-tap path was safe and every other caller — the
 * `POST /procurement/orders/:id/deliver` route the web Action Center, the
 * Orders desk and the mobile outbox all post to — was not.
 *
 * ===========================================================================
 * WHAT A SECOND DELIVERY ACTUALLY DID — MEASURED, NOT ASSUMED
 * ===========================================================================
 * Measured against `git show HEAD:…/procurement.service.ts` on 2026-09-05. The
 * live stock ledger is NOT double-booked by a second `markDelivered` on the
 * same order: `apply_stock_movement` returns the existing transaction when
 * `p_idempotency_key` has been seen (`20260902150000_lot_cost_truth.sql:149`)
 * and the key is `order-delivered-live:{orderId}`, one per order. Repeating
 * that here would be repeating a claim rather than making one.
 *
 * What the second call DID do, every time:
 *
 *   * `quantity_received` was rewritten to `quantityReceived ?? order.quantity`
 *     — so an order the receiving door had counted 3 of 12 into came back
 *     saying 12 were received, with 3 on the shelf. That column IS the door's
 *     anti-double-book base (`receiving.service.ts:371`) and the number every
 *     receipt figure reads.
 *   * `delivered_at` and `received_by` were overwritten, so when the wine
 *     arrived and who signed for it became whenever it was last tapped and
 *     whoever last tapped it.
 *   * `status` was written backwards: a COMPLETED order (its invoice verified)
 *     and a PARTIALLY_RECEIVED one (a backorder still open) both silently
 *     became DELIVERED again. `order-transitions.ts` forbids exactly that move
 *     for `updateOrder`; `markDelivered` never asked it.
 *   * A second `invoice_received` critical notification was raised once the
 *     24-hour dedupe window had passed.
 *
 * And there IS a real double-book in this family, which is why
 * PARTIALLY_RECEIVED is refused and not only DELIVERED: the receiving door
 * books under `door-receipt:{eventId}` and `markDelivered` books under
 * `order-delivered-live:{orderId}`. Different keys, so nothing dedupes them.
 * Door counts 3 of 12, then somebody taps "mark delivered": 3 + 12 = 15 bottles
 * on a 12-bottle order.
 *
 * ===========================================================================
 * WHY THE SET IS "GOODS HAVE ARRIVED" AND NOT THE WHOLE TABLE
 * ===========================================================================
 * `ORDER_TRANSITIONS` (`order-transitions.ts`, ADR 0125) is the general answer
 * to "may this order move to that state", and `markDelivered` deliberately does
 * NOT enforce all of it. That table permits DELIVERED -> DELIVERED on purpose —
 * a same-state move is legal for any non-terminal state, because `verifyReceipt`
 * and the door legitimately rewrite PARTIALLY_RECEIVED — and it forbids
 * PENDING -> DELIVERED, which the deliver route does today for real orders that
 * were never formally approved. Enforcing the whole table here would refuse
 * work the house does and permit the one thing this pass exists to stop.
 *
 * So the rule is narrower and is about the goods, not the paperwork: an order
 * whose wine has already been counted in is not delivered again. The set is
 * `ORDER_GOODS_ARRIVED_STATUSES`, imported rather than restated, so the rule
 * this file enforces and the rule that stops a cancellation cannot drift.
 */
import { ProcurementOrderStatus } from "./dto/procurement.dto";
import { statusInWords } from "./order-transitions";

/** The `reason` code on the 409 body, so a client can branch without parsing prose. */
export const DELIVERY_REFUSED_ALREADY_ARRIVED = "order_already_delivered";

/** The `reason` code when the stored status is not a state this house knows. */
export const DELIVERY_REFUSED_STATE_UNREADABLE = "order_state_unreadable";

/**
 * When the delivery happened, in words, from a stored timestamp.
 *
 * UTC and explicit about it. A refusal sentence is read in a kitchen and quoted
 * in a support thread; a locale-dependent rendering would make the same event
 * read as two different times to two people, and `toLocaleString` on a server
 * renders in whatever zone the container happens to hold.
 *
 * A missing timestamp is SAID, never filled in. "delivered at an unknown time"
 * is a fact about the record; inventing `new Date()` would be the record
 * claiming knowledge it does not have.
 */
export function deliveredWhenInWords(deliveredAt: string | null): string {
  if (!deliveredAt) return "at a time this order never recorded";
  const at = new Date(deliveredAt);
  if (Number.isNaN(at.getTime()))
    return `at a time this order records as "${deliveredAt}", which is not a date`;
  const iso = at.toISOString();
  return `on ${iso.slice(0, 10)} at ${iso.slice(11, 16)} UTC`;
}

/** How the order is named to a person: its number when it has one, else its id. */
export function orderInWords(
  orderNumber: string | null,
  orderId: string,
): string {
  return orderNumber && orderNumber.trim()
    ? `Order ${orderNumber.trim()}`
    : `The order ${orderId}`;
}

/**
 * The whole sentence a second delivery is refused with.
 *
 * Three states, three different consequences, three different next steps. One
 * sentence for all of them would have to be vague about every one, and a vague
 * refusal is what teaches a person to tap the control again.
 */
export function refuseSecondDelivery(input: {
  orderId: string;
  orderNumber: string | null;
  status: ProcurementOrderStatus;
  deliveredAt: string | null;
  quantityReceived: number | null;
}): string {
  const name = orderInWords(input.orderNumber, input.orderId);
  const when = deliveredWhenInWords(input.deliveredAt);
  const counted =
    input.quantityReceived == null
      ? ""
      : ` ${input.quantityReceived} recorded as received.`;

  if (input.status === ProcurementOrderStatus.PARTIALLY_RECEIVED) {
    return (
      `${name} has already been partly received ${when}.${counted} Marking it ` +
      `delivered now books the WHOLE order into stock on top of what the ` +
      `receiving door has already counted in, because the door and this ` +
      `control book under different keys and nothing reconciles them. Nothing ` +
      `was changed. Count the rest at the receiving door, which adds only the ` +
      `difference.`
    );
  }

  if (input.status === ProcurementOrderStatus.COMPLETED) {
    return (
      `${name} is completed: it was delivered ${when} and its receipt has ` +
      `already been checked against the vendor's invoice.${counted} Marking it ` +
      `delivered again would reopen a closed order and overwrite what was ` +
      `verified. Nothing was changed. If the count or the price was wrong, ` +
      `correct it at the receiving door or raise a vendor credit.`
    );
  }

  return (
    `${name} was already delivered ${when}.${counted} An order is delivered ` +
    `once. Nothing was changed — a second confirmation would restate when the ` +
    `wine arrived and who signed for it, and reset the received count the ` +
    `receiving door measures its own work against. If the count was wrong, ` +
    `correct it at the receiving door; if the invoice disagrees, verify the ` +
    `receipt.`
  );
}

/**
 * The sentence when the conditional UPDATE matched no row.
 *
 * This is the race, and it is stated as the race rather than dressed up as the
 * ordinary refusal: the read said the order was still deliverable and the write
 * found it was not, which means a second delivery landed in between. Saying
 * "already delivered" here would be true by inference but would hide the one
 * fact worth knowing — that two people tapped at once and exactly one of them
 * won.
 */
export function refuseLostDeliveryRace(input: {
  orderId: string;
  orderNumber: string | null;
  status: ProcurementOrderStatus | null;
}): string {
  const name = orderInWords(input.orderNumber, input.orderId);
  const now = input.status
    ? `it now reads ${statusInWords(input.status)}`
    : `its state could not be read back`;
  return (
    `${name} was confirmed delivered by someone else while this confirmation ` +
    `was being written — ${now}, so this one changed nothing and booked no ` +
    `stock. That is the intended outcome of two people confirming the same ` +
    `delivery at once: exactly one of them wins. Reload the order to see what ` +
    `was recorded.`
  );
}
