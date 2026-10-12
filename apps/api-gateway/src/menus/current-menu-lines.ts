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
 * The rule, from ADR 0193: only `status = 'active'` menus are on the menu.
 * Since ADR 0340 a house keeps one live menu PER KIND (Drinks, Food,
 * Desserts; the index restaurant_menus_one_active_per_kind), so "the current
 * menu" is a set of up to three rows, read as ONE union. A house with no
 * active menu returns `currentMenus: 0` and no rows, and never reads
 * `menu_items` at all; "no current menu" is a named state (ADR 0193), not an
 * empty menu. Every row says its menu's kind (`menu_type`), so a reader can
 * tell a Drinks line from a Food line without guessing from its text.
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
  "id, menu_id, name, producer, category, bottle_price, by_glass_price, created_at, section_id, position, line_kind, drink_category, price";

/**
 * The kinds a house can make live (ADR 0340 rule 1), in the default reading
 * order: Drinks (stored as `beverage`), Food, Desserts. The legacy
 * `full|bar|events` values stay in the CHECK but can never be made live.
 */
export const LIVE_MENU_KINDS = ["beverage", "food", "desserts"] as const;
export type MenuKind = (typeof LIVE_MENU_KINDS)[number];

/** Every column a current-menu row is read with; a const so check_read_columns_exist.py checks it. */
export const CURRENT_MENU_COLUMNS =
  "id, name, status, menu_type, made_current_at, extracted_at, menu_date";

/** One current menu of a house: one per kind at most (ADR 0340 rule 2). */
export interface CurrentMenuRow {
  id: string;
  name: string | null;
  status: string;
  /** The menu kind: `beverage` (Drinks), `food`, `desserts`. Null only where a fake row has none. */
  menu_type: string | null;
  made_current_at: string | null;
  extracted_at: string | null;
  menu_date: string | null;
}

const kindRank = (kind: string | null): number => {
  const at = LIVE_MENU_KINDS.indexOf(kind as MenuKind);
  return at === -1 ? LIVE_MENU_KINDS.length : at;
};

/**
 * THE read of a house's current menus (ADR 0340 rule 25): every reader that
 * asks "which menus are live" goes through here, so none of them can read one
 * row with `.maybeSingle()` and fail (or pick one) once two kinds are live.
 * `kinds` narrows the read to those menu kinds; an empty list reads nothing.
 * Rows come back in kind order (Drinks, Food, Desserts), then by id. A failed
 * read THROWS; it is never "no current menu" (ADR 0067).
 */
export async function readCurrentMenuRows(
  db: any,
  restaurantId: string,
  kinds?: readonly string[],
): Promise<CurrentMenuRow[]> {
  if (kinds && kinds.length === 0) return [];
  let q = db
    .from("restaurant_menus")
    .select(CURRENT_MENU_COLUMNS)
    .eq("restaurant_id", restaurantId)
    .eq("status", "active");
  if (kinds) q = q.in("menu_type", [...kinds]);
  const { data, error } = await q;
  if (error) {
    throw new Error(
      `The current menu (restaurant_menus) could not be read (${error.message})`,
    );
  }
  return ((data ?? []) as Row[])
    .map((m) => ({
      id: String(m.id),
      name: typeof m.name === "string" ? m.name : null,
      status: String(m.status ?? "active"),
      menu_type: typeof m.menu_type === "string" ? m.menu_type : null,
      made_current_at:
        typeof m.made_current_at === "string" ? m.made_current_at : null,
      extracted_at: typeof m.extracted_at === "string" ? m.extracted_at : null,
      menu_date: typeof m.menu_date === "string" ? m.menu_date : null,
    }))
    .sort(
      (a, b) =>
        kindRank(a.menu_type) - kindRank(b.menu_type) ||
        a.id.localeCompare(b.id),
    );
}

export interface CurrentMenuLines {
  /** How many menus are current (`status = 'active'`). 0 is "no current menu". */
  currentMenus: number;
  /** Their live lines, unioned, in `id` order, each with its menu's `menu_type`. Empty when `currentMenus` is 0. */
  rows: Row[];
}

export async function readCurrentMenuLines(
  db: any,
  restaurantId: string,
  opts: { kinds?: readonly string[] } = {},
): Promise<CurrentMenuLines> {
  const menus = await readCurrentMenuRows(db, restaurantId, opts.kinds);
  const menuIds = menus.map((m) => m.id);
  if (menuIds.length === 0) return { currentMenus: 0, rows: [] };
  const kindOf = new Map(menus.map((m) => [m.id, m.menu_type]));

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
  return {
    currentMenus: menuIds.length,
    rows: rows.map((r) => ({
      ...r,
      menu_type: kindOf.get(String(r.menu_id)) ?? null,
    })),
  };
}
