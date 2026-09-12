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
import { readQuantityReceived } from "./quantity-received-unit";

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

/* ===========================================================================
 * THE EARLIER DELIVERY, CARRIED IN THE REFUSAL
 * ===========================================================================
 * Founder, 2026-09-05 (batch 46), on whether a second delivery is 400 or 409:
 *
 *   *"A second delivery of an already-delivered order answers 409 Conflict,
 *   not 400 — the request is well-formed, the order's state conflicts with it,
 *   and the door and the one-tap rail must be able to tell 'already done' from
 *   'you sent nonsense' and show the earlier delivery instead of an error."*
 *
 * **400 was rejected.** The distinction is not pedantry about status codes: a
 * client cannot render *"delivered on the 4th by Ada"* from a 400, because a 400
 * says the request was malformed and the only honest response to one is to stop
 * and show an error. 409 says the request was fine and the world has moved, and
 * the world it has moved to is exactly what the person wanted to know. So the
 * status carries the distinction and the BODY carries the answer — a refusal
 * that says only "no" makes the receiver walk to a manager to find out whether
 * the wine is on the shelf.
 *
 * Every field below is a fact off the order row. Nothing is derived, defaulted
 * or filled in: a `null` here means the row holds nothing, and the ONE case
 * where "we could not find out" differs from "there is nothing" —
 * `receivedByName` — carries its own reason rather than reading as an absence.
 */
export interface EarlierDelivery {
  /** When it was booked in. `null` = the row records no time. */
  deliveredAt: string | null;
  /** Who signed for it, as `public.users.user_id`. `null` = nobody recorded. */
  receivedBy: string | null;
  /**
   * That person's name.
   *
   * `null` covers two DIFFERENT things and they must not be confused, which is
   * why `receivedByNameReason` exists: either there is no `receivedBy` at all,
   * or there is one and the lookup could not answer. A page that printed
   * "by nobody" for the second would be reporting a failed read as a fact —
   * [[absence-reported-as-health]] on the one line a receiver reads.
   */
  receivedByName: string | null;
  /** Why no name, when one was wanted. `null` when the question did not arise. */
  receivedByNameReason: string | null;
  /** How much was booked. Meaningless without `unitType`; see below. */
  quantityReceived: number | null;
  /**
   * The unit `quantityReceived` is stated in — **or `null`, which is a refusal
   * and never a default**.
   *
   * `procurement_orders.quantity_received` has four writers and they do not
   * agree: three write the order's own unit, and `recordDoorReceipt` writes
   * BOTTLES. Nothing on the row records which one wrote it. For a
   * non-multiplying unit both produce the same number, so it can be stated; for
   * `case`, `pack` or `split_case` the two differ by the pack size and every
   * answer is a guess, so this is `null` and `quantityUnitWhy` says so. That
   * rule is `quantity-received-unit.ts` `readQuantityReceived`, IMPORTED rather
   * than restated — an earlier draft of this file printed "5 cases (60 bottles)"
   * off the order's `unit_type` alone, which is exactly the silent
   * multiplication ADR 0011 forbids.
   */
  unitType: string | null;
  /** Why the unit is, or is not, stated. Always present. */
  quantityUnitWhy: string;
  /** Bottles in the whole ORDER (`bottles_total`) — a different fact from the count. */
  bottlesTotal: number | null;
  /** The one line every surface prints, so four surfaces cannot word it four ways. */
  summary: string;
}

/**
 * "12 bottles", or nothing at all.
 *
 * NOTHING is printed when the unit could not be placed. A count under a guessed
 * unit is worse than no count: "5" read as cases when the door meant bottles is
 * off by the pack size, and a receiver acts on it. The refusal travels instead,
 * in `quantityUnitWhy`, which the summary defers to.
 */
export function quantityInWords(
  quantityReceived: number | null,
  unitType: string | null,
): string | null {
  if (quantityReceived == null || !Number.isFinite(quantityReceived)) return null;
  if (!unitType) return null;
  return `${quantityReceived} ${unitType}${quantityReceived === 1 ? "" : "s"}`;
}

/**
 * The one line a page prints in place of an error: who took it in, and when.
 *
 * Deliberately says *"by someone this house could not look up"* rather than
 * dropping the clause when the name read failed. A dropped clause is
 * indistinguishable from an order nobody signed for, and the two are not the
 * same fact.
 */
export function describeEarlierDelivery(input: {
  deliveredAt: string | null;
  receivedBy: string | null;
  receivedByName: string | null;
  quantityReceived: number | null;
  unitType: string | null;
}): string {
  const when = deliveredWhenInWords(input.deliveredAt);
  const who = input.receivedByName
    ? ` by ${input.receivedByName}`
    : input.receivedBy
      ? " by someone this house could not look up"
      : " — the record names nobody";
  const what = quantityInWords(input.quantityReceived, input.unitType);
  return `Delivered ${when}${who}${what ? `, ${what} booked in` : ""}.`;
}

/**
 * Build the body a caller renders, from one `procurement_orders` row.
 *
 * Pure. Two things are resolved OUTSIDE it and passed in, for opposite reasons:
 * the receiver's name needs a database read (`resolveReceiverName`), and the
 * count's unit needs the house's one reading of a column with four disagreeing
 * writers — `readQuantityReceived`, called here rather than reimplemented.
 */
export function earlierDeliveryOf(input: {
  deliveredAt: string | null;
  receivedBy: string | null;
  receivedByName: string | null;
  receivedByNameReason: string | null;
  /** The RAW column value and the order's RAW `unit_type`. Read, never guessed. */
  quantityReceived: unknown;
  unitType: string | null;
  bottlesTotal: number | null;
}): EarlierDelivery {
  const reading = readQuantityReceived(input.quantityReceived, input.unitType);
  return {
    deliveredAt: input.deliveredAt,
    receivedBy: input.receivedBy,
    receivedByName: input.receivedByName,
    receivedByNameReason: input.receivedByNameReason,
    quantityReceived: reading.quantity,
    unitType: reading.uom,
    quantityUnitWhy: reading.why,
    bottlesTotal: input.bottlesTotal,
    summary: describeEarlierDelivery({
      deliveredAt: input.deliveredAt,
      receivedBy: input.receivedBy,
      receivedByName: input.receivedByName,
      quantityReceived: reading.quantity,
      unitType: reading.uom,
    }),
  };
}

/**
 * The minimum a supabase client has to look like to name a receiver.
 *
 * Structural, so this module stays free of Nest and of `DatabaseService`, and so
 * the resolver can be tested with an object literal rather than a service mock.
 */
export interface ReceiverNameReader {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): { maybeSingle(): Promise<{ data: any; error: any }> };
    };
  };
}

/**
 * Name the person who took the delivery in.
 *
 * `users.user_id` / `users.name` is the house idiom for this
 * (`vendor-terms.service.ts` `resolveActors`, `approval-thresholds.service.ts`),
 * and `auth.users` is a DISJOINT table — `received_by` holds a
 * `public.users.user_id`, which is what the JWT carries.
 *
 * A FAILED READ IS REPORTED, NEVER RETURNED AS "no name". supabase-js resolves
 * `{ data, error }` and never throws, so an unreadable `users` table arrives as
 * a populated `error` with `data` null — the exact shape of "this user does not
 * exist". The two are told apart here and the difference survives into the body.
 */
export async function resolveReceiverName(
  client: ReceiverNameReader,
  receivedBy: string | null,
): Promise<{ name: string | null; reason: string | null }> {
  if (!receivedBy) return { name: null, reason: null };
  try {
    const { data, error } = await client
      .from("users")
      .select("user_id, name")
      .eq("user_id", receivedBy)
      .maybeSingle();
    if (error)
      return {
        name: null,
        reason: `the people register could not be read (${error.message})`,
      };
    const name = (data as { name?: string | null } | null)?.name ?? null;
    return name
      ? { name, reason: null }
      : { name: null, reason: "this house holds no name for that person" };
  } catch (err: any) {
    return {
      name: null,
      reason: `the people register could not be read (${err?.message ?? String(err)})`,
    };
  }
}
