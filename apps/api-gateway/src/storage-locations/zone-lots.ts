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
  /** The house item (restaurant_inventory.id) the lot belongs to. */
  inventory_id: string | null;
  /**
   * NULL on a beer, spirit or other house item's lot: migration
   * 20260903171000_the_house_item_is_the_ledgers_key.sql drops NOT NULL so
   * non-wine lots can be written. Never a grouping key.
   */
  master_wine_id: string | null;
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
      .select("id, inventory_id, master_wine_id, location_id, qty", {
        count: "exact",
      })
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

/** One house item on a zone: the lots of one item, summed. */
export interface ZoneItem {
  /** restaurant_inventory.id; the wine id only on a legacy lot with no item. */
  key: string;
  inventoryId: string | null;
  masterWineId: string | null;
  qty: number;
}

/**
 * Bottles per house item, in the order the lots were read. Keyed by the
 * house item, not the wine: a beer or house-declared item's lot has no
 * master_wine_id, and grouping on it put a null key in the wine-name read,
 * which failed and took the zone's delete and wine list down with it.
 */
export function bottlesByItem(lots: readonly ZoneLot[]): ZoneItem[] {
  const out = new Map<string, ZoneItem>();
  for (const l of lots) {
    const n = Math.max(0, Number(l.qty) || 0);
    if (n <= 0) continue;
    const key = l.inventory_id ?? l.master_wine_id ?? `lot:${l.id}`;
    const item = out.get(key);
    if (item) {
      item.qty += n;
      item.masterWineId = item.masterWineId ?? l.master_wine_id ?? null;
    } else {
      out.set(key, {
        key,
        inventoryId: l.inventory_id ?? null,
        masterWineId: l.master_wine_id ?? null,
        qty: n,
      });
    }
  }
  return [...out.values()];
}
