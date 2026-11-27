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
import { readWholeWindow } from "../common/read-whole-window";
import { readByIds } from "../common/read-by-ids";

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

/**
 * The active inventory rows every lens costs from, with their lot rollup, read
 * WHOLE or refused (ADR 0292) and shared per house. One entry holds both, so a
 * rollup is never paired with an inventory read taken at another moment: the
 * rollup is read for the ids in hand (`readByIds`; it has no unique column to
 * page on). A `WholeReadError` rejects the entry and it is forgotten at once.
 * The select is the superset of both lenses' columns.
 */
export function readInventoryWithLots(
  client: any,
  restaurantId: string,
): Promise<{ inventory: any[]; lots: any[] }> {
  return sharedLensRead(client, `restaurant_inventory+lots|${restaurantId}`, async () => {
    // Column names must match the live schema exactly: one unknown column
    // 42703s the whole PostgREST query. There is no wine_type/unit_price/
    // unit_cost/reorder_point on this table: the menu price is
    // `menu_price_current`, cost is `last_purchase_price`, the reorder trigger
    // is `threshold_min`, and the varietal/type lives on master_wine_library.
    const inventory = await readWholeWindow<any>("The house's inventory", () =>
      client
        .from("restaurant_inventory")
        .select(
          "id, wine_name, display_name, stock_live, menu_price_current, last_purchase_price, threshold_min, master_wine_id, master_wine_library(primary_type, name)",
          { count: "exact" },
        )
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true),
    );
    const lots = await readByIds<any>(
      "The house's lot totals",
      inventory.map((i: any) => i.id),
      (batch) =>
        client
          .from("inventory_lot_rollup")
          // wac_qty / live_qty added 2026-09-02 (ADR 0079) so resolveUnitCost can
          // tell a WAC that covers every on-hand bottle from a single invoiced one.
          .select("inventory_id, live_qty, wac, has_invoice_cost, wac_qty")
          .eq("restaurant_id", restaurantId)
          .in("inventory_id", batch),
    );
    return { inventory, lots };
  });
}
