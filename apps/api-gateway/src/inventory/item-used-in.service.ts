import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseService } from "../database/database.service";
// The house-item fold (lower case, accents and Turkish ı folded, punctuation to
// spaces). Fold into the shared one from #785/#829 when those merge.
import { foldName } from "./house-item-research";

export interface HouseItem {
  id: string;
  kind: string | null;
  displayName: string | null;
  masterWineId: string | null;
  beverageId: string | null;
}

/** One group of the drawer: a failed read is `lines: null`, never [] (ADR 0067). */
export interface Group<T> {
  readable: boolean;
  lines: T[] | null;
  source: string;
}

export interface MenuLine {
  menuItemId: string;
  menuId: string;
  name: string;
  byGlassPrice: number | null;
  bottlePrice: number | null;
  linkedBy?: "inventory_item_id" | "wine_library_id";
}

export interface CocktailLine {
  cocktailId: string;
  name: string;
  quantity: number | null;
  unit: string | null;
}

export interface DrinkRecipeLine {
  cocktailId: string;
  name: string;
  label: string;
  qtyEntered: number;
  unitCode: string;
}

const PAGE = 1000;
const CHUNK = 100;
const LINE_COLS =
  "id, menu_id, name, by_glass_price, bottle_price, inventory_item_id, wine_library_id";

/**
 * The item, read inside the caller's house. The restaurant filter IS the
 * tenant check for `:itemId` (same filter as assertInventoryBelongsToRestaurant,
 * without its "no stock was moved" wording, which is wrong on a read).
 */
export async function readHouseItem(
  client: SupabaseClient,
  restaurantId: string,
  itemId: string,
): Promise<HouseItem> {
  const { data, error } = await client
    .from("restaurant_inventory")
    .select("id, kind, display_name, wine_name, master_wine_id, beverage_id")
    .eq("id", itemId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (error) {
    throw new ServiceUnavailableException(
      `This item could not be read (${error.message}), so nothing about it is shown. Try again.`,
    );
  }
  if (!data) throw new NotFoundException(`Item ${itemId} is not in this house.`);
  return {
    id: data.id,
    kind: data.kind ?? null,
    displayName: data.display_name || data.wine_name || null,
    masterWineId: data.master_wine_id ?? null,
    beverageId: data.beverage_id ?? null,
  };
}

const money = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

const menuLine = (r: Record<string, any>): MenuLine => ({
  menuItemId: r.id,
  menuId: r.menu_id,
  name: r.name,
  byGlassPrice: money(r.by_glass_price),
  bottlePrice: money(r.bottle_price),
});

/**
 * No active menu is a named state, not an empty menu (ADR 0193,
 * menus/current-menu-lines.ts): every menu that is read lands as a draft until
 * it is made current, so "no line" here says nothing about this item.
 */
const NO_CURRENT_MENU: Group<never> = {
  readable: true,
  lines: [],
  source:
    "This house has no current menu, so no line is on it. A menu that was read but never made current is not counted.",
};

const failed = <T>(what: string, message: string): Group<T> => ({
  readable: false,
  lines: null,
  source: `${what} could not be read (${message}), so this is not shown.`,
});

@Injectable()
export class ItemUsedInService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Where one item is used. The menu groups are one chain (the unlinked group
   * leaves out what the linked group found); the two drink groups are each
   * their own reads. The three run at once, so the drawer waits for the
   * slowest chain, not for the sum of every read.
   */
  async usedIn(restaurantId: string, itemId: string) {
    const client = this.db.supabase;
    const item = await readHouseItem(client, restaurantId, itemId);

    const [menu, inCocktails, inDrinkRecipes] = await Promise.all([
      this.menuGroups(client, restaurantId, item),
      this.inCocktails(client, restaurantId, item),
      this.inDrinkRecipes(client, restaurantId, item),
    ]);

    return {
      item: { id: item.id, kind: item.kind, displayName: item.displayName },
      soldAs: menu.soldAs,
      inCocktails,
      inDrinkRecipes,
      namedNotLinked: menu.namedNotLinked,
    };
  }

  /** The current menu's lines linked to the item, then the lines that only carry its name. */
  private async menuGroups(client: SupabaseClient, restaurantId: string, item: HouseItem) {
    // Only lines on the house's current (active) menus are "on the menu";
    // an archived or draft menu is not (menus.service readCurrentMenus).
    const menus = await client
      .from("restaurant_menus")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("status", "active");
    const menuIds = menus.error
      ? null
      : ((menus.data ?? []) as Array<{ id: string }>).map((m) => m.id);

    const soldAs = await this.soldAs(client, restaurantId, item, menuIds, menus.error?.message);
    const namedNotLinked = await this.namedNotLinked(
      client,
      restaurantId,
      item,
      menuIds,
      menus.error?.message,
      soldAs.lines,
    );
    return { soldAs, namedNotLinked };
  }

  private async soldAs(
    client: SupabaseClient,
    restaurantId: string,
    item: HouseItem,
    menuIds: string[] | null,
    menusError?: string,
  ): Promise<Group<MenuLine>> {
    if (menuIds === null) return failed("The house's current menu", menusError ?? "");
    if (menuIds.length === 0) return NO_CURRENT_MENU;
    const source = "Lines on the house's current menu linked to this item.";
    let q = client
      .from("menu_items")
      .select(LINE_COLS)
      .eq("restaurant_id", restaurantId)
      .in("menu_id", menuIds)
      .neq("status", "discarded");
    q = item.masterWineId
      ? q.or(`inventory_item_id.eq.${item.id},wine_library_id.eq.${item.masterWineId}`)
      : q.eq("inventory_item_id", item.id);
    const { data, error } = await q;
    if (error) return failed("The menu", error.message);
    const lines = ((data ?? []) as Array<Record<string, any>>)
      // A line linked to another house item belongs to that item.
      .filter((r) => r.inventory_item_id == null || r.inventory_item_id === item.id)
      .map((r) => ({
        ...menuLine(r),
        linkedBy:
          r.inventory_item_id === item.id
            ? ("inventory_item_id" as const)
            : ("wine_library_id" as const),
      }));
    return { readable: true, lines, source };
  }

  /**
   * Unlinked current-menu lines whose name folds to the item's name. Compared
   * in TS: a raw ilike pattern treats `_` and `%` as wildcards (QA M-9).
   * Shown for a person to link; never counted.
   */
  private async namedNotLinked(
    client: SupabaseClient,
    restaurantId: string,
    item: HouseItem,
    menuIds: string[] | null,
    menusError: string | undefined,
    sold: MenuLine[] | null,
  ): Promise<Group<MenuLine>> {
    if (menuIds === null) return failed("The house's current menu", menusError ?? "");
    if (menuIds.length === 0) return NO_CURRENT_MENU;
    const source =
      "Lines on the current menu with this item's name and no link to any item. Not counted until linked.";
    const want = item.displayName ? foldName(item.displayName) : "";
    if (!want) return { readable: true, lines: [], source };
    const taken = new Set((sold ?? []).map((l) => l.menuItemId));
    const lines: MenuLine[] = [];
    let after: string | null = null;
    for (;;) {
      let q = client
        .from("menu_items")
        .select(LINE_COLS)
        .eq("restaurant_id", restaurantId)
        .in("menu_id", menuIds)
        .neq("status", "discarded")
        .is("inventory_item_id", null);
      if (after) q = q.gt("id", after);
      const { data, error } = await q.order("id", { ascending: true }).limit(PAGE);
      if (error) return failed("The menu", error.message);
      const rows = (data ?? []) as Array<Record<string, any>>;
      for (const r of rows) {
        if (!taken.has(r.id) && foldName(String(r.name ?? "")) === want) {
          lines.push(menuLine(r));
        }
      }
      if (rows.length < PAGE) break;
      after = String(rows[rows.length - 1].id);
    }
    return { readable: true, lines, source };
  }

  /** House cocktails (restaurant_id = this house) naming the item's catalogue drink. */
  private async inCocktails(
    client: SupabaseClient,
    restaurantId: string,
    item: HouseItem,
  ): Promise<Group<CocktailLine>> {
    const source = "The house's own cocktail recipes that use this drink.";
    const keys = [
      item.beverageId && `beverage_id.eq.${item.beverageId}`,
      item.masterWineId && `wine_id.eq.${item.masterWineId}`,
    ].filter(Boolean);
    if (keys.length === 0) {
      return {
        readable: true,
        lines: [],
        source: "A cocktail recipe names a catalogue drink, and this item is not one.",
      };
    }
    const ing = await client
      .from("cocktail_ingredients")
      .select("cocktail_id, quantity, unit")
      .or(keys.join(","));
    if (ing.error) return failed("The cocktail recipes", ing.error.message);
    const rows = (ing.data ?? []) as Array<Record<string, any>>;
    if (rows.length === 0) return { readable: true, lines: [], source };
    const cocktails = await client
      .from("cocktails")
      .select("id, name, display_name")
      .in("id", [...new Set(rows.map((r) => r.cocktail_id))])
      // NULL restaurant_id is the catalogue, not this house's.
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null);
    if (cocktails.error) return failed("The cocktail recipes", cocktails.error.message);
    const byId = new Map(
      ((cocktails.data ?? []) as Array<Record<string, any>>).map((c) => [c.id, c]),
    );
    const lines = rows
      .filter((r) => byId.has(r.cocktail_id))
      .map((r) => {
        const c = byId.get(r.cocktail_id)!;
        return {
          cocktailId: c.id,
          name: c.display_name || c.name,
          quantity: r.quantity == null ? null : Number(r.quantity),
          unit: r.unit ?? null,
        };
      });
    return { readable: true, lines, source };
  }

  /**
   * House cocktails whose CURRENT recipe version has a line linked to this item
   * (ADR 0360: recipe_lines.inventory_id). Three plain reads, each paged or
   * chunked so no read trusts one PostgREST page. Older versions are history.
   */
  private async inDrinkRecipes(
    client: SupabaseClient,
    restaurantId: string,
    item: HouseItem,
  ): Promise<Group<DrinkRecipeLine>> {
    const what = "The drink recipes";
    const lineRows: Array<Record<string, any>> = [];
    let after: string | null = null;
    for (;;) {
      let q = client
        .from("recipe_lines")
        .select("id, version_id, position, label, qty_entered, unit_code")
        .eq("restaurant_id", restaurantId)
        .eq("inventory_id", item.id);
      if (after) q = q.gt("id", after);
      const { data, error } = await q.order("id", { ascending: true }).limit(PAGE);
      if (error) return failed(what, error.message);
      const rows = (data ?? []) as Array<Record<string, any>>;
      lineRows.push(...rows);
      if (rows.length < PAGE) break;
      after = String(rows[rows.length - 1].id);
    }
    const source = "Drinks whose current recipe has a line linked to this item.";
    if (lineRows.length === 0) return { readable: true, lines: [], source };

    const cocktailOfVersion = new Map<string, string>();
    const versionIds = [...new Set(lineRows.map((r) => String(r.version_id)))];
    for (let i = 0; i < versionIds.length; i += CHUNK) {
      const { data, error } = await client
        .from("recipe_current")
        .select("cocktail_id, version_id")
        .eq("restaurant_id", restaurantId)
        .in("version_id", versionIds.slice(i, i + CHUNK));
      if (error) return failed(what, error.message);
      for (const r of (data ?? []) as Array<Record<string, any>>) {
        cocktailOfVersion.set(String(r.version_id), String(r.cocktail_id));
      }
    }
    const current = lineRows.filter((r) => cocktailOfVersion.has(String(r.version_id)));

    const names = new Map<string, string>();
    const cocktailIds = [...new Set(current.map((r) => cocktailOfVersion.get(String(r.version_id))!))];
    for (let i = 0; i < cocktailIds.length; i += CHUNK) {
      const { data, error } = await client
        .from("cocktails")
        .select("id, name, display_name")
        .in("id", cocktailIds.slice(i, i + CHUNK))
        // NULL restaurant_id is the catalogue, not this house's.
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null);
      if (error) return failed(what, error.message);
      for (const c of (data ?? []) as Array<Record<string, any>>) {
        names.set(String(c.id), c.display_name || c.name);
      }
    }
    const lines = current
      .filter((r) => names.has(cocktailOfVersion.get(String(r.version_id))!))
      .map((r) => {
        const cocktailId = cocktailOfVersion.get(String(r.version_id))!;
        return {
          cocktailId,
          name: names.get(cocktailId)!,
          label: r.label,
          qtyEntered: Number(r.qty_entered),
          unitCode: r.unit_code,
          position: Number(r.position ?? 0),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.position - b.position)
      .map(({ position: _p, ...l }) => l);
    return { readable: true, lines, source };
  }
}
