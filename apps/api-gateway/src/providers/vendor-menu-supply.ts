/**
 * Which of this house's vendors supply a wine on its CURRENT menu — the
 * "Supplies my menu" rung of /vendors (founder, 2026-09-26, item 36; ADR 0221).
 *
 * THE FOUNDER'S QUESTION, verbatim: "/vendors: open on 'Supplies my menu' (built
 * from what you've actually bought: price history, orders, inventory), then 'All
 * my vendors'." So the evidence is PURCHASE evidence, three sources unioned:
 *
 *   priced   — `price_history (provider_id, master_wine_id)` whose
 *              `effective_date` is inside the last 180 days;
 *   ordered  — `procurement_order_items.master_wine_id` of an order placed with
 *              the vendor (`procurement_orders.provider_id`), counted only when
 *              the order reached the vendor: arrived (ORDER_ARRIVED_STATUSES) or
 *              out with them (ORDER_OPEN_WITH_VENDOR_STATUSES). A pending,
 *              cancelled or rejected order is not something the house bought;
 *   stocked  — `restaurant_inventory.provider_id` on a live (not deleted) row.
 *
 * …intersected with the `wine_library_id`s of the non-discarded lines of every
 * ACTIVE menu of the house (research-filters adversarial pass, F1/F7: a draft
 * or retired menu is not "my menu", and `restaurant_inventory.provider_id`
 * alone is near-empty for menu wines because the menu-link insert sets none).
 *
 * WHY THE RULES BELOW ARE LOAD-BEARING
 *   1. Every read is house-scoped. The gateway reads with the service client,
 *      so RLS protects nothing here: `restaurant_id` on the menus, the menu
 *      lines, the price history and the inventory, and on the ORDER for order
 *      lines (`procurement_orders.restaurant_id` is NOT NULL, where the line's
 *      own copy is nullable on old rows).
 *   2. No read is capped. PostgREST stops at 1000 rows without saying so; every
 *      read here is keyset-paged on `id` until a short page, and a failed page
 *      is an error, never a shorter list (F2/F12).
 *   3. More than one active menu is tolerated and unioned — production has no
 *      unique index on the active menu (migration 20260922230700:49), and a
 *      `.maybeSingle()` would throw on exactly that house.
 *   4. No menu is a STATE, not an empty answer: `menu.current` is false and the
 *      page opens on "All my vendors" with a banner, instead of a Supplies list
 *      that is empty for a reason it cannot say.
 *   5. A failed read throws. "Nobody supplies your menu" and "the price book
 *      did not answer" must never look the same.
 */

import {
  ORDER_ARRIVED_STATUSES,
  ORDER_OPEN_WITH_VENDOR_STATUSES,
  hasStatus,
} from "../procurement/order-status";

/** The purchase-evidence window for price history: a fixed 180 days, the window the founder fixed for offers on 2026-09-26 (records lane: OD-153). */
export const SUPPLY_WINDOW_DAYS = 180;

/** PostgREST's silent ceiling; every read pages under it. */
export const PAGE_ROWS = 1000;

/** Orders that reached the vendor — what counts as "bought" on /vendors. */
export const BOUGHT_STATUSES = [
  ...ORDER_ARRIVED_STATUSES,
  ...ORDER_OPEN_WITH_VENDOR_STATUSES,
];

export interface MenuSupplier {
  providerId: string;
  /** Distinct current-menu wines this vendor has evidence for. */
  menuWines: number;
  /** …of which: seen in its price history in the window. */
  priced: number;
  /** …of which: on an order placed with it. */
  ordered: number;
  /** …of which: a live inventory row names it as the vendor. */
  stocked: number;
}

export interface VendorMenuSupply {
  menu: {
    /** At least one active menu exists. */
    current: boolean;
    /** How many active menus were unioned (normally 1). */
    menus: number;
    /** When the current menu became current (or was read, or is dated). */
    readAt: string | null;
    /** Non-discarded lines on the active menu(s). */
    lines: number;
    /** …of which carry a wine_library_id (food and unlinked lines do not). */
    linkedLines: number;
    /** Distinct wines on the current menu. */
    wines: number;
  };
  windowDays: number;
  /** First day of the price-history window, YYYY-MM-DD. */
  since: string;
  suppliers: MenuSupplier[];
}

export type Row = Record<string, unknown>;
type Page = PromiseLike<{
  data: Row[] | null;
  error: { message: string } | null;
}>;

/**
 * Read every row of a keyset-paged query. `build(after)` returns the chain
 * with its filters; this adds the `id` cursor, the order and the page size.
 * Exported for `vendor-wine-search.ts` (the name-only wine search, founder
 * 2026-09-26 item 48), so the two /vendors reads page the same way.
 */
export async function readAll(
  what: string,
  build: (after: string | null) => {
    order: (
      col: string,
      o: { ascending: boolean },
    ) => { limit: (n: number) => Page };
  },
): Promise<Row[]> {
  const out: Row[] = [];
  let after: string | null = null;
  for (;;) {
    const { data, error } = await build(after)
      .order("id", { ascending: true })
      .limit(PAGE_ROWS);
    if (error) {
      throw new Error(`${what} could not be read (${error.message})`);
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_ROWS) return out;
    after = String(rows[rows.length - 1].id);
  }
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The newest of the active menus' "became current" moments. */
function readMomentOf(rows: Row[]): string | null {
  let best: string | null = null;
  for (const r of rows) {
    const at =
      str(r.made_current_at) ?? str(r.extracted_at) ?? str(r.menu_date) ?? null;
    if (at && (best === null || at > best)) best = at;
  }
  return best;
}

/**
 * The whole computation, over a supabase-js client. Pure apart from the reads,
 * so the spec drives it with a fake client and asserts every read's scope.
 */
export async function readVendorMenuSupply(
  db: any,
  restaurantId: string,
  now: Date = new Date(),
): Promise<VendorMenuSupply> {
  const sinceDate = new Date(now.getTime() - SUPPLY_WINDOW_DAYS * 86_400_000);
  const since = isoDay(sinceDate);
  const empty = (menu: VendorMenuSupply["menu"]): VendorMenuSupply => ({
    menu,
    windowDays: SUPPLY_WINDOW_DAYS,
    since,
    suppliers: [],
  });

  // 1. The current menu(s). Every active one, unioned (rule 3).
  const { data: menus, error: menuErr } = await db
    .from("restaurant_menus")
    .select("id, made_current_at, extracted_at, menu_date")
    .eq("restaurant_id", restaurantId)
    .eq("status", "active");
  if (menuErr) {
    throw new Error(`The current menu could not be read (${menuErr.message})`);
  }
  const active = (menus ?? []) as Row[];
  const menuIds = active.map((m) => String(m.id));
  if (menuIds.length === 0) {
    return empty({
      current: false,
      menus: 0,
      readAt: null,
      lines: 0,
      linkedLines: 0,
      wines: 0,
    });
  }

  // 2. Its live lines.
  const lines = await readAll("The current menu's lines", (after) => {
    let q = db
      .from("menu_items")
      .select("id, wine_library_id")
      .in("menu_id", menuIds)
      .eq("restaurant_id", restaurantId)
      .neq("status", "discarded");
    if (after) q = q.gt("id", after);
    return q;
  });
  const menuWines = new Set<string>();
  let linkedLines = 0;
  for (const l of lines) {
    const w = str(l.wine_library_id);
    if (!w) continue;
    linkedLines += 1;
    menuWines.add(w);
  }
  const menu: VendorMenuSupply["menu"] = {
    current: true,
    menus: menuIds.length,
    readAt: readMomentOf(active),
    lines: lines.length,
    linkedLines,
    wines: menuWines.size,
  };
  if (menuWines.size === 0) return empty(menu);

  // 3. Purchase evidence, three sources.
  const [priced, ordered, stocked] = await Promise.all([
    readAll("The price history", (after) => {
      let q = db
        .from("price_history")
        .select("id, provider_id, master_wine_id")
        .eq("restaurant_id", restaurantId)
        .gte("effective_date", since)
        .not("provider_id", "is", null)
        .not("master_wine_id", "is", null);
      if (after) q = q.gt("id", after);
      return q;
    }),
    readAll("The order lines", (after) => {
      let q = db
        .from("procurement_order_items")
        .select(
          "id, master_wine_id, procurement_orders!inner(provider_id, status, restaurant_id)",
        )
        .eq("procurement_orders.restaurant_id", restaurantId)
        .not("master_wine_id", "is", null);
      if (after) q = q.gt("id", after);
      return q;
    }),
    readAll("The inventory", (after) => {
      let q = db
        .from("restaurant_inventory")
        .select("id, provider_id, master_wine_id")
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null)
        .not("provider_id", "is", null);
      if (after) q = q.gt("id", after);
      return q;
    }),
  ]);

  type Evidence = {
    priced: Set<string>;
    ordered: Set<string>;
    stocked: Set<string>;
  };
  const byVendor = new Map<string, Evidence>();
  const note = (
    providerId: string | null,
    wine: string | null,
    kind: keyof Evidence,
  ) => {
    if (!providerId || !wine || !menuWines.has(wine)) return;
    let e = byVendor.get(providerId);
    if (!e) {
      e = { priced: new Set(), ordered: new Set(), stocked: new Set() };
      byVendor.set(providerId, e);
    }
    e[kind].add(wine);
  };

  for (const r of priced)
    note(str(r.provider_id), str(r.master_wine_id), "priced");
  for (const r of ordered) {
    // An embedded to-one comes back as an object; tolerate an array too.
    const raw = r.procurement_orders as Row | Row[] | null | undefined;
    const order = Array.isArray(raw) ? raw[0] : raw;
    if (!order) continue;
    if (!hasStatus(str(order.status), BOUGHT_STATUSES)) continue;
    note(str(order.provider_id), str(r.master_wine_id), "ordered");
  }
  for (const r of stocked)
    note(str(r.provider_id), str(r.master_wine_id), "stocked");

  const suppliers: MenuSupplier[] = [...byVendor.entries()]
    .map(([providerId, e]) => ({
      providerId,
      menuWines: new Set([...e.priced, ...e.ordered, ...e.stocked]).size,
      priced: e.priced.size,
      ordered: e.ordered.size,
      stocked: e.stocked.size,
    }))
    .sort(
      (a, b) =>
        b.menuWines - a.menuWines || a.providerId.localeCompare(b.providerId),
    );

  return { menu, windowDays: SUPPLY_WINDOW_DAYS, since, suppliers };
}
