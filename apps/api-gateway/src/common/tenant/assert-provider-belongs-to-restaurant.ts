import {
  ForbiddenException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";

/**
 * THE ROW-LEVEL HALF OF TENANT ISOLATION, FOR VENDORS.
 *
 * The vendor twin of `assertInventoryBelongsToRestaurant` (beside this file),
 * with the same two refusals for the same reasons.
 *
 * `procurement.service.ts#createOrder` took `dto.providerId` from the request
 * body and wrote it onto `procurement_orders.provider_id` without asking whose
 * vendor it was. The gateway's service-role key has no RLS in the way, so an
 * order could be booked against another house's vendor row — and every path
 * that later reads the order's vendor (the draft to the vendor, the deal
 * confirmation email to `providers.contact_email`, the price register) would
 * then act on a vendor this house does not own. `createRetroactiveOrder`
 * checked this for its own route (ADR 0147) and said in a comment that
 * `createOrder` never did; this is that check, moved to where every caller
 * passes through it.
 *
 * Each house owns its own vendor rows (founder, 2026-09-25, item 11), so a row
 * with no house is no house's vendor and is refused like a foreign one.
 *
 * A FAILED READ REFUSES. supabase-js resolves `{ data, error }` rather than
 * throwing; falling through on an `error` would report the absence of an answer
 * as permission (ADR 0051 / ADR 0067).
 *
 * A missing id and another house's id answer the same 403, so the refusal
 * cannot be used to learn whether an id exists elsewhere.
 *
 * @param client       The service-role client. The filter IS the isolation.
 * @param restaurantId The caller's own restaurant, from the token — never the body.
 * @param providerId   The vendor the write names.
 * @param context      A short label for the log line. Never rendered to the caller.
 */
export async function assertProviderBelongsToRestaurant(
  client: SupabaseClient,
  restaurantId: string,
  providerId: string,
  context: string,
  logger?: { error: (m: string) => void; warn: (m: string) => void },
): Promise<void> {
  const { data: owned, error: ownershipError } = await client
    .from("providers")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("id", providerId)
    .maybeSingle();

  if (ownershipError) {
    logger?.error(
      `${context} vendor ownership check failed for ${providerId}: ${ownershipError.message}`,
    );
    throw new UnprocessableEntityException(
      `Could not confirm that vendor ${providerId} belongs to this restaurant, ` +
        `so nothing was written: ${ownershipError.message}`,
    );
  }

  if (!owned) {
    logger?.warn(`${context} rejected a foreign vendor id: ${providerId}`);
    throw new ForbiddenException(
      `Vendor ${providerId} does not belong to this restaurant. ` +
        `An order can only be placed with this restaurant's own vendors, ` +
        `so nothing was written.`,
    );
  }
}
