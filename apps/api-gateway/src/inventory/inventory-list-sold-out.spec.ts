import { InventoryService } from "./inventory.service";
import { DatabaseService } from "../database/database.service";

/**
 * F-1434: an 86 was seen only where it was set. The list now carries each
 * row's open stock-out (stock_outs, ended_at null), so every row -- a spirit
 * or a beer as much as a wine -- says it is sold out without being opened.
 * A failed read says `soldOutReadable: false`, never a list of available rows.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";

function fakeClient(tables: Record<string, any[]>, failing: string[] = []) {
  return {
    from(table: string) {
      const filters: Array<(r: any) => boolean> = [];
      const q: any = {
        select: () => q,
        eq: (col: string, v: unknown) => {
          filters.push((r) => r[col] === undefined || r[col] === v);
          return q;
        },
        is: (col: string, v: unknown) => {
          filters.push((r) => (r[col] ?? null) === v);
          return q;
        },
        order: () => q,
        gte: () => q,
        gt: () => q,
        limit: () => q,
        range: () => q,
        then(res: any, rej: any) {
          if (failing.includes(table)) {
            return Promise.resolve({
              data: null,
              error: { message: "boom" },
              count: null,
            }).then(res, rej);
          }
          const rows = (tables[table] ?? []).filter((r) =>
            filters.every((f) => f(r)),
          );
          return Promise.resolve({
            data: rows,
            error: null,
            count: rows.length,
          }).then(res, rej);
        },
      };
      return q;
    },
  };
}

function service(tables: Record<string, any[]>, failing: string[] = []) {
  const client = fakeClient(tables, failing);
  const db = new DatabaseService({ get: () => undefined } as any);
  db.supabase = client as any;
  (db as any).getClient = () => client;
  return new InventoryService(db);
}

const items = [
  { id: "inv-wine", restaurant_id: HOUSE, is_active: true, kind: "wine" },
  { id: "inv-titos", restaurant_id: HOUSE, is_active: true, kind: "spirit" },
  { id: "inv-beer", restaurant_id: HOUSE, is_active: true, kind: "beer" },
];

describe("F-1434: the inventory list says which rows are sold out", () => {
  it("marks a spirit's open 86 on its list row, and only that row", async () => {
    const inventory = service({
      restaurant_inventory: items,
      stock_outs: [
        {
          id: "so-1",
          restaurant_id: HOUSE,
          inventory_id: "inv-titos",
          cause: "ran_out",
          started_at: "2026-10-10T21:00:00Z",
          ended_at: null,
        },
        {
          id: "so-0",
          restaurant_id: HOUSE,
          inventory_id: "inv-beer",
          cause: "broken",
          started_at: "2026-10-01T21:00:00Z",
          ended_at: "2026-10-02T12:00:00Z",
        },
      ],
    });

    const list = await inventory.getRestaurantInventory(HOUSE);
    const by = new Map(list.map((r: any) => [r.id, r]));

    expect(by.get("inv-titos")).toMatchObject({
      soldOut: { cause: "ran_out", startedAt: "2026-10-10T21:00:00Z" },
      soldOutReadable: true,
    });
    // An ended 86 is back on; a row never 86'd is not sold out.
    expect(by.get("inv-beer")).toMatchObject({
      soldOut: null,
      soldOutReadable: true,
    });
    expect(by.get("inv-wine")).toMatchObject({
      soldOut: null,
      soldOutReadable: true,
    });
  });

  it("says the sold-out read failed instead of showing every row available", async () => {
    const inventory = service({ restaurant_inventory: items }, ["stock_outs"]);

    const list = await inventory.getRestaurantInventory(HOUSE);

    expect(list).toHaveLength(3);
    for (const r of list as any[]) {
      expect(r.soldOutReadable).toBe(false);
      expect(r.soldOut).toBeNull();
    }
  });
});
