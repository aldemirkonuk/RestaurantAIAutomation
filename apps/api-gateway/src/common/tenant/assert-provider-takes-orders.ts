import {
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";
import { assertProviderBelongsToRestaurant } from "./assert-provider-belongs-to-restaurant";

/** The reason a removed vendor's order is refused with, for clients that branch on it. */
export const VENDOR_REMOVED = "vendor_removed";

/** True for the refusal `assertProviderTakesOrders` gives a removed vendor, and nothing else. */
export function isVendorRemoved(err: unknown): boolean {
  if (!(err instanceof UnprocessableEntityException)) return false;
  const body = err.getResponse();
  return typeof body === "object" && body !== null && (body as any).reason === VENDOR_REMOVED;
}

/**
 * A REMOVED VENDOR TAKES NO NEW ORDERS (QA round 3b, H3).
 *
 * `assertProviderBelongsToRestaurant` answers "is this vendor this house's?"
 * and nothing else, so a vendor the house had removed on /vendors could still
 * be ordered from: a stale order sheet, Ask-AI's reorder, a recurrence minted
 * after the removal, or a body sent straight to `POST /procurement/orders`.
 * The order was written, the vendor was mailed, and the house paid for goods
 * from a vendor it had stopped dealing with.
 *
 * WHAT "REMOVED" MEANS. `softDeleteProvider` writes `is_active = false` and
 * `deleted_at = now()` together. Either one marks the vendor retired, the same
 * rule `ProvidersService.usualCurrencyCoverage` uses. `is_active` is nullable
 * with `DEFAULT true`, and a NULL there is a live vendor whose flag was never
 * written: `not.is.false` keeps NULL, where `eq.true` would drop it and refuse
 * a vendor that is fine.
 *
 * ONE READ ON THE COMMON PATH. A live vendor of this house is one counted row
 * and the order goes ahead. Only when that count is zero does the house fence
 * run, to tell "not this house's" (404, ADR 0147: the same answer as an id
 * that does not exist) from "this house's, but removed" (422, said in words).
 * A failed read refuses with a 503 on either read; an unanswered question is
 * never a yes (ADR 0051).
 *
 * NOT A LOCK. A vendor removed between this read and the insert still gets
 * that one order. The removal is a person on /vendors, not a race anyone runs,
 * and the order is still PENDING and visible on /orders when it lands.
 */
export async function assertProviderTakesOrders(
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
  const { count: liveVendor, error } = await client
    .from("providers")
    .select("id", { count: "exact", head: true })
    .eq("id", providerId)
    .eq("restaurant_id", restaurantId)
    .is("deleted_at", null)
    .not("is_active", "is", false);
  if (error) {
    logger?.error(`${context} could not confirm the vendor is still the house's`, {
      restaurantId,
      providerId,
      error: error.message,
    });
    throw new ServiceUnavailableException(
      `Could not confirm this vendor is still one of your vendors, so ${refused}. Please try again.`,
    );
  }
  if (liveVendor) return;

  // Not a live vendor of this house. The fence throws its own 404 or 503 when
  // the vendor is not this house's at all; returning means it is, and removed.
  await assertProviderBelongsToRestaurant(
    client,
    restaurantId,
    providerId,
    context,
    refused,
    logger,
  );
  logger?.warn(`${context} refused a vendor the house has removed`, {
    restaurantId,
    providerId,
  });
  throw new UnprocessableEntityException({
    reason: VENDOR_REMOVED,
    message: `This vendor was removed from your vendors, so ${refused}. Choose another vendor.`,
  });
}
