import {
  readWholeWindow,
  type WholeWindowQuery,
} from "../common/read-whole-window";

/**
 * What is ON a zone is its live lots (F-1331).
 *
 * `inventory_lots.location_id` is the one record every stock path writes:
 * receiving puts a delivery's lot on a shelf, `transfer_stock` moves lots
 * between shelves, pours and counts take from them. Until F-1331 one shelf had
 * three counts: the cellar map read the lots, the Storage Locations dialog read
 * `wine_location_mappings` (written only by its own stepper), and the cellar
 * floor counted `restaurant_inventory.storage_location_id` titles. Receive 12
 * into a rack and the map said 12, the dialog 0, and delete refused on 12
 * bottles the dialog could not show. Every zone count now reads this.
 *
 * Read whole or refused (ADR 0292): a count from part of the lots is a wrong
 * count, not a smaller one.
 */
export interface ZoneLot {
  id: string;
  master_wine_id: string;
  location_id: string;
  qty: number;
}

type LotClient = { from: (table: string) => unknown };

export async function readZoneLots(
  client: LotClient,
  restaurantId: string,
  locationId?: string,
): Promise<ZoneLot[]> {
  return readWholeWindow<ZoneLot>("The bottles in each zone", () => {
    // supabase-js's builder is typed per table; this reads one table's
    // filters and hands the builder to readWholeWindow, which orders and pages.
    let q = (client.from("inventory_lots") as any)
      .select("id, master_wine_id, location_id, qty", { count: "exact" })
      .eq("restaurant_id", restaurantId)
      .eq("stock_state", "live")
      .gt("qty", 0);
    q = locationId
      ? q.eq("location_id", locationId)
      : q.not("location_id", "is", null);
    return q as WholeWindowQuery;
  });
}

/** Bottles per zone id. A zone with no live lot is absent (read it as 0). */
export function bottlesByZone(lots: readonly ZoneLot[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lots) {
    const n = Math.max(0, Number(l.qty) || 0);
    if (n > 0) out.set(l.location_id, (out.get(l.location_id) ?? 0) + n);
  }
  return out;
}

/** Bottles per wine (master wine id), in the order the lots were read. */
export function bottlesByWine(lots: readonly ZoneLot[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lots) {
    const n = Math.max(0, Number(l.qty) || 0);
    if (n > 0) out.set(l.master_wine_id, (out.get(l.master_wine_id) ?? 0) + n);
  }
  return out;
}
