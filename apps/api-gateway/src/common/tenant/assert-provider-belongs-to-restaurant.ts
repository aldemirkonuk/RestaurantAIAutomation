import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";

/**
 * THE VENDOR A REQUEST NAMES IS THIS HOUSE'S (ADR 0147, ADR 0221).
 *
 * `ProcurementService.createOrder`'s vendor fence, moved here with the same
 * query, logs and answers so a second caller uses the same check instead of
 * a copy (ADR 0249).
 * `assertInventoryBelongsToRestaurant`, beside this file, is the same move for
 * the inventory item (ADR 0141).
 *
 * The rule: a `providers` row counts only when its `restaurant_id` is the
 * caller's house. Each house owns its vendor rows, and a row with no house is
 * an orphan that no house sees (ADR 0221). Another house's vendor, a vendor
 * row with no house and an id that does not exist all get the same 404,
 * "Vendor not found", because a 403 would confirm the id exists (ADR 0147).
 *
 * A FAILED READ REFUSES with a 503. supabase-js resolves `{ count, error }`
 * rather than throwing, so a failed read arrives as an `error`; reading it as
 * a yes would be the absence-reported-as-health fault (ADR 0051).
 *
 * @param client       The service-role client. There is no RLS on this path;
 *                     the two filters ARE the isolation.
 * @param restaurantId The caller's house, from the token, never from a body.
 * @param providerId   The vendor the request names.
 * @param context      A short label for the log line, e.g. `createOrder`.
 * @param refused      What did not happen, ending the 503 sentence: "so
 *                     <refused>." For example "no order was placed".
 */
export async function assertProviderBelongsToRestaurant(
  client: SupabaseClient,
  restaurantId: string,
  providerId: string,
  context: string,
  refused: string,
  logger?: {
    error: (m: string, meta?: unknown) => void;
    warn: (m: string, meta?: unknown) => void;
  },
): Promise<void> {
  const { count: ownVendor, error: vendorError } = await client
    .from("providers")
    .select("id", { count: "exact", head: true })
    .eq("id", providerId)
    .eq("restaurant_id", restaurantId);
  if (vendorError) {
    logger?.error(`${context} could not confirm the vendor's house`, {
      restaurantId,
      providerId,
      error: vendorError.message,
    });
    throw new ServiceUnavailableException(
      `Could not confirm this vendor belongs to this restaurant, so ${refused}. Please try again.`,
    );
  }
  if (!ownVendor) {
    logger?.warn(`${context} refused a vendor that is not this house's`, {
      restaurantId,
      providerId,
    });
    throw new NotFoundException("Vendor not found");
  }
}
