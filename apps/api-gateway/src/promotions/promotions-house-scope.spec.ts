import { MenusService } from "../menus/menus.service";
import { DatabaseService } from "../database/database.service";
import { PAID_LINES_CAP, PromotionsService } from "./promotions.service";

/**
 * The house-first ladder, end to end through `readForHouse` with the real
 * `MenusService` (founder item 36; research-filters.md adversarial pass test
 * list). The fake HONOURS `limit` and `gt`, so the keyset paging loops really
 * run — a fake that ignored the page size would pass a read that stops at
 * 1000 rows, which is the exact silent cap these cases exist to catch.
 */

type Row = Record<string, any>;

interface Call {
  table: string;
  eqs: Array<[string, unknown]>;
}

function fakeSupabase(tables: Record<string, Row[]>, calls: Call[]) {
  function from(table: string) {
    const eqs: Array<[string, unknown]> = [];
    const preds: Array<(r: Row) => boolean> = [];
    let limit = Infinity;
    const call: Call = { table, eqs };
    calls.push(call);
    const api: any = new Proxy(
      {},
      {
        get(_t, prop: string) {
          switch (prop) {
            case "eq":
              return (c: string, v: unknown) => {
                eqs.push([c, v]);
                preds.push((r) => r[c] === v);
                return api;
              };
            case "neq":
              return (c: string, v: unknown) => {
                preds.push((r) => r[c] !== v);
                return api;
              };
            case "gt":
              return (c: string, v: unknown) => {
                preds.push((r) => String(r[c]) > String(v));
                return api;
              };
            case "is":
              return (c: string, v: unknown) => {
                preds.push((r) => (r[c] ?? null) === v);
                return api;
              };
            case "limit":
              return (n: number) => {
                limit = n;
                return api;
              };
            case "then":
              return (resolve: any) => {
                const rows = (tables[table] ?? [])
                  .filter((r) => preds.every((p) => p(r)))
                  .sort((a, b) => String(a.id).localeCompare(String(b.id)))
                  .slice(0, limit);
                resolve({ data: rows, error: null });
              };
            default:
              // select / order / gte / or / … — narrowing this fake does not model.
              return () => api;
          }
        },
      },
    );
    return api;
  }
  return { from } as any;
}

const HOUSE = "house-1";
const OTHER = "house-2";
const pad = (n: number) => String(n).padStart(5, "0");

function offerRow(over: Row): Row {
  return {
    id: "offer-x",
    provider_id: "vendor-a",
    restaurant_id: HOUSE,
    name: "Autumn offer",
    promo_type: "percentage",
    description: null,
    conditions: {},
    discount_value: { percent: 10 },
    applicable_wines: [],
    start_date: "2026-09-01",
    end_date: "2026-10-30",
    is_active: true,
    confidence: 0.8,
    created_at: "2026-09-01",
    dismissed_at: null,
    dismissed_by: null,
    providers: { id: "vendor-a", name: "Sevilen" },
    ...over,
  };
}

function shelf(id: string, name: string, key: string, over: Row = {}): Row {
  return {
    id,
    restaurant_id: HOUSE,
    wine_name: name,
    master_wine_id: key,
    is_active: true,
    deleted_at: null,
    stock_live: 0,
    threshold_min: 3,
    last_counted_at: null,
    master_wine_library: { beverage_kind: "wine" },
    ...over,
  };
}

function service(tables: Record<string, Row[]>, calls: Call[] = []) {
  const db = { supabase: fakeSupabase(tables, calls) } as unknown as DatabaseService;
  const menus = new MenusService(db, undefined as any, undefined as any, undefined as any);
  return new PromotionsService(db, menus);
}

const NOW = new Date("2026-09-26T09:00:00Z");

describe("readForHouse — On my menu means the CURRENT menu, read whole", () => {
  it("a wine only on a draft or an archived menu is NOT on my menu", async () => {
    const svc = service({
      provider_promotions: [
        offerRow({ id: "o-draft", applicable_wines: ["Narince"] }),
        offerRow({ id: "o-arch", applicable_wines: ["Öküzgözü"] }),
        offerRow({ id: "o-live", applicable_wines: ["Kalecik Karası"] }),
      ],
      restaurant_inventory: [shelf("i1", "Narince", "mw-n"), shelf("i2", "Öküzgözü", "mw-o"), shelf("i3", "Kalecik Karası", "mw-k")],
      restaurant_menus: [
        { id: "m-draft", restaurant_id: HOUSE, status: "draft", name: "Scan of Sept" },
        { id: "m-arch", restaurant_id: HOUSE, status: "archived", name: "Summer" },
        { id: "m-live", restaurant_id: HOUSE, status: "active", name: "Autumn", made_current_at: "2026-09-10T00:00:00Z" },
      ],
      menu_items: [
        { id: "l1", menu_id: "m-draft", restaurant_id: HOUSE, status: "active", name: "Narince", category: "Whites", wine_library_id: "mw-n" },
        { id: "l2", menu_id: "m-arch", restaurant_id: HOUSE, status: "active", name: "Öküzgözü", category: "Reds", wine_library_id: "mw-o" },
        { id: "l3", menu_id: "m-live", restaurant_id: HOUSE, status: "active", name: "Kalecik Karası", category: "Reds", wine_library_id: "mw-k" },
      ],
    });
    const read = await svc.readForHouse(HOUSE, { now: NOW });
    const by = Object.fromEntries(read.offers.map((o) => [o.id, o.scope.scope]));
    expect(by).toEqual({ "o-draft": "stock", "o-arch": "stock", "o-live": "menu" });
    expect(read.house.menus).toEqual([{ menu_id: "m-live", name: "Autumn", read_at: "2026-09-10T00:00:00Z" }]);
  });

  it("a discarded line on the current menu is not on my menu", async () => {
    const read = await service({
      provider_promotions: [offerRow({ id: "o1", applicable_wines: ["Narince"] })],
      restaurant_inventory: [shelf("i1", "Narince", "mw-n")],
      restaurant_menus: [{ id: "m1", restaurant_id: HOUSE, status: "active" }],
      menu_items: [{ id: "l1", menu_id: "m1", restaurant_id: HOUSE, status: "discarded", name: "Narince", wine_library_id: "mw-n" }],
    }).readForHouse(HOUSE, { now: NOW });
    expect(read.offers[0].scope.scope).toBe("stock");
  });

  it("reads every one of more than 1000 menu lines — the line that matches is past the first page", async () => {
    const lines: Row[] = Array.from({ length: 1500 }, (_, i) => ({
      id: `l${pad(i)}`,
      menu_id: "m1",
      restaurant_id: HOUSE,
      status: "active",
      name: `Wine ${i}`,
      category: "Reds",
      wine_library_id: `mw-${i}`,
    }));
    const read = await service({
      provider_promotions: [offerRow({ id: "o1", applicable_wines: ["Wine 1499"] })],
      restaurant_inventory: [shelf("i1", "Wine 1499", "mw-1499")],
      restaurant_menus: [{ id: "m1", restaurant_id: HOUSE, status: "active" }],
      menu_items: lines,
    }).readForHouse(HOUSE, { now: NOW });
    expect(read.offers[0].scope.scope).toBe("menu");
    expect(read.house.coverage.lines).toBe(1500);
  });

  it("two active menus are unioned, not thrown on", async () => {
    const read = await service({
      provider_promotions: [
        offerRow({ id: "o1", applicable_wines: ["Narince"] }),
        offerRow({ id: "o2", applicable_wines: ["Efes"] }),
      ],
      restaurant_inventory: [shelf("i1", "Narince", "mw-n"), shelf("i2", "Efes", "mw-e", { master_wine_library: { beverage_kind: "beer" } })],
      restaurant_menus: [
        { id: "m1", restaurant_id: HOUSE, status: "active", name: "Wine list" },
        { id: "m2", restaurant_id: HOUSE, status: "active", name: "Bar" },
      ],
      menu_items: [
        { id: "l1", menu_id: "m1", restaurant_id: HOUSE, status: "active", name: "Narince", category: "Whites", wine_library_id: "mw-n" },
        { id: "l2", menu_id: "m2", restaurant_id: HOUSE, status: "active", name: "Efes draft", category: "Beer", wine_library_id: "mw-e" },
      ],
    }).readForHouse(HOUSE, { now: NOW });
    expect(read.offers.map((o) => o.scope.scope)).toEqual(["menu", "menu"]);
    expect(read.house.menus.map((m) => m.menu_id).sort()).toEqual(["m1", "m2"]);
    expect(read.offers.find((o) => o.id === "o2")?.scope.menuMatches[0].menuLine).toBe("Efes draft");
  });

  it("no active menu: every rung below All is empty of menu offers, and the wire says no menu was read", async () => {
    const read = await service({
      provider_promotions: [offerRow({ id: "o1", applicable_wines: ["Narince"] })],
      restaurant_inventory: [shelf("i1", "Narince", "mw-n")],
      restaurant_menus: [{ id: "m1", restaurant_id: HOUSE, status: "draft" }],
      menu_items: [{ id: "l1", menu_id: "m1", restaurant_id: HOUSE, status: "active", name: "Narince", wine_library_id: "mw-n" }],
    }).readForHouse(HOUSE, { now: NOW });
    expect(read.house.menus).toEqual([]);
    expect(read.offers[0].scope.scope).toBe("stock");
  });
});

describe("readForHouse — no silent caps (F12) and the house's own rows only", () => {
  it("reads a shelf past 1000 rows: a wine on row 1400 still places the offer", async () => {
    const rows = Array.from({ length: 1400 }, (_, i) => shelf(`i${pad(i)}`, `Filler ${i}`, `mw-f${i}`));
    rows.push(shelf("i99999", "Narince", "mw-n"));
    const read = await service({
      provider_promotions: [offerRow({ id: "o1", applicable_wines: ["Narince"] })],
      restaurant_inventory: rows,
      restaurant_menus: [],
      menu_items: [],
    }).readForHouse(HOUSE, { now: NOW });
    expect(read.offers[0].scope.scope).toBe("stock");
    expect(read.house.shelf.rows).toBe(1401);
  });

  it("reads more than 1000 offers, whole", async () => {
    const offers = Array.from({ length: 1200 }, (_, i) => offerRow({ id: `o${pad(i)}` }));
    const read = await service({ provider_promotions: offers, restaurant_inventory: [], restaurant_menus: [], menu_items: [] }).readForHouse(HOUSE, {
      now: NOW,
    });
    expect(read.offers).toHaveLength(1200);
  });

  it("says when a ledger read came back at its cap, rather than grading as if the window were whole", async () => {
    const paid = Array.from({ length: PAID_LINES_CAP }, (_, i) => ({
      id: `p${pad(i)}`,
      restaurant_id: HOUSE,
      provider_id: "vendor-a",
      master_wine_id: null,
      identity_id: null,
      price: 100,
      unit: "bottle",
      currency: "TRY",
      quantity: 1,
      effective_date: "2026-09-01",
      source: "receipt_verified",
      master_wine_library: null,
    }));
    const read = await service({
      provider_promotions: [],
      restaurant_inventory: [],
      restaurant_menus: [],
      menu_items: [],
      price_history: paid,
    }).readForHouse(HOUSE, { now: NOW });
    expect(read.ledger.caps.paid_lines).toEqual({ cap: PAID_LINES_CAP, reached: true });
    expect(read.ledger.caps.sightings.reached).toBe(false);
  });

  it("never reads another house's menu, shelf or offers — every new read carries this house's id", async () => {
    const calls: Call[] = [];
    const read = await service(
      {
        provider_promotions: [offerRow({ id: "mine", applicable_wines: ["Narince"] }), offerRow({ id: "theirs", restaurant_id: OTHER, applicable_wines: ["Narince"] })],
        restaurant_inventory: [shelf("i1", "Narince", "mw-n", { restaurant_id: OTHER })],
        restaurant_menus: [{ id: "m-other", restaurant_id: OTHER, status: "active" }],
        menu_items: [{ id: "l1", menu_id: "m-other", restaurant_id: OTHER, status: "active", name: "Narince", wine_library_id: "mw-n" }],
      },
      calls,
    ).readForHouse(HOUSE, { now: NOW });
    expect(read.offers.map((o) => o.id)).toEqual(["mine"]);
    expect(read.offers[0].scope.scope).toBe("other");
    expect(read.house.menus).toEqual([]);
    for (const table of ["provider_promotions", "restaurant_inventory", "restaurant_menus"]) {
      const reads = calls.filter((c) => c.table === table);
      expect(reads.length).toBeGreaterThan(0);
      for (const c of reads) expect(c.eqs).toContainEqual(["restaurant_id", HOUSE]);
    }
  });
});

describe("readForHouse — the per-wine minimum reaches the grade through the offer's own words", () => {
  const ledgerRows = (wines: Array<[string, string]>) =>
    wines.map(([name, key], i) => ({
      id: `p${i}`,
      restaurant_id: HOUSE,
      provider_id: "vendor-b",
      master_wine_id: key,
      identity_id: null,
      price: 380,
      unit: "bottle",
      currency: "TRY",
      quantity: 6,
      effective_date: "2026-09-01",
      source: "receipt_verified",
      master_wine_library: { name, vintage: null },
    }));

  it("reads 'mixed case' in the offer's description as a mixed minimum", async () => {
    const read = await service({
      provider_promotions: [
        offerRow({
          id: "o1",
          description: "10% off any mixed case of 12",
          conditions: { min_qty: 12, min_qty_unit: "bottle" },
          applicable_wines: ["Narince", "Öküzgözü"],
        }),
      ],
      restaurant_inventory: [shelf("i1", "Narince", "mw-n"), shelf("i2", "Öküzgözü", "mw-o")],
      restaurant_menus: [],
      menu_items: [],
      price_history: ledgerRows([
        ["Narince", "mw-n"],
        ["Öküzgözü", "mw-o"],
      ]),
    }).readForHouse(HOUSE, { now: NOW });
    expect(read.offers[0].grade.qualification?.basis).toBe("mixed");
    expect(read.offers[0].grade.qualification?.state).toBe("qualifies");
  });

  it("with no such words, the same orders do not qualify per wine", async () => {
    const read = await service({
      provider_promotions: [
        offerRow({ id: "o1", conditions: { min_qty: 12, min_qty_unit: "bottle" }, applicable_wines: ["Narince", "Öküzgözü"] }),
      ],
      restaurant_inventory: [shelf("i1", "Narince", "mw-n"), shelf("i2", "Öküzgözü", "mw-o")],
      restaurant_menus: [],
      menu_items: [],
      price_history: ledgerRows([
        ["Narince", "mw-n"],
        ["Öküzgözü", "mw-o"],
      ]),
    }).readForHouse(HOUSE, { now: NOW });
    expect(read.offers[0].grade.qualification?.basis).toBe("per_wine");
    expect(read.offers[0].grade.qualification?.state).toBe("not_shown");
  });
});
