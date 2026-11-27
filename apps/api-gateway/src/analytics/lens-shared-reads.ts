/**
 * One read per house, per read shape, per 30 seconds, for the /reports lenses.
 *
 * Same rules as consumption-read-shared.ts (#2135), generalised: callers that
 * arrive while a read is in flight wait on it (singleflight), a read that
 * answered is kept for `LENS_MEMO_MS`, and
 *   - a failure is NEVER kept: a rejection, or a `{ error }` answer from the
 *     database client, is forgotten at once and the next call reads again, so a
 *     failed read is never turned into "this house has nothing" (ADR 0292);
 *   - houses never share: every key a caller passes carries the restaurant id;
 *   - clients never share: the memo hangs off the client object (a WeakMap).
 * The rows are shared READ-ONLY; each service maps them into its own shape.
 */
export const LENS_MEMO_MS = 30_000;

type Entry = { at: number; value: Promise<any> };

const memo = new WeakMap<object, Map<string, Entry>>();

export function sharedLensRead<T>(
  client: object,
  key: string,
  load: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  let byKey = memo.get(client);
  if (!byKey) {
    byKey = new Map();
    memo.set(client, byKey);
  }
  const hit = byKey.get(key);
  if (hit && now() - hit.at < LENS_MEMO_MS) return hit.value;

  const value = load();
  const entry: Entry = { at: now(), value };
  byKey.set(key, entry);
  const forget = () => {
    if (byKey!.get(key) === entry) byKey!.delete(key);
  };
  value.then((v: any) => {
    // A client that answers `{ data, error }` has failed when `error` is set.
    if (v && typeof v === "object" && !Array.isArray(v) && "error" in v && v.error) forget();
  }, forget);
  return value;
}

/** The active inventory rows every lens costs from (superset of both lenses' columns). */
export function readInventoryRows(client: any, restaurantId: string) {
  return sharedLensRead(client, `restaurant_inventory|${restaurantId}`, () =>
    Promise.resolve(
      client
        .from("restaurant_inventory")
        // Column names must match the live schema exactly: one unknown column
        // 42703s the whole PostgREST query (see analytics.service.ts history).
        .select(
          "id, wine_name, stock_live, menu_price_current, last_purchase_price, threshold_min, master_wine_id, master_wine_library(primary_type)",
        )
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true),
    ) as Promise<{ data: any[] | null; error: any }>,
  );
}

/** The lot rollup (WAC, live quantity) that sits beside the inventory rows. */
export function readLotRollupRows(client: any, restaurantId: string) {
  return sharedLensRead(client, `inventory_lot_rollup|${restaurantId}`, () =>
    Promise.resolve(
      client
        .from("inventory_lot_rollup")
        // wac_qty / live_qty added 2026-09-02 (ADR 0079) so resolveUnitCost can
        // tell a WAC that covers every on-hand bottle from a single invoiced one.
        .select("inventory_id, live_qty, wac, has_invoice_cost, wac_qty")
        .eq("restaurant_id", restaurantId),
    ) as Promise<{ data: any[] | null; error: any }>,
  );
}
