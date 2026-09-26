/**
 * "Supplies my menu" — which of the house's vendors have purchase evidence for
 * a wine on its CURRENT menu (founder, 2026-09-26, item 36; ADR 0221).
 *
 * The fake client below applies the real filters to in-memory tables, so each
 * test states rows and reads the answer, and the scope assertions read the
 * filters every query actually carried. The tests follow the adversarial pass
 * of the filters research (F1 current menu only, F2/F12 no silent cap, F7
 * evidence beyond inventory.provider_id), plus house isolation.
 */

import {
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  PAGE_ROWS,
  SUPPLY_WINDOW_DAYS,
  readVendorMenuSupply,
} from "./vendor-menu-supply";
import { ProvidersService } from "./providers.service";
import { ProvidersController } from "./providers.controller";

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;
type Filter = { op: string; col: string; val: unknown };
type Seen = { table: string; select: string; filters: Filter[] };

const HOUSE = "house-a";
const OTHER = "house-b";
const NOW = new Date("2026-09-26T12:00:00Z");

function fakeDb(tables: Tables, fail?: string) {
  const seen: Seen[] = [];
  const supabase: any = {
    from(table: string) {
      const rec: Seen = { table, select: "", filters: [] };
      seen.push(rec);
      let limit = Infinity;
      const q: any = {
        select(cols: string) {
          rec.select = cols;
          return q;
        },
        eq: (col: string, val: unknown) => (
          rec.filters.push({ op: "eq", col, val }),
          q
        ),
        neq: (col: string, val: unknown) => (
          rec.filters.push({ op: "neq", col, val }),
          q
        ),
        in: (col: string, val: unknown) => (
          rec.filters.push({ op: "in", col, val }),
          q
        ),
        gt: (col: string, val: unknown) => (
          rec.filters.push({ op: "gt", col, val }),
          q
        ),
        gte: (col: string, val: unknown) => (
          rec.filters.push({ op: "gte", col, val }),
          q
        ),
        is: (col: string, val: unknown) => (
          rec.filters.push({ op: "is", col, val }),
          q
        ),
        not: (col: string, op: string, val: unknown) => (
          rec.filters.push({ op: `not.${op}`, col, val }),
          q
        ),
        order: () => q,
        limit: (n: number) => ((limit = n), q),
        then(resolve: any) {
          if (fail === table) {
            return resolve({
              data: null,
              error: { message: "statement timeout" },
            });
          }
          const embedOrders = rec.select.includes("procurement_orders!inner");
          let rows = (tables[table] ?? []).map((r) =>
            embedOrders
              ? {
                  ...r,
                  procurement_orders:
                    (tables.procurement_orders ?? []).find(
                      (o) => o.id === r.order_id,
                    ) ?? null,
                }
              : { ...r },
          );
          if (embedOrders) rows = rows.filter((r) => r.procurement_orders);
          const get = (r: Row, col: string) =>
            col.includes(".")
              ? r[col.split(".")[0]]?.[col.split(".")[1]]
              : r[col];
          for (const f of rec.filters) {
            rows = rows.filter((r) => {
              const v = get(r, f.col);
              switch (f.op) {
                case "eq":
                  return v === f.val;
                case "neq":
                  return v != null && v !== f.val;
                case "in":
                  return (f.val as unknown[]).includes(v);
                case "gt":
                  return v != null && String(v) > String(f.val);
                case "gte":
                  return v != null && String(v) >= String(f.val);
                case "is":
                  return v == null;
                case "not.is":
                  return v != null;
                default:
                  throw new Error(`fake has no ${f.op}`);
              }
            });
          }
          rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
          return resolve({ data: rows.slice(0, limit), error: null });
        },
      };
      return q;
    },
  };
  return { supabase, seen };
}

const pad = (n: number) => String(n).padStart(6, "0");
const daysAgo = (d: number) =>
  new Date(NOW.getTime() - d * 86_400_000).toISOString().slice(0, 10);

/** One house with a current menu of two wines, plus noise that must not count. */
function baseTables(): Tables {
  return {
    restaurant_menus: [
      {
        id: "m-active",
        restaurant_id: HOUSE,
        status: "active",
        made_current_at: "2026-09-01T00:00:00Z",
      },
      { id: "m-draft", restaurant_id: HOUSE, status: "draft" },
      { id: "m-old", restaurant_id: HOUSE, status: "archived" },
      { id: "m-other", restaurant_id: OTHER, status: "active" },
    ],
    menu_items: [
      {
        id: "l1",
        menu_id: "m-active",
        restaurant_id: HOUSE,
        status: "active",
        wine_library_id: "w-malbec",
      },
      {
        id: "l2",
        menu_id: "m-active",
        restaurant_id: HOUSE,
        status: "active",
        wine_library_id: "w-rose",
      },
      {
        id: "l3",
        menu_id: "m-active",
        restaurant_id: HOUSE,
        status: "active",
        wine_library_id: null,
      }, // burger
      {
        id: "l4",
        menu_id: "m-active",
        restaurant_id: HOUSE,
        status: "discarded",
        wine_library_id: "w-gone",
      },
      {
        id: "l5",
        menu_id: "m-draft",
        restaurant_id: HOUSE,
        status: "active",
        wine_library_id: "w-draft",
      },
      {
        id: "l6",
        menu_id: "m-old",
        restaurant_id: HOUSE,
        status: "active",
        wine_library_id: "w-retired",
      },
      {
        id: "l7",
        menu_id: "m-other",
        restaurant_id: OTHER,
        status: "active",
        wine_library_id: "w-other",
      },
    ],
    price_history: [],
    procurement_orders: [],
    procurement_order_items: [],
    restaurant_inventory: [],
  };
}

describe("readVendorMenuSupply — the current menu", () => {
  it("a house with no active menu is a state, and no evidence is read", async () => {
    const t = baseTables();
    t.restaurant_menus = t.restaurant_menus.filter(
      (m) => m.status !== "active" || m.restaurant_id !== HOUSE,
    );
    const { supabase, seen } = fakeDb(t);
    const out = await readVendorMenuSupply(supabase, HOUSE, NOW);
    expect(out.menu.current).toBe(false);
    expect(out.suppliers).toEqual([]);
    expect(seen.map((s) => s.table)).toEqual(["restaurant_menus"]);
  });

  it("reads only the ACTIVE menu: draft, archived and discarded lines are not on it", async () => {
    const t = baseTables();
    t.price_history = [
      "w-malbec",
      "w-rose",
      "w-draft",
      "w-retired",
      "w-gone",
    ].map((w, i) => ({
      id: `p${i}`,
      restaurant_id: HOUSE,
      provider_id: `v-${w}`,
      master_wine_id: w,
      effective_date: daysAgo(3),
    }));
    const { supabase } = fakeDb(t);
    const out = await readVendorMenuSupply(supabase, HOUSE, NOW);
    expect(out.menu).toMatchObject({
      current: true,
      menus: 1,
      lines: 3,
      linkedLines: 2,
      wines: 2,
    });
    expect(out.suppliers.map((s) => s.providerId).sort()).toEqual([
      "v-w-malbec",
      "v-w-rose",
    ]);
  });

  it("two active menus are unioned, not an error", async () => {
    const t = baseTables();
    t.restaurant_menus.push({
      id: "m-active-2",
      restaurant_id: HOUSE,
      status: "active",
      extracted_at: "2026-09-20T00:00:00Z",
    });
    t.menu_items.push({
      id: "l8",
      menu_id: "m-active-2",
      restaurant_id: HOUSE,
      status: "active",
      wine_library_id: "w-rakı",
    });
    t.restaurant_inventory = [
      {
        id: "i1",
        restaurant_id: HOUSE,
        provider_id: "v1",
        master_wine_id: "w-rakı",
        deleted_at: null,
      },
    ];
    const { supabase } = fakeDb(t);
    const out = await readVendorMenuSupply(supabase, HOUSE, NOW);
    expect(out.menu.menus).toBe(2);
    expect(out.menu.wines).toBe(3);
    expect(out.menu.readAt).toBe("2026-09-20T00:00:00Z"); // the newer of the two
    expect(out.suppliers).toEqual([
      { providerId: "v1", menuWines: 1, priced: 0, ordered: 0, stocked: 1 },
    ]);
  });

  it("more than 1000 menu lines are all read — no silent PostgREST cap", async () => {
    const t = baseTables();
    const n = PAGE_ROWS * 2 + 7;
    t.menu_items = Array.from({ length: n }, (_, i) => ({
      id: `L${pad(i)}`,
      menu_id: "m-active",
      restaurant_id: HOUSE,
      status: "active",
      wine_library_id: `w${i}`,
    }));
    t.restaurant_inventory = [
      {
        id: "i-last",
        restaurant_id: HOUSE,
        provider_id: "v-last",
        master_wine_id: `w${n - 1}`,
        deleted_at: null,
      },
    ];
    const { supabase, seen } = fakeDb(t);
    const out = await readVendorMenuSupply(supabase, HOUSE, NOW);
    expect(out.menu.lines).toBe(n);
    expect(out.menu.wines).toBe(n);
    expect(seen.filter((s) => s.table === "menu_items")).toHaveLength(3);
    expect(out.suppliers.map((s) => s.providerId)).toEqual(["v-last"]);
  });

  it("a menu whose lines link no wine answers wines=0 and reads no evidence", async () => {
    const t = baseTables();
    t.menu_items = [
      {
        id: "l1",
        menu_id: "m-active",
        restaurant_id: HOUSE,
        status: "active",
        wine_library_id: null,
      },
    ];
    const { supabase, seen } = fakeDb(t);
    const out = await readVendorMenuSupply(supabase, HOUSE, NOW);
    expect(out.menu).toMatchObject({
      current: true,
      lines: 1,
      linkedLines: 0,
      wines: 0,
    });
    expect(out.suppliers).toEqual([]);
    expect(seen.some((s) => s.table === "price_history")).toBe(false);
  });
});

describe("readVendorMenuSupply — purchase evidence", () => {
  it("a vendor with only price-history evidence appears (F7: inventory alone is near-empty)", async () => {
    const t = baseTables();
    t.price_history = [
      {
        id: "p1",
        restaurant_id: HOUSE,
        provider_id: "v-priced",
        master_wine_id: "w-malbec",
        effective_date: daysAgo(10),
      },
    ];
    const { supabase } = fakeDb(t);
    const out = await readVendorMenuSupply(supabase, HOUSE, NOW);
    expect(out.suppliers).toEqual([
      {
        providerId: "v-priced",
        menuWines: 1,
        priced: 1,
        ordered: 0,
        stocked: 0,
      },
    ]);
  });

  it(`price history counts inside ${SUPPLY_WINDOW_DAYS} days only`, async () => {
    const t = baseTables();
    t.price_history = [
      {
        id: "p1",
        restaurant_id: HOUSE,
        provider_id: "v-recent",
        master_wine_id: "w-malbec",
        effective_date: daysAgo(SUPPLY_WINDOW_DAYS - 1),
      },
      {
        id: "p2",
        restaurant_id: HOUSE,
        provider_id: "v-stale",
        master_wine_id: "w-malbec",
        effective_date: daysAgo(SUPPLY_WINDOW_DAYS + 1),
      },
    ];
    const { supabase } = fakeDb(t);
    const out = await readVendorMenuSupply(supabase, HOUSE, NOW);
    expect(out.suppliers.map((s) => s.providerId)).toEqual(["v-recent"]);
    expect(out.since).toBe(daysAgo(SUPPLY_WINDOW_DAYS));
  });

  it("an order line counts only when the order reached the vendor", async () => {
    const t = baseTables();
    t.procurement_orders = [
      {
        id: "o-delivered",
        restaurant_id: HOUSE,
        provider_id: "v-delivered",
        status: "DELIVERED",
      },
      {
        id: "o-transit",
        restaurant_id: HOUSE,
        provider_id: "v-transit",
        status: "IN_TRANSIT",
      },
      {
        id: "o-pending",
        restaurant_id: HOUSE,
        provider_id: "v-pending",
        status: "PENDING",
      },
      {
        id: "o-cancelled",
        restaurant_id: HOUSE,
        provider_id: "v-cancelled",
        status: "CANCELLED",
      },
    ];
    t.procurement_order_items = t.procurement_orders.map((o, i) => ({
      id: `oi${i}`,
      order_id: o.id,
      restaurant_id: null,
      master_wine_id: "w-rose",
    }));
    const { supabase } = fakeDb(t);
    const out = await readVendorMenuSupply(supabase, HOUSE, NOW);
    // restaurant_id is NULL on these old lines: the house is read off the ORDER.
    expect(out.suppliers.map((s) => s.providerId).sort()).toEqual([
      "v-delivered",
      "v-transit",
    ]);
    expect(out.suppliers[0]).toMatchObject({
      ordered: 1,
      priced: 0,
      stocked: 0,
    });
  });

  it("a deleted inventory row is not evidence", async () => {
    const t = baseTables();
    t.restaurant_inventory = [
      {
        id: "i1",
        restaurant_id: HOUSE,
        provider_id: "v-live",
        master_wine_id: "w-malbec",
        deleted_at: null,
      },
      {
        id: "i2",
        restaurant_id: HOUSE,
        provider_id: "v-deleted",
        master_wine_id: "w-rose",
        deleted_at: "2026-09-01T00:00:00Z",
      },
    ];
    const { supabase } = fakeDb(t);
    const out = await readVendorMenuSupply(supabase, HOUSE, NOW);
    expect(out.suppliers.map((s) => s.providerId)).toEqual(["v-live"]);
  });

  it("one vendor's three kinds of evidence count each menu wine once", async () => {
    const t = baseTables();
    t.price_history = [
      {
        id: "p1",
        restaurant_id: HOUSE,
        provider_id: "v1",
        master_wine_id: "w-malbec",
        effective_date: daysAgo(1),
      },
    ];
    t.procurement_orders = [
      {
        id: "o1",
        restaurant_id: HOUSE,
        provider_id: "v1",
        status: "COMPLETED",
      },
    ];
    t.procurement_order_items = [
      { id: "oi1", order_id: "o1", master_wine_id: "w-malbec" },
    ];
    t.restaurant_inventory = [
      {
        id: "i1",
        restaurant_id: HOUSE,
        provider_id: "v1",
        master_wine_id: "w-rose",
        deleted_at: null,
      },
      {
        id: "i2",
        restaurant_id: HOUSE,
        provider_id: "v2",
        master_wine_id: "w-rose",
        deleted_at: null,
      },
    ];
    const { supabase } = fakeDb(t);
    const out = await readVendorMenuSupply(supabase, HOUSE, NOW);
    expect(out.suppliers).toEqual([
      { providerId: "v1", menuWines: 2, priced: 1, ordered: 1, stocked: 1 },
      { providerId: "v2", menuWines: 1, priced: 0, ordered: 0, stocked: 1 },
    ]);
  });

  it("evidence for a wine NOT on the menu does not make a supplier", async () => {
    const t = baseTables();
    t.restaurant_inventory = [
      {
        id: "i1",
        restaurant_id: HOUSE,
        provider_id: "v1",
        master_wine_id: "w-not-on-menu",
        deleted_at: null,
      },
    ];
    const { supabase } = fakeDb(t);
    const out = await readVendorMenuSupply(supabase, HOUSE, NOW);
    expect(out.suppliers).toEqual([]);
  });
});

describe("readVendorMenuSupply — house isolation (ADR 0147, ADR 0221)", () => {
  it("another house's menu and evidence never count", async () => {
    const t = baseTables();
    t.menu_items.push({
      id: "lx",
      menu_id: "m-active",
      restaurant_id: OTHER,
      status: "active",
      wine_library_id: "w-smuggled",
    });
    t.price_history = [
      {
        id: "p1",
        restaurant_id: OTHER,
        provider_id: "v-theirs",
        master_wine_id: "w-malbec",
        effective_date: daysAgo(1),
      },
    ];
    t.procurement_orders = [
      {
        id: "o1",
        restaurant_id: OTHER,
        provider_id: "v-theirs-2",
        status: "DELIVERED",
      },
    ];
    t.procurement_order_items = [
      {
        id: "oi1",
        order_id: "o1",
        restaurant_id: HOUSE,
        master_wine_id: "w-rose",
      },
    ];
    t.restaurant_inventory = [
      {
        id: "i1",
        restaurant_id: OTHER,
        provider_id: "v-theirs-3",
        master_wine_id: "w-rose",
        deleted_at: null,
      },
    ];
    const { supabase } = fakeDb(t);
    const out = await readVendorMenuSupply(supabase, HOUSE, NOW);
    expect(out.menu.wines).toBe(2);
    expect(out.suppliers).toEqual([]);
  });

  it("every read carries the caller's house", async () => {
    const t = baseTables();
    t.restaurant_inventory = [
      {
        id: "i1",
        restaurant_id: HOUSE,
        provider_id: "v1",
        master_wine_id: "w-rose",
        deleted_at: null,
      },
    ];
    const { supabase, seen } = fakeDb(t);
    await readVendorMenuSupply(supabase, HOUSE, NOW);
    const scopeCol: Record<string, string> = {
      restaurant_menus: "restaurant_id",
      menu_items: "restaurant_id",
      price_history: "restaurant_id",
      procurement_order_items: "procurement_orders.restaurant_id",
      restaurant_inventory: "restaurant_id",
    };
    expect(new Set(seen.map((s) => s.table))).toEqual(
      new Set(Object.keys(scopeCol)),
    );
    for (const s of seen) {
      expect(s.filters).toContainEqual({
        op: "eq",
        col: scopeCol[s.table],
        val: HOUSE,
      });
    }
  });
});

describe("failure is never an empty answer", () => {
  it.each([
    "restaurant_menus",
    "menu_items",
    "price_history",
    "procurement_order_items",
    "restaurant_inventory",
  ])("a failed read of %s throws", async (table) => {
    const t = baseTables();
    const { supabase } = fakeDb(t, table);
    await expect(readVendorMenuSupply(supabase, HOUSE, NOW)).rejects.toThrow(
      /could not be read/,
    );
  });

  it("the service turns a failed read into a 503 with the reason", async () => {
    const { supabase } = fakeDb(baseTables(), "price_history");
    const svc = Object.create(ProvidersService.prototype) as any;
    svc.databaseService = { supabase };
    svc.logger = { error: jest.fn() };
    const err = await svc.vendorMenuSupply(HOUSE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as Error).message).toMatch(
      /price history could not be read.*not a menu no vendor supplies/,
    );
  });
});

describe("GET /providers/menu-supply", () => {
  const organizations: any = {};

  it("answers for the caller's house only", async () => {
    const vendorMenuSupply = jest.fn().mockResolvedValue({ suppliers: [] });
    const c = new ProvidersController(
      { vendorMenuSupply } as any,
      organizations,
    );
    await c.menuSupply({ userId: "u1", restaurantId: HOUSE });
    expect(vendorMenuSupply).toHaveBeenCalledWith(HOUSE);
  });

  it("refuses a session that names no house (403), and reads nothing", async () => {
    const vendorMenuSupply = jest.fn();
    const c = new ProvidersController(
      { vendorMenuSupply } as any,
      organizations,
    );
    await expect(
      c.menuSupply({ userId: "u1", restaurantId: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(vendorMenuSupply).not.toHaveBeenCalled();
  });
});
