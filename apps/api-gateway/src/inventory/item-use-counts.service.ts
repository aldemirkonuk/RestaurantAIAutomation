import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseService } from "../database/database.service";

const PAGE = 1000;

export const USE_COUNTS_UNREAD =
  "How many recipes use each good could not be read just now, so none is shown as unused.";

type Row = Record<string, any>;

/**
 * How many recipes use each good, for the whole house, for the list's "Used
 * in" column and its "Unused" chip. Same rule as where-used (ADR 0366): a
 * recipe counts only through its CURRENT version (plus the older
 * cocktail_ingredients rows, which the drawer also counts), and a drink or dish that is
 * deleted does not count. A good that two lines of one recipe use counts once.
 *
 * A failed read throws. It never returns an empty map, because the web would
 * read "no recipe uses it" and call a good dead stock that no read looked at.
 * Scoped by `restaurant_id` on every read.
 */
@Injectable()
export class ItemUseCountsService {
  constructor(private readonly db: DatabaseService) {}

  async counts(restaurantId: string): Promise<{ counts: Record<string, number> }> {
    const client = this.db.supabase;
    try {
      const lines = await this.paged(client, "recipe_lines", "id, version_id, inventory_id", restaurantId, (q) =>
        q.not("inventory_id", "is", null),
      );
      const ownerOfVersion = new Map<string, string>();
      for (const [table, owner] of [
        ["recipe_current", "cocktail_id"],
        ["recipe_current_dish", "dish_id"],
      ] as const) {
        const rows = await this.paged(client, table, `${owner}, version_id`, restaurantId, undefined, owner);
        for (const r of rows) ownerOfVersion.set(String(r.version_id), `${owner}:${r[owner]}`);
      }

      const live = new Set<string>();
      for (const [table, owner] of [
        ["cocktails", "cocktail_id"],
        ["dishes", "dish_id"],
      ] as const) {
        const rows = await this.paged(client, table, "id", restaurantId, (q) => q.is("deleted_at", null));
        for (const r of rows) live.add(`${owner}:${r.id}`);
      }

      const owners = new Map<string, Set<string>>();
      const add = (inventoryId: string, owner: string) =>
        (owners.get(inventoryId) ?? owners.set(inventoryId, new Set()).get(inventoryId)!).add(owner);

      // The older cocktail_ingredients rows name a catalogue drink, not a good.
      // The drawer counts them (item-used-in inCocktails), so the list must too:
      // a good is found by its beverage_id or master_wine_id. A cocktail that has
      // both a current recipe line and an old row counts once (same owner key).
      const legacy = await this.paged(client, "cocktail_ingredients", "id, cocktail_id, beverage_id, wine_id", undefined);
      if (legacy.length > 0) {
        const goods = await this.paged(client, "restaurant_inventory", "id, beverage_id, master_wine_id", restaurantId);
        const byBeverage = new Map<string, string[]>();
        const byWine = new Map<string, string[]>();
        const push = (m: Map<string, string[]>, k: unknown, id: unknown) => {
          if (!k) return;
          const key = String(k);
          (m.get(key) ?? m.set(key, []).get(key)!).push(String(id));
        };
        for (const g of goods) {
          push(byBeverage, g.beverage_id, g.id);
          push(byWine, g.master_wine_id, g.id);
        }
        for (const r of legacy) {
          const owner = `cocktail_id:${r.cocktail_id}`;
          if (!live.has(owner)) continue;
          for (const id of (r.beverage_id && byBeverage.get(String(r.beverage_id))) || []) add(id, owner);
          for (const id of (r.wine_id && byWine.get(String(r.wine_id))) || []) add(id, owner);
        }
      }

      for (const l of lines) {
        const owner = ownerOfVersion.get(String(l.version_id));
        if (!owner || !live.has(owner)) continue;
        add(String(l.inventory_id), owner);
      }
      const counts: Record<string, number> = {};
      for (const [id, set] of owners) counts[id] = set.size;
      return { counts };
    } catch {
      throw new ServiceUnavailableException(USE_COUNTS_UNREAD);
    }
  }

  /** Every row of a house's table, a page at a time, ordered by `key` so no page is trusted to be the whole. */
  private async paged(
    client: SupabaseClient,
    table: string,
    columns: string,
    restaurantId: string | undefined,
    narrow?: (q: any) => any,
    key = "id",
  ): Promise<Row[]> {
    const out: Row[] = [];
    let after: string | null = null;
    for (;;) {
      let q: any = client.from(table).select(columns);
      // cocktail_ingredients has no house column; its rows are scoped by the live house cocktails.
      if (restaurantId) q = q.eq("restaurant_id", restaurantId);
      if (narrow) q = narrow(q);
      if (after) q = q.gt(key, after);
      const { data, error } = await q.order(key, { ascending: true }).limit(PAGE);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Row[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
      after = String(rows[rows.length - 1][key]);
    }
  }
}
