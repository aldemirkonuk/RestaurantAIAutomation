import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";

/**
 * THE ORDER A REQUEST NAMES IS THIS HOUSE'S (ADR 0147).
 *
 * `assertProviderBelongsToRestaurant`, beside this file, is the same check for
 * the vendor, with the same answers. `ConversationsService.assertOrderInHouse`
 * makes this read for the by-order routes; this copy is for the write paths
 * that store an order id taken from a request body (F-309: document intake,
 * the door count and a new delivery).
 *
 * The rule: `procurement_orders.restaurant_id` is NOT NULL, so an order is
 * one house's. Another house's order and an id that does not exist get the
 * same 404, "Order not found", because a 403 would confirm the id exists.
 *
 * A FAILED READ REFUSES with a 503. supabase-js resolves `{ count, error }`
 * rather than throwing; reading an error as a yes would be the
 * absence-reported-as-health fault (ADR 0051).
 *
 * @param client       The service-role client. There is no RLS on this path;
 *                     the two filters ARE the isolation.
 * @param restaurantId The caller's house, from the token, never from a body.
 * @param orderId      The order the request names.
 * @param context      A short label for the log line, e.g. `createDelivery`.
 * @param refused      What did not happen, ending the 503 sentence: "so
 *                     <refused>." For example "the delivery was not saved".
 */
export async function assertOrderBelongsToRestaurant(
  client: SupabaseClient,
  restaurantId: string,
  orderId: string,
  context: string,
  refused: string,
  logger?: {
    error: (m: string, meta?: unknown) => void;
    warn: (m: string, meta?: unknown) => void;
  },
): Promise<void> {
  const { count: ownOrder, error: orderError } = await client
    .from("procurement_orders")
    .select("id", { count: "exact", head: true })
    .eq("id", orderId)
    .eq("restaurant_id", restaurantId);
  if (orderError) {
    logger?.error(`${context} could not confirm the order's house`, {
      restaurantId,
      orderId,
      error: orderError.message,
    });
    throw new ServiceUnavailableException(
      `Could not confirm this order belongs to this restaurant, so ${refused}. Please try again.`,
    );
  }
  if (!ownOrder) {
    logger?.warn(`${context} refused an order that is not this house's`, {
      restaurantId,
      orderId,
    });
    throw new NotFoundException("Order not found");
  }
}
