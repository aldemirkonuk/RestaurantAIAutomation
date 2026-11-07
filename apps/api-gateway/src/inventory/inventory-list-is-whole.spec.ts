import { DatabaseService } from "../database/database.service";
import { InventoryService } from "./inventory.service";
import { ViewReadError, readViewWhole } from "./read-view-whole";

/**
 * QA round 2, H-1: /inventory read its goods, and the three views it joins
 * onto them, with one unranged `select` each. PostgREST stops every response
 * at `max_rows` (1,000, supabase/config.toml:18) and says nothing, so a house
 * with 1,400 goods saw 1,000 of them under a footer reading "All 1,000 of
 * 1,000 titles are listed", and a house holding its goods in three places lost
 * its zone names past about 333 goods.
 *
 * `fakePostgrest` models what the hosted API does with these reads: rows
 * sorted by the `order` columns asked for, `gt` and `range`/`limit` applied,
 * an exact count when `{ count: "exact" }` was asked for (the rows left past a
 * `gt` cursor, as PostgREST counts them), and never more than `cap` rows.
 */

type Row = Record<string, any>;

function fakePostgrest(
  tables: Record<string, Row[]>,
  opts: { cap?: number; failOnCall?: { table: string; call: number } } = {},
) {
  const cap = opts.cap ?? 1000;
  const calls: Record<string, number> = {};
  const client = {
    from(table: string) {
      const state: {
        counted: boolean;
        orders: string[];
        gt: [string, string] | null;
        limit: number | null;
        range: [number, number] | null;
      } = { counted: false, orders: [], gt: null, limit: null, range: null };
      const q: any = {
        select(_cols: string, o?: { count?: string }) {
          state.counted = o?.count === "exact";
          return q;
        },
        eq: () => q,
        order(c: string) {
          state.orders.push(c);
          return q;
        },
        gt(c: string, v: string) {
          state.gt = [c, v];
          return q;
        },
        limit(n: number) {
          state.limit = n;
          return q;
        },
        range(a: number, b: number) {
          state.range = [a, b];
          return q;
        },
        then(resolve: (v: any) => any, reject?: (e: any) => any) {
          calls[table] = (calls[table] ?? 0) + 1;
          if (
            opts.failOnCall &&
            opts.failOnCall.table === table &&
            opts.failOnCall.call === calls[table]
          ) {
            return Promise.resolve({
              data: null,
              error: { code: "57014", message: "statement timeout" },
              count: null,
            }).then(resolve, reject);
          }
          let rows = [...(tables[table] ?? [])];
          const key = (r: Row) =>
            state.orders.map((c) => (r[c] === null ? "￿" : String(r[c])));
          if (state.orders.length) {
            rows.sort((x, y) => {
              const a = key(x);
              const b = key(y);
              for (let i = 0; i < a.length; i++) {
                if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
              }
              return 0;
            });
          }
          if (state.gt) {
            const [c, v] = state.gt;
            rows = rows.filter((r) => String(r[c]) > v);
          }
          const count = state.counted ? rows.length : null;
          let from = 0;
          let to = rows.length - 1;
          if (state.range) [from, to] = state.range;
          if (state.limit !== null) to = Math.min(to, from + state.limit - 1);
          to = Math.min(to, from + cap - 1);
          const data = rows.slice(from, to + 1);
          return Promise.resolve({ data, error: null, count }).then(
            resolve,
            reject,
          );
        },
      };
      return q;
    },
  };
  return { client, calls };
}

const pad = (n: number) => String(n).padStart(5, "0");
const GOODS = 1400;
const goods: Row[] = Array.from({ length: GOODS }, (_, i) => ({
  id: `inv-${pad(i)}`,
  restaurant_id: "r1",
  master_wine_id: `mw-${pad(i)}`,
  stock_live: 4,
  threshold_min: 2,
  is_active: true,
  wine_name: `Wine ${i}`,
}));

describe("the /inventory list is read whole past PostgREST's 1,000-row cap (H-1)", () => {
  it("DatabaseService.getRestaurantInventory returns all 1,400 goods, not the first 1,000", async () => {
    const { client } = fakePostgrest({ restaurant_inventory: goods });
    const db = new DatabaseService({} as any);
    db.supabase = client as any;

    const rows = await db.getRestaurantInventory("r1");

    expect(rows).toHaveLength(GOODS);
    expect(new Set(rows.map((r: Row) => r.id)).size).toBe(GOODS);
  });

  it("refuses the list when a page fails, instead of answering with the pages in hand", async () => {
    const { client } = fakePostgrest(
      { restaurant_inventory: goods },
      { failOnCall: { table: "restaurant_inventory", call: 2 } },
    );
    const db = new DatabaseService({} as any);
    db.supabase = client as any;

    await expect(db.getRestaurantInventory("r1")).rejects.toThrow(
      /could not be read whole/,
    );
  });

  it("joins every good's places, lots and pace, though the place view holds 4,200 rows", async () => {
    const rollup = goods.map((g) => ({
      inventory_id: g.id,
      restaurant_id: "r1",
      live_qty: 4,
      shadow_qty: 0,
      wac: 10,
      has_invoice_cost: true,
      live_location_count: 3,
      open_ml: 0,
    }));
    const places = goods.flatMap((g) =>
      ["loc-a", "loc-b", "loc-c"].map((loc) => ({
        inventory_id: g.id,
        master_wine_id: g.master_wine_id,
        restaurant_id: "r1",
        location_id: loc,
        stock_state: "live",
        qty: 1,
        wac: 10,
      })),
    );
    const pace = goods.map((g) => ({
      inventory_id: g.id,
      restaurant_id: "r1",
      velocity_per_day: 0.5,
      days_of_cover: 8,
      reorder_point: 2,
      reorder_suggested: false,
      abc_class: "B",
      dead_stock: false,
      days_since_sale: 1,
    }));
    const { client } = fakePostgrest({
      restaurant_inventory: goods,
      inventory_lot_rollup: rollup,
      inventory_location_breakdown: places,
      inventory_analytics: pace,
    });
    const db = new DatabaseService({} as any);
    db.supabase = client as any;
    const service = new InventoryService(db);

    const items: any[] = await service.getRestaurantInventory("r1");

    expect(items).toHaveLength(GOODS);
    const withoutPlaces = items.filter((i) => (i.locations ?? []).length !== 3);
    expect(withoutPlaces).toHaveLength(0);
    const withoutPace = items.filter((i) => i.velocityPerDay === undefined);
    expect(withoutPace).toHaveLength(0);
    const withoutLots = items.filter((i) => i.lotLiveQty === undefined);
    expect(withoutLots).toHaveLength(0);
    expect(items.every((i) => i.analyticsReadable === true)).toBe(true);
  });
});

describe("readViewWhole", () => {
  const view = Array.from({ length: 2500 }, (_, i) => ({
    inventory_id: `inv-${pad(i)}`,
  }));
  const build = (client: any) => () =>
    client.from("v").select("inventory_id", { count: "exact" }).eq("r", 1);

  it("reads every page, in the order named", async () => {
    const { client, calls } = fakePostgrest({ v: view });
    const rows = await readViewWhole("v", build(client), ["inventory_id"]);
    expect(rows.map((r: Row) => r.inventory_id)).toEqual(
      view.map((r) => r.inventory_id),
    );
    expect(calls.v).toBe(3);
  });

  it("follows a server whose cap is below the page asked for", async () => {
    const { client } = fakePostgrest({ v: view }, { cap: 300 });
    const rows = await readViewWhole("v", build(client), ["inventory_id"]);
    expect(rows).toHaveLength(2500);
    expect(new Set(rows.map((r: Row) => r.inventory_id)).size).toBe(2500);
  });

  it("throws when a later page fails, never returning the pages in hand", async () => {
    const { client } = fakePostgrest(
      { v: view },
      { failOnCall: { table: "v", call: 2 } },
    );
    await expect(
      readViewWhole("v", build(client), ["inventory_id"]),
    ).rejects.toBeInstanceOf(ViewReadError);
  });

  it("throws when the count moves between pages", async () => {
    const tables = { v: [...view] };
    const { client } = fakePostgrest(tables);
    let n = 0;
    const moving = () => {
      if (++n === 2) tables.v.push({ inventory_id: "inv-99999" });
      return build(client)();
    };
    await expect(readViewWhole("v", moving, ["inventory_id"])).rejects.toThrow(
      /2500 rows when the read began and 2501/,
    );
  });

  it("throws when no count comes back", async () => {
    const { client } = fakePostgrest({ v: view });
    await expect(
      readViewWhole(
        "v",
        () => client.from("v").select("inventory_id").eq("r", 1),
        ["inventory_id"],
      ),
    ).rejects.toThrow(/reported no count/);
  });
});
