import { NotFoundException } from "@nestjs/common";

/**
 * AN ORDER ID THAT NAMES NO ORDER IS A 404, NOT A SERVER FAULT (QA round 3b, B2).
 *
 * `getOrder` and `updateOrder` read the order with `.single()`, which answers
 * "no row" with a PostgREST ERROR (PGRST116) rather than an empty result. Both
 * threw it as it came, and the controller turned every non-HTTP error into a
 * 500, so a stale deep link, a receiving-door scan of a wrong id or an order
 * another house owns read "something broke" instead of "there is no such
 * order".
 *
 * Two codes mean "no such order" on a read filtered by this house and an id:
 *   - PGRST116: `.single()` matched no row.
 *   - 22P02: the id is not a uuid at all ("abc", a truncated link), so no row
 *     could ever match. The house id comes from the token and is always a
 *     uuid, so on these reads the id is the only text that can fail the cast.
 *
 * Another house's order gets the same answer as a missing one: a 403 would
 * confirm the id exists (ADR 0147).
 */
export function isNoSuchOrder(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST116" || error?.code === "22P02";
}

export const ORDER_NOT_FOUND = "order_not_found";

export function orderNotFound(nothingDone?: string): NotFoundException {
  return new NotFoundException({
    reason: ORDER_NOT_FOUND,
    message: nothingDone
      ? `No order with that id belongs to this restaurant, so ${nothingDone}.`
      : "No order with that id belongs to this restaurant.",
  });
}
