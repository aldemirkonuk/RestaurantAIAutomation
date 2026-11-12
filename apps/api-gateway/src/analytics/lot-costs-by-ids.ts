import { readByIds } from "../common/read-by-ids";

/**
 * The lot figures `resolveUnitCost` reads, for the stock items in hand, whole
 * or refused (ADR 0292).
 *
 * Two views feed one cost: `inventory_lot_rollup` (live quantity and the
 * invoiced WAC) and `inventory_lot_agreed_cost` (the cost settled at
 * delivery, which the rollup does not carry). The three readers that need
 * both (analytics' inventory, advanced analytics' margin inventory and margin
 * advice) each read them unranged by `restaurant_id`, so PostgREST stopped
 * each at 1,000 rows: past the thousandth item a bottle's agreed cost was
 * never read and it fell back to its last purchase price or to unknown. The
 * house measured on 2026-11-12 holds 1,510 items (reports lane r3).
 *
 * Neither view can be keyset-paged (`readWholeWindow` needs one unique
 * column; both group by `(inventory_id, restaurant_id)` and `inventory_id` is
 * nullable on lots), and every caller only looks a row up by an inventory id
 * it already holds, so both are asked for exactly those ids (`readByIds`).
 * Either read failing refuses the whole: no cost is stated from half of it.
 *
 * OUTAGE BEHAVIOUR (readers lane r4 fix round)
 * --------------------------------------------
 * Before, a failed rollup or agreed-cost read was logged and the loaders went
 * on: analytics' inventory priced an item from its last purchase price and
 * labelled that the basis, which was not true of an item whose lot cost
 * existed but was not read. Now the whole load refuses, and every reader of
 * it (the financial summary, the lenses, margin) answers "could not be read".
 * A 1,510-item house asks 16 batches of each view, so one transient error in
 * 32 requests would refuse the page; a batch that answers with an error is
 * therefore asked once more before the read refuses. Only an error is
 * retried: a batch holding the server's cap, or no rows and no error, is a
 * shape a second ask would not change. `margin-advice` refused on either
 * read's failure before this change too.
 */

/** The rollup columns `resolveUnitCost` reads (ADR 0079 added the last two). */
export const LOT_ROLLUP_SELECT =
  "inventory_id, live_qty, wac, has_invoice_cost, wac_qty";

/** The cost agreed at delivery (final, not invoiced). */
export const AGREED_LOT_COST_COLUMNS = "inventory_id, has_agreed_cost, agreed_wac";

/**
 * One batch, asked once more if it answers with an error. `readByIds` itself
 * stays byte for byte the copy on the reports stack (#1131), so the retry
 * lives here, in the builder it is handed.
 */
export function askTwiceOnError<P extends { error: unknown }>(
  ask: () => PromiseLike<P>,
): Promise<P> {
  return Promise.resolve(ask()).then((first) =>
    first?.error ? Promise.resolve(ask()) : first,
  );
}

export async function readLotCostsByIds(
  client: any,
  restaurantId: string,
  inventoryIds: readonly string[],
  rollupSelect: string = LOT_ROLLUP_SELECT,
): Promise<Map<string, Record<string, any>>> {
  const [lots, agreed] = await Promise.all([
    readByIds<any>("The house's lot totals", inventoryIds, (batch) =>
      askTwiceOnError(() =>
        client
          .from("inventory_lot_rollup")
          .select(rollupSelect)
          .eq("restaurant_id", restaurantId)
          .in("inventory_id", batch),
      ),
    ),
    readByIds<any>("The costs agreed at delivery", inventoryIds, (batch) =>
      askTwiceOnError(() =>
        client
          .from("inventory_lot_agreed_cost")
          .select(AGREED_LOT_COST_COLUMNS)
          .eq("restaurant_id", restaurantId)
          .in("inventory_id", batch),
      ),
    ),
  ]);
  const byItem = new Map<string, Record<string, any>>();
  for (const r of lots) byItem.set(String(r.inventory_id), r);
  for (const r of agreed) {
    const id = String(r.inventory_id);
    byItem.set(id, {
      ...byItem.get(id),
      inventory_id: r.inventory_id,
      has_agreed_cost: r.has_agreed_cost,
      agreed_wac: r.agreed_wac,
    });
  }
  return byItem;
}
