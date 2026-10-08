import { readAll, type Row } from "../providers/vendor-menu-supply";

/**
 * The lines on this house's CURRENT menu — the one read the cellar's menu
 * readers share.
 *
 * WHY THIS EXISTS. A house keeps every menu it reads (ADR 0193, migration
 * a_house_keeps_every_menu_it_reads): `restaurant_menus.status` is 'active'
 * for the current menu, 'draft' for one read and never chosen, 'archived' for
 * one that was current once. Every version keeps its own `menu_items` lines.
 * A read that filters `menu_items` by `restaurant_id` alone therefore counts
 * every kept copy: the 2026-10-03 analytics walk (A-028, F-148) measured
 * /cellar reading 267 lines for a 134-line menu, because the archived copy of
 * the same menu was still being counted, and 90 of 91 non-wine rows read
 * "2 lines on the menu".
 *
 * The rule, from ADR 0193 and the three readers that already apply it
 * (`MenusService.readCurrentMenus`, `readVendorMenuSupply`, the price-lock
 * read): only `status = 'active'` menus are on the menu. Several active menus
 * are read as ONE union, as those readers do, because production can hold more
 * than one (the migration adds no unique index). A house with no active menu
 * returns `currentMenus: 0` and no rows, and never reads `menu_items` at all;
 * "no current menu" is a named state (ADR 0193), not an empty menu.
 *
 * Lines are keyset-paged on `id` through `readAll`, so a menu past PostgREST's
 * 1000-row stop is read whole and the rows arrive in `id` order. Discarded
 * lines are left out (migration a_discarded_menu_line_leaves_the_ledger_too).
 * A failed read on either table THROWS; it never returns a shorter menu.
 *
 * A pure function over a supabase-js client rather than a `MenusService`
 * method: `MenusModule` imports `CellarModule`, so injecting `MenusService`
 * into the cellar would close a module cycle.
 */

/**
 * Every column a cellar reader needs from a current-menu line. A module-level
 * const so `scripts/check_read_columns_exist.py` checks it against the
 * migrations; an inlined list is a read nobody is checking.
 */
export const CURRENT_MENU_LINE_COLUMNS =
  "id, menu_id, name, producer, category, bottle_price, by_glass_price, created_at";

export interface CurrentMenuLines {
  /** How many menus are current (`status = 'active'`). 0 is "no current menu". */
  currentMenus: number;
  /** Their live lines, unioned, in `id` order. Empty when `currentMenus` is 0. */
  rows: Row[];
}

export async function readCurrentMenuLines(
  db: any,
  restaurantId: string,
): Promise<CurrentMenuLines> {
  const { data, error } = await db
    .from("restaurant_menus")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("status", "active");
  if (error) {
    throw new Error(
      `The current menu (restaurant_menus) could not be read (${error.message})`,
    );
  }
  const menuIds = ((data ?? []) as Row[]).map((m) => String(m.id));
  if (menuIds.length === 0) return { currentMenus: 0, rows: [] };

  const rows = await readAll(
    "The current menu's lines (menu_items)",
    (after) => {
      let q = db
        .from("menu_items")
        .select(CURRENT_MENU_LINE_COLUMNS)
        .in("menu_id", menuIds)
        .eq("restaurant_id", restaurantId)
        .neq("status", "discarded");
      if (after) q = q.gt("id", after);
      return q;
    },
  );
  return { currentMenus: menuIds.length, rows };
}
