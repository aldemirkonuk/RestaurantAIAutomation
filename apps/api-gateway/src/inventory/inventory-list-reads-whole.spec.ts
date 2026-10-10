import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { HttpException } from "@nestjs/common";
import { InventoryService } from "./inventory.service";
import { DatabaseService } from "../database/database.service";
import { InventoryLedgerController } from "../inventory-ledger/inventory-ledger.controller";
import { CreateInventoryTransactionDto } from "../inventory-ledger/dto/inventory-ledger.dto";

/**
 * F-293: /inventory and its lot, location and sales-pace joins were read with no
 * range, so PostgREST's 1,000-row cap cut them with a 200. 400 wines in 3 rooms
 * is 1,200 location rows; past 1,000 active items whole wines left the list.
 * The two lot reads also ignored `error`, so a failed read looked like "no lots".
 *
 * F-292 (gateway half): manual adjust now posts a delta to the ledger's
 * transactions route. Non-wine house items have no wine id, and a take-off
 * below zero was a 500 carrying the database's sentence.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const CAP = 1000;

const pad = (n: number) => String(n).padStart(5, "0");

/** A PostgREST double that caps every answer at 1,000 rows, as production does. */
function fakeClient(tables: Record<string, any[]>, failing: string[] = []) {
  return {
    from(table: string) {
      const q: any = {
        _rows: tables[table] ?? [],
        _count: false,
        _gt: null as null | string,
        _from: 0,
        _to: CAP - 1,
        _limit: CAP,
        select(_cols: string, opts?: { count?: string }) {
          q._count = opts?.count === "exact";
          return q;
        },
        eq() {
          return q;
        },
        order() {
          return q;
        },
        gt(_col: string, v: string) {
          q._gt = v;
          return q;
        },
        limit(n: number) {
          q._limit = n;
          return q;
        },
        range(a: number, b: number) {
          q._from = a;
          q._to = b;
          return q;
        },
        then(res: any, rej: any) {
          if (failing.includes(table)) {
            return Promise.resolve({
              data: null,
              error: { message: "boom" },
              count: null,
            }).then(res, rej);
          }
          let rows = q._rows;
          if (q._gt !== null) rows = rows.filter((r: any) => r.id > q._gt);
          const remaining = rows.length;
          const size = Math.min(CAP, q._to - q._from + 1, q._limit);
          const page = rows.slice(q._gt !== null ? 0 : q._from).slice(0, size);
          return Promise.resolve({
            data: page,
            error: null,
            count: q._count ? (q._gt !== null ? remaining : q._rows.length) : null,
          }).then(res, rej);
        },
      };
      return q;
    },
  };
}

function house(n: number, rooms: number) {
  const items = Array.from({ length: n }, (_, i) => ({
    id: `inv-${pad(i)}`,
    restaurant_id: HOUSE,
    is_active: true,
    stock_live: rooms * 2,
  }));
  const rollup = items.map((r) => ({
    inventory_id: r.id,
    live_qty: rooms * 2,
    wac: 10,
    open_ml: 0,
  }));
  const breakdown = items.flatMap((r) =>
    Array.from({ length: rooms }, (_, k) => ({
      inventory_id: r.id,
      location_id: `loc-${k}`,
      qty: 2,
      wac: 10,
    })),
  );
  const analytics = items.map((r) => ({
    inventory_id: r.id,
    velocity_per_day: 0.5,
  }));
  return { items, rollup, breakdown, analytics };
}

function services(tables: Record<string, any[]>, failing: string[] = []) {
  const client = fakeClient(tables, failing);
  const db = new DatabaseService({ get: () => undefined } as any);
  db.supabase = client as any;
  (db as any).getClient = () => client;
  const inventory = new InventoryService(db);
  return { db, inventory };
}

describe("F-293: the inventory list is read whole", () => {
  it("reads every active item past 1,000, not the first page", async () => {
    const { items } = house(1500, 1);
    const { db } = services({ restaurant_inventory: items });

    const rows = await db.getRestaurantInventory(HOUSE);

    expect(rows).toHaveLength(1500);
  });

  it("keeps every wine's shelves when the location view passes 1,000 rows", async () => {
    // 400 wines in 3 rooms: 1,200 location rows.
    const h = house(400, 3);
    const { inventory } = services({
      restaurant_inventory: h.items,
      inventory_lot_rollup: h.rollup,
      inventory_location_breakdown: h.breakdown,
      inventory_analytics: h.analytics,
    });

    const list = await inventory.getRestaurantInventory(HOUSE);

    expect(list).toHaveLength(400);
    const last = list.find((r: any) => r.id === "inv-00399") as any;
    expect(last.locations).toHaveLength(3);
    expect(list.every((r: any) => r.locations.length === 3)).toBe(true);
  });

  it("keeps lot totals and sales pace for items past the 1,000th", async () => {
    const h = house(1200, 1);
    const { inventory } = services({
      restaurant_inventory: h.items,
      inventory_lot_rollup: h.rollup,
      inventory_location_breakdown: h.breakdown,
      inventory_analytics: h.analytics,
    });

    const list = (await inventory.getRestaurantInventory(HOUSE)) as any[];
    const late = list.find((r) => r.id === "inv-01150");

    expect(late.lotLiveQty).toBe(2);
    expect(late.velocityPerDay).toBe(0.5);
  });

  it("refuses the list when the lot read fails, instead of showing no lots", async () => {
    const h = house(3, 1);
    const { inventory } = services(
      {
        restaurant_inventory: h.items,
        inventory_location_breakdown: h.breakdown,
        inventory_analytics: h.analytics,
      },
      ["inventory_lot_rollup"],
    );

    await expect(inventory.getRestaurantInventory(HOUSE)).rejects.toThrow(
      /lot totals could not be read/,
    );
  });
});

describe("F-292: a manual adjust is a delta on the ledger's transactions route", () => {
  it("accepts a house item with no wine id", async () => {
    const dto = plainToInstance(CreateInventoryTransactionDto, {
      inventoryId: "22222222-2222-4222-8222-222222222222",
      transactionType: "adjustment",
      source: "manual",
      quantityChange: -1,
      reason: "Breakage",
      idempotencyKey: "adjust:x:1",
    });

    expect(await validate(dto)).toEqual([]);
  });

  it("answers a take-off below zero with a 400 in plain words", async () => {
    const ledger = {
      createTransaction: jest.fn().mockRejectedValue({
        message: "stock would go negative: 2 + -5",
      }),
    };
    const controller = new InventoryLedgerController(ledger as any);

    const err = await controller
      .createTransaction({} as any, { userId: "u", restaurantId: HOUSE })
      .catch((e) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(400);
    expect((err as HttpException).message).toMatch(/more bottles than the books hold|The books show 2 bottles, so 5 can't come off/);
    expect((err as HttpException).message).not.toMatch(/stock would go negative/);
  });
});
