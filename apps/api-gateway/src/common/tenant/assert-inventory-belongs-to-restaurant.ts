import {
  ForbiddenException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";

/**
 * THE ROW-LEVEL HALF OF TENANT ISOLATION, FOR STOCK.
 *
 * `assertTenantMatch` (beside this file) compares the restaurant the REQUEST
 * names against the restaurant the token carries. It cannot see this class of
 * violation at all: a request that names no restaurant, or names its own, and
 * carries an INVENTORY ID belonging to a different house passes it untouched.
 *
 * That gap mattered because `public.apply_stock_movement` derived
 * `restaurant_id` from the inventory row it was pointed at, not from the
 * caller — so an unchecked id wrote stock wherever that id happened to live,
 * with the gateway's service-role key and no RLS in the way (ADR 0141).
 *
 * This is `procurement.service.ts#applyReceiptAdjustment`'s check, extracted
 * rather than re-invented: it was already the one place in this repo that
 * proved an inventory id belonged to the caller before moving stock, and its
 * two refusals — a failed read is not a permission, a foreign id is a 403 —
 * are the shape every other stock path needed. `applyReceiptAdjustment` now
 * calls this, so there is exactly one implementation.
 *
 * A FAILED READ REFUSES. supabase-js resolves `{ data, error }` rather than
 * throwing, so a dropped connection, a timeout or a schema error arrives as an
 * `error` with `data === null`. Falling through on that would report the
 * ABSENCE of an answer as a yes — the standing fault of this codebase
 * (ADR 0051 / ADR 0067) — and here it would report it as permission to write
 * into a house we could not confirm.
 *
 * @param client      The service-role client. There is no RLS on this path;
 *                    the filter in the query IS the isolation.
 * @param restaurantId The caller's own restaurant, from the authenticated
 *                    token — never from the request body.
 * @param inventoryId The item the movement names.
 * @param context     A short label for the log line, e.g. `createTransaction`.
 *                    Never rendered to the caller.
 */
export async function assertInventoryBelongsToRestaurant(
  client: SupabaseClient,
  restaurantId: string,
  inventoryId: string,
  context: string,
  logger?: { error: (m: string) => void; warn: (m: string) => void },
): Promise<void> {
  const { data: owned, error: ownershipError } = await client
    .from("restaurant_inventory")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("id", inventoryId)
    .maybeSingle();

  if (ownershipError) {
    logger?.error(
      `${context} ownership check failed for ${inventoryId}: ${ownershipError.message}`,
    );
    throw new UnprocessableEntityException(
      `Could not confirm that item ${inventoryId} belongs to this restaurant, ` +
        `so no stock was moved: ${ownershipError.message}`,
    );
  }

  if (!owned) {
    logger?.warn(`${context} rejected a foreign inventory id: ${inventoryId}`);
    throw new ForbiddenException(
      `Item ${inventoryId} does not belong to this restaurant. ` +
        `A stock movement can only move this restaurant's own ` +
        `inventory, so nothing was written.`,
    );
  }
}
