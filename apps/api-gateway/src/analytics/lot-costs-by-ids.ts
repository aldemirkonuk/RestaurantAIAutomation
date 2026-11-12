import { readByIds } from "../common/read-by-ids";

/**
 * The lot figures `resolveUnitCost` reads, for the stock items in hand, whole
 * or refused (ADR 0292): `inventory_lot_rollup` (live quantity, invoiced WAC)
 * and `inventory_lot_agreed_cost` (the cost settled at delivery). Read
 * unranged by house, each stopped at 1,000 rows; the house measured on
 * 2026-11-12 holds 1,510 items. Neither view has a unique column to page on,
 * and every caller looks rows up by ids it holds, so both are asked for those
 * ids (`readByIds`). Either read failing refuses the whole (it used to fall
 * back to the last purchase price, named as the basis). 1,510 items is 32
 * requests, so a batch that answers with an error is asked once more first;
 * a capped or malformed batch is not, a second ask would not change it.
 */

/** The rollup columns `resolveUnitCost` reads (ADR 0079 added the last two). */
export const LOT_ROLLUP_SELECT =
  "inventory_id, live_qty, wac, has_invoice_cost, wac_qty";

/** The cost agreed at delivery (final, not invoiced). */
export const AGREED_LOT_COST_COLUMNS = "inventory_id, has_agreed_cost, agreed_wac";

/** Retried here, not in `readByIds`, which stays byte for byte #1131's. */
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
