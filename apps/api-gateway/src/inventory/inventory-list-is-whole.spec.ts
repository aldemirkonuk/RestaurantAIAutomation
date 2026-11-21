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
  opts: {
    cap?: number;
    failOnCall?: { table: string; call: number };
    /** Rows tied on every `order` column come back reversed on even calls: PostgREST promises no order among ties. */
    tiesUnstable?: boolean;
  } = {},
) {
  const cap = opts.cap ?? 1000;
  const calls: Record<string, number> = {};
  const orderLog: Record<string, string[][]> = {};
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
          (orderLog[table] ??= []).push([...state.orders]);
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
            if (opts.tiesUnstable && calls[table] % 2 === 0) {
              // Reverse each run of rows tied on every order column.
              const out: Row[] = [];
              for (let i = 0; i < rows.length; ) {
                let j = i + 1;
                while (j < rows.length && key(rows[j]).join() === key(rows[i]).join()) j++;
                out.push(...rows.slice(i, j).reverse());
                i = j;
              }
              rows = out;
            }
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
  return { client, calls, orderLog };
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

  it("reads 1,001 goods whole: the one past the first page is kept, and pages run id ascending", async () => {
    // The table is handed over newest-id first; only an `order id asc` keyset
    // can walk it to the end without skipping or repeating a row at the seam.
    const edge = goods.slice(0, 1001).reverse();
    const { client, calls } = fakePostgrest({ restaurant_inventory: edge });
    const db = new DatabaseService({} as any);
    db.supabase = client as any;

    const rows = await db.getRestaurantInventory("r1");

    expect(rows).toHaveLength(1001);
    expect(rows.map((r: Row) => r.id)).toEqual(
      goods.slice(0, 1001).map((g) => g.id),
    );
    expect(calls.restaurant_inventory).toBe(2);
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

describe("the per-good views are paged by a total order (DD-r103-17)", () => {
  // inventory_lot_rollup groups by (inventory_id, restaurant_id, master_wine_id)
  // and has no `id` column, so the whole grouping key is its total order. The
  // two tied rows below straddle the 1,000-row page edge.
  const tied = [
    ...Array.from({ length: 999 }, (_, i) => ({
      inventory_id: `inv-${pad(i)}`,
      master_wine_id: "mw-a",
    })),
    { inventory_id: "inv-00999", master_wine_id: "mw-a" },
    { inventory_id: "inv-00999", master_wine_id: "mw-b" },
  ];
  const build = (client: any) => () =>
    client.from("v").select("inventory_id", { count: "exact" }).eq("r", 1);

  it("repeats a row and loses its twin when only the repeating column is named", async () => {
    const { client } = fakePostgrest({ v: tied }, { tiesUnstable: true });
    const rows = await readViewWhole("v", build(client), ["inventory_id"]);
    const keys = rows.map((r: Row) => `${r.inventory_id}/${r.master_wine_id}`);
    expect(new Set(keys).size).toBeLessThan(tied.length);
  });

  it("reads every tied row exactly once when the whole key is named", async () => {
    const { client } = fakePostgrest({ v: tied }, { tiesUnstable: true });
    const rows = await readViewWhole("v", build(client), [
      "inventory_id",
      "master_wine_id",
    ]);
    const keys = rows.map((r: Row) => `${r.inventory_id}/${r.master_wine_id}`);
    expect(rows).toHaveLength(tied.length);
    expect(new Set(keys).size).toBe(tied.length);
  });

  it("names the whole grouping key of each view /inventory reads", async () => {
    const rollup = [{ inventory_id: "g1", master_wine_id: "mw-1", live_qty: 1 }];
    const { client, orderLog } = fakePostgrest({
      restaurant_inventory: [
        { id: "g1", restaurant_id: "r1", master_wine_id: "mw-1", is_active: true },
      ],
      inventory_lot_rollup: rollup,
      inventory_location_breakdown: [],
      inventory_analytics: [{ inventory_id: "g1" }],
    });
    const db = new DatabaseService({} as any);
    db.supabase = client as any;
    await new InventoryService(db).getRestaurantInventory("r1");

    expect(orderLog.inventory_lot_rollup[0]).toEqual([
      "inventory_id",
      "master_wine_id",
    ]);
    expect(orderLog.inventory_location_breakdown[0]).toEqual([
      "inventory_id",
      "location_id",
      "master_wine_id",
    ]);
    // inventory_analytics is one row per restaurant_inventory.id.
    expect(orderLog.inventory_analytics[0]).toEqual(["inventory_id"]);
  });
});
