import { holdsHouseMoney } from "./documents/document-money-gate";
import { OrderListResponseDto, OrderResponseDto } from "./dto/procurement.dto";

/**
 * WHAT AN ORDER READ CARRIES TO A ROLE THAT DOES NOT HOLD THE HOUSE'S MONEY.
 *
 * The founder's rule (DASH-W22, ADR 0145, ADR 0253 as the money-policy audit
 * of 2026-10-07 reads it): staff see counts, names, states and dates, never
 * amounts, and the gateway stops sending them, because a page that only hides
 * them keeps nothing private. `/dashboard` hid the order totals for staff
 * while `GET /procurement/orders/pending` and `/orders/history` still carried
 * them in the payload (F-433).
 *
 * AN ALLOWLIST, NOT A STRIP LIST. A non-holder gets only the keys named
 * below; a key added to `OrderResponseDto` later stays on the server for
 * staff until someone decides it is not money. The figure keys are OMITTED,
 * never null or zero, and the reply says `amountsWithheld: true` (the audit's
 * marker, as `POST /procurement/documents` already sends it), so a page can
 * tell "withheld for your role" from "the order names no total".
 *
 * Left out with the figures: `priceUom` and `pricePackSize` (what the price is
 * stated in says nothing without the price) and the agreement's `allowance`,
 * `deposit` and `freight`. `currency` stays: it names no amount.
 */
const ORDER_KEYS_FOR_EVERY_ROLE = [
  "id",
  "orderNumber",
  "restaurantId",
  "inventoryId",
  "providerId",
  "quantity",
  "unitType",
  "bottlesTotal",
  "status",
  "requestedAt",
  "approvedAt",
  "deliveredAt",
  "completedAt",
  "isEmergency",
  "priorityLevel",
  "wineName",
  "providerName",
  "received",
  "priority",
  "currency",
  "recurrenceFrequency",
  "recurrenceAnchorDay",
  "recurrenceNextDueOn",
  "recurrenceStatus",
  "recurrenceParentOrderId",
  "recurrenceOccurrenceOn",
] as const satisfies ReadonlyArray<keyof OrderResponseDto>;

export type OrderForRole = OrderResponseDto & { amountsWithheld?: true };

/** One order as this role may read it. */
export function orderForRole(
  order: OrderResponseDto,
  role: string | null | undefined,
): OrderForRole {
  if (holdsHouseMoney(role)) return order;
  const kept: Partial<OrderResponseDto> = {};
  for (const key of ORDER_KEYS_FOR_EVERY_ROLE) {
    if (key in order) (kept as any)[key] = order[key];
  }
  return { ...(kept as OrderResponseDto), amountsWithheld: true };
}

/** A page of history as this role may read it: the marker sits at the root. */
export function orderListForRole(
  list: OrderListResponseDto,
  role: string | null | undefined,
): OrderListResponseDto & { amountsWithheld?: true } {
  if (holdsHouseMoney(role)) return list;
  return {
    ...list,
    orders: list.orders.map((o) => {
      const { amountsWithheld: _marker, ...rest } = orderForRole(o, role);
      return rest as OrderResponseDto;
    }),
    amountsWithheld: true,
  };
}

/**
 * An order's letters as this role may read them (F-957, the phone's order
 * screen). Each letter carries the order's quoted price beside the thread;
 * a non-holder gets the letter without it, marked `amountsWithheld`, as the
 * order read itself does. The letters' own words are the vendor's and the
 * house's, and are not cut here.
 */
export function conversationsForRole<T extends Record<string, unknown>>(
  rows: T[],
  role: string | null | undefined,
): Array<Omit<T, "quotedPrice"> & { amountsWithheld?: true }> {
  if (holdsHouseMoney(role)) return rows;
  return rows.map((row) => {
    const { quotedPrice: _price, ...rest } = row;
    return { ...rest, amountsWithheld: true as const };
  });
}
