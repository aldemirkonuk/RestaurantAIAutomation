import { readWholeWindow } from "../common/read-whole-window";

/**
 * ONE read of a house's consumption lines per window, shared by the two
 * analytics services.
 *
 * /reports asks for the same `wine_consumption_log` window up to five times in
 * one load (overview, menu engineering, seasonality, the financial summary and
 * the risk lens each loaded it themselves), and every load is a whole-window
 * paged read with an exact count and an inventory join. This holds one result
 * per (house, window) for `CONSUMPTION_MEMO_MS` and lets callers that arrive
 * while it is being read wait on the same read (singleflight).
 *
 * What it does NOT do, on purpose:
 *   - It never keeps a failure. A refusal (`WholeReadError`) reaches every
 *     caller waiting on that read, and the next call reads again, so a failed
 *     read is never turned into "this house sold nothing" (ADR 0292).
 *   - It never shares across houses: the key carries the restaurant id.
 *   - It never shares across databases/clients: the memo hangs off the client
 *     object (a WeakMap), so a test double or a reconnect starts empty.
 *
 * The rows are shared READ-ONLY; each service maps them into its own shape.
 */
export const CONSUMPTION_MEMO_MS = 30_000;

export const CONSUMPTION_SELECT =
  "id, inventory_id, consumption_type, quantity, volume_ml, created_at, restaurant_inventory(master_wine_id, bottle_size_ml)";

type Entry = { at: number; rows: Promise<any[]> };

const memo = new WeakMap<object, Map<string, Entry>>();

export function readConsumptionRows(
  client: any,
  restaurantId: string,
  sinceDays: number,
  now: () => number = Date.now,
): Promise<any[]> {
  let byKey = memo.get(client);
  if (!byKey) {
    byKey = new Map();
    memo.set(client, byKey);
  }
  const key = `${restaurantId}|${sinceDays}`;
  const hit = byKey.get(key);
  if (hit && now() - hit.at < CONSUMPTION_MEMO_MS) return hit.rows;

  const since = new Date(now() - sinceDays * 86400000).toISOString();
  const rows = readWholeWindow<any>(
    "The consumption lines in this window",
    () =>
      client
        .from("wine_consumption_log")
        // No master_wine_id column on this table — resolve via the inventory FK.
        .select(CONSUMPTION_SELECT, { count: "exact" })
        .eq("restaurant_id", restaurantId)
        .gte("created_at", since),
  );
  const entry: Entry = { at: now(), rows };
  byKey.set(key, entry);
  // A failed read is forgotten at once; only a read that answered is kept.
  rows.catch(() => {
    if (byKey!.get(key) === entry) byKey!.delete(key);
  });
  return rows;
}
