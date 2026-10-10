import { HttpException, HttpStatus } from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";

/**
 * THE ROW-LEVEL HALF OF TENANT ISOLATION, FOR STORAGE LOCATIONS.
 *
 * The sibling of `assertInventoryBelongsToRestaurant` (beside this file).
 * Every column that points at a zone — `inventory_lots.location_id`,
 * `restaurant_inventory.storage_location_id`, `wine_location_mappings
 * .location_id` — is only a foreign key to `storage_locations(id)`, with no
 * house tie, and the stock RPCs (`transfer_stock`, `record_glass_pour`,
 * `apply_stock_movement`) derive the house from the ITEM, never from the
 * zone. So without this a caller could file its own bottles under another
 * house's zone by naming that zone's id (F-435): the lot lands in house A
 * pointing at house B's shelf, and when B deletes that shelf A's lots quietly
 * go "unassigned".
 *
 * Extracted from `StorageLocationsService.assertLocationIsTheHouses` rather
 * than copied: that was the one place that already refused another house's
 * zone (for mappings), and it now calls this, so there is one implementation.
 *
 * Null, undefined and empty ids are skipped: on every stock path null means
 * "unassigned", which belongs to no house and is always allowed. Several ids
 * are checked in one read, so a bulk write costs one query, not one per line.
 *
 * A FAILED READ REFUSES (ADR 0051 / ADR 0067): an unanswered question is not
 * a yes. A foreign id answers 404, the same as a missing one, so a caller
 * learns nothing about which ids exist in other houses.
 *
 * @param client       The service-role client. There is no RLS on this path;
 *                     the filter in the query IS the isolation.
 * @param restaurantId The caller's own house, from the token or the
 *                     tenant-matched path — never from the request body.
 * @param locationIds  The zone ids the write names.
 * @param context      A short label for the log line. Never shown to the caller.
 * @param opts.liveOnly Also refuse a zone this house has deleted. The mapping
 *                     paths want that; stock paths do not, because a deleted
 *                     zone can still hold lots and moving them out (or pouring
 *                     from them) must keep working.
 */
export async function assertLocationsBelongToRestaurant(
  client: SupabaseClient,
  restaurantId: string,
  locationIds: ReadonlyArray<string | null | undefined>,
  context: string,
  logger?: { error: (m: string) => void; warn: (m: string) => void },
  opts: { liveOnly?: boolean } = {},
): Promise<void> {
  const ids = [...new Set(locationIds.filter((id): id is string => !!id))];
  if (!ids.length) return;

  let query = client
    .from("storage_locations")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .in("id", ids);
  if (opts.liveOnly) query = query.is("deleted_at", null);
  const { data, error } = await query;

  if (error) {
    logger?.error(`${context} location check failed: ${error.message}`);
    throw new HttpException(
      "The location could not be read, so nothing was done.",
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  const owned = new Set(
    ((data as { id: string }[] | null) ?? []).map((r) => r.id),
  );
  const foreign = ids.filter((id) => !owned.has(id));
  if (foreign.length) {
    logger?.warn(
      `${context} rejected a location not of this house: ${foreign.join(", ")}`,
    );
    throw new HttpException(
      "No storage location of this house has that id.",
      HttpStatus.NOT_FOUND,
    );
  }
}
