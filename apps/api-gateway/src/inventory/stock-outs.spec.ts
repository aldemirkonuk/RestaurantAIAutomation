import { ForbiddenException, HttpException } from "@nestjs/common";
import { InventoryService } from "./inventory.service";
import { FakeDb } from "../notifications/producers/testing/fake-db";
import { DeliveryStockService } from "../procurement/canonical/delivery-stock.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";

/**
 * F-145: a drink can be 86'd, and the stock-out is kept.
 *
 * A stock_outs row (20261231900000) is open while ended_at is null; the item
 * is sold out exactly then. These tests drive InventoryService against a fake
 * table that behaves like the partial unique index (one open row per item).
 * Built without the constructor, as stock-wrappers-refuse-foreign-items does.
 */

const HOUSE = "house-1";
const ITEM = "inv-moscofilero";

function serviceOver(opts: { owned?: boolean } = {}) {
  const owned = opts.owned ?? true;
  const rows: any[] = [];
  const writes: { op: string; row?: any; patch?: any }[] = [];
  const audits: any[] = [];
  let seq = 0;

  const client = {
    from(table: string) {
      const filters: Array<(r: any) => boolean> = [];
      let op: "select" | "insert" | "update" = "select";
      let payload: any = null;
      const c: any = {
        select: () => c,
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return c;
        },
        is: (col: string, val: unknown) => {
          filters.push((r) => (r[col] ?? null) === val);
          return c;
        },
        order: () => c,
        limit: () => c,
        insert: (row: any) => {
          op = "insert";
          payload = row;
          return c;
        },
        update: (patch: any) => {
          op = "update";
          payload = patch;
          return c;
        },
        maybeSingle: async () => ({
          data: table === "restaurant_inventory" && owned ? { id: ITEM } : null,
          error: null,
        }),
        then: (res: any, rej: any) => {
          let result: any = { data: null, error: null };
          if (table === "stock_outs" && op === "insert") {
            writes.push({ op, row: payload });
            const open = rows.some(
              (r) =>
                r.inventory_id === payload.inventory_id && r.ended_at == null,
            );
            if (open) {
              result = {
                data: null,
                error: {
                  code: "23505",
                  message: "stock_outs_one_open_per_item",
                },
              };
            } else {
              seq += 1;
              rows.push({
                id: `so-${seq}`,
                started_at: `2026-09-0${seq}T17:30:00Z`,
                ended_at: null,
                ended_by: null,
                ...payload,
              });
            }
          } else if (table === "stock_outs" && op === "update") {
            writes.push({ op, patch: payload });
            const hit = rows.filter((x) => filters.every((f) => f(x)));
            for (const r of hit) Object.assign(r, payload);
            result = { data: hit.map((r) => ({ ...r })), error: null };
          } else if (table === "system_audit_log" && op === "insert") {
            audits.push(payload);
          } else if (table === "stock_outs") {
            result = {
              data: rows
                .filter((x) => filters.every((f) => f(x)))
                .sort((a, b) => (a.started_at < b.started_at ? 1 : -1)),
              error: null,
            };
          }
          return Promise.resolve(result).then(res, rej);
        },
      };
      return c;
    },
  };

  const svc = Object.create(InventoryService.prototype) as any;
  svc.dbService = { getClient: () => client };
  svc.logger = { error: () => {}, warn: () => {}, log: () => {} };
  return { svc: svc as InventoryService, rows, writes, audits };
}

describe("a drink can be 86'd and the stock-out is kept (F-145)", () => {
  it("marks it sold out with why and who, and reads it back as open", async () => {
    const { svc, writes } = serviceOver();

    const state = await svc.startStockOut(
      HOUSE,
      ITEM,
      { cause: "ran_out", note: " glass list " },
      "user-kerem",
    );

    expect(writes).toEqual([
      {
        op: "insert",
        row: {
          restaurant_id: HOUSE,
          inventory_id: ITEM,
          cause: "ran_out",
          note: "glass list",
          started_by: "user-kerem",
        },
      },
    ]);
    expect(state.open).toMatchObject({
      cause: "ran_out",
      startedBy: "user-kerem",
      endedAt: null,
    });
  });

  it("answers a second tap with the stock-out already open, not a second one", async () => {
    const { svc, rows } = serviceOver();
    await svc.startStockOut(HOUSE, ITEM, { cause: "ran_out" }, "user-a");

    const state = await svc.startStockOut(
      HOUSE,
      ITEM,
      { cause: "broken" },
      "user-b",
    );

    expect(rows).toHaveLength(1);
    expect(state.open).toMatchObject({ cause: "ran_out", startedBy: "user-a" });
  });

  it("brings it back, keeping the stock-out in the record", async () => {
    const { svc } = serviceOver();
    await svc.startStockOut(HOUSE, ITEM, { cause: "broken" }, "user-a");

    const state = await svc.endStockOut(HOUSE, ITEM, "user-b");

    expect(state.open).toBeNull();
    expect(state.recent).toHaveLength(1);
    expect(state.recent[0]).toMatchObject({
      cause: "broken",
      endedBy: "user-b",
    });
    expect(state.recent[0].endedAt).not.toBeNull();
  });

  it("files who 86'd it and who brought it back on the record, once each (S195)", async () => {
    const { svc, audits } = serviceOver();
    await svc.startStockOut(HOUSE, ITEM, { cause: "broken" }, "user-a");
    // A second tap marks nothing, so it files nothing.
    await svc.startStockOut(HOUSE, ITEM, { cause: "ran_out" }, "user-b");
    await svc.endStockOut(HOUSE, ITEM, "user-c");
    // Nothing was open any more, so nothing more is filed.
    await svc.endStockOut(HOUSE, ITEM, "user-c");

    expect(audits).toEqual([
      expect.objectContaining({
        actor_type: "user",
        actor_id: "user-a",
        action: "drink_sold_out",
        entity_type: "inventory_item",
        entity_id: ITEM,
        restaurant_id: HOUSE,
        changes: expect.objectContaining({
          cause: "broken",
          fields: { sold_out: { from: false, to: true } },
        }),
      }),
      expect.objectContaining({
        actor_id: "user-c",
        action: "drink_back_on",
        entity_id: ITEM,
        changes: expect.objectContaining({
          cause: "broken",
          fields: { sold_out: { from: true, to: false } },
        }),
      }),
    ]);
  });

  it("refuses a stock-out with no reason, and writes nothing", async () => {
    const { svc, writes } = serviceOver();
    await expect(
      svc.startStockOut(HOUSE, ITEM, { cause: "" }, "user-a"),
    ).rejects.toThrow(HttpException);
    await expect(
      svc.startStockOut(HOUSE, ITEM, { cause: "sold_well" }, "user-a"),
    ).rejects.toThrow(HttpException);
    expect(writes).toEqual([]);
  });

  it("refuses another house's item before it writes, and the control passes", async () => {
    const foreign = serviceOver({ owned: false });
    await expect(
      foreign.svc.startStockOut(HOUSE, ITEM, { cause: "ran_out" }, "user-a"),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      foreign.svc.endStockOut(HOUSE, ITEM, "user-a"),
    ).rejects.toThrow(ForbiddenException);
    expect(foreign.writes).toEqual([]);

    const own = serviceOver();
    await own.svc.startStockOut(HOUSE, ITEM, { cause: "ran_out" }, "user-a");
    expect(own.writes).toHaveLength(1);
  });
});

/**
 * The 86's lifecycle against a Postgres-shaped store (FakeDb): which 86 a
 * person ends, and what a turned-away delivery or shelved on-order bottles
 * do to one. F-1520, F-1521, F-1523.
 */
function house() {
  const db = new FakeDb();
  db.tables.restaurant_inventory = [
    { id: ITEM, restaurant_id: HOUSE, wine_name: "Tito's" },
  ];
  db.tables.users = [
    { user_id: "user-owner", name: "Deniz", restaurant_id: HOUSE },
  ];
  db.tables.stock_outs = [];
  db.tables.system_audit_log = [];
  db.tables.inventory_transactions = [];
  const quiet = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
  const inventory = Object.create(InventoryService.prototype) as any;
  inventory.dbService = { getClient: () => db };
  inventory.logger = quiet;
  return { db, inventory: inventory as InventoryService, quiet };
}

describe("'Back on' ends only the 86 the person saw (F-1521)", () => {
  it("refuses with who and why when a newer 86 is open, and leaves it open", async () => {
    const { db, inventory } = house();
    db.tables.stock_outs.push(
      {
        id: "so-old",
        restaurant_id: HOUSE,
        inventory_id: ITEM,
        cause: "ran_out",
        started_at: "2026-10-10T18:00:00Z",
        ended_at: "2026-10-10T19:00:00Z",
        ended_by: "user-a",
      },
      {
        id: "so-pull",
        restaurant_id: HOUSE,
        inventory_id: ITEM,
        cause: "pulled",
        note: "corked lot",
        started_by: "user-owner",
        started_at: "2026-10-10T20:00:00Z",
        ended_at: null,
      },
    );

    const tap = inventory.endStockOut(HOUSE, ITEM, "user-waiter", "so-old");

    await expect(tap).rejects.toMatchObject({ status: 409 });
    await expect(
      inventory.endStockOut(HOUSE, ITEM, "user-waiter", "so-old"),
    ).rejects.toThrow(
      /Deniz marked it sold out again because they pulled it \(corked lot\)/,
    );
    expect(db.tables.stock_outs[1].ended_at).toBeNull();
    expect(db.tables.system_audit_log).toEqual([]);
  });

  it("ends the one it names", async () => {
    const { db, inventory } = house();
    db.tables.stock_outs.push({
      id: "so-1",
      restaurant_id: HOUSE,
      inventory_id: ITEM,
      cause: "ran_out",
      started_at: "2026-10-10T18:00:00Z",
      ended_at: null,
    });
    const state = await inventory.endStockOut(HOUSE, ITEM, "user-b", "so-1");
    expect(state.open).toBeNull();
    expect(db.tables.stock_outs[0].ended_by).toBe("user-b");
  });
});

describe("a delivery turned away opens the 86 it ended again (F-1520)", () => {
  function delivered(extra: (db: FakeDb) => void = () => {}) {
    const h = house();
    const { db } = h;
    db.tables.deliveries = [
      { id: "del-1", restaurant_id: HOUSE, state: "REJECTED", order_id: null },
    ];
    // The door booked six; the receipt trigger ended the ran-out 86.
    db.tables.inventory_transactions.push({
      id: "txn-in",
      inventory_id: ITEM,
      delivery_id: "del-1",
      transaction_type: "purchase",
      stock_type: "live",
      quantity_change: 6,
      created_at: "2026-10-11T09:00:00Z",
    });
    db.tables.stock_outs.push({
      id: "so-1",
      restaurant_id: HOUSE,
      inventory_id: ITEM,
      cause: "ran_out",
      started_at: "2026-10-10T18:00:00Z",
      ended_at: "2026-10-11T09:00:00Z",
      ended_by: null,
      ended_by_receipt: "txn-in",
    });
    // The six are on the shelf; stock_live is the ledger's projection.
    db.tables.restaurant_inventory[0].stock_live = 6;
    db.rpcHandlers.apply_stock_movement = (args) => {
      const id = db.id("txn");
      const row = db.tables.restaurant_inventory.find(
        (r) => r.id === args.p_inventory_id,
      );
      if (row) row.stock_live = Number(row.stock_live ?? 0) + args.p_delta;
      db.tables.inventory_transactions.push({
        id,
        inventory_id: args.p_inventory_id,
        delivery_id: args.p_reference_id,
        transaction_type: args.p_transaction_type,
        stock_type: args.p_stock_state,
        quantity_change: args.p_delta,
        created_at: "2026-10-11T10:00:00Z",
      });
      return { data: id, error: null };
    };
    extra(db);
    const stock = new DeliveryStockService({ getClient: () => db } as any);
    (stock as any).logger = h.quiet;
    return { ...h, stock };
  }

  it("puts the drink back to sold out and files it naming the delivery", async () => {
    const { db, stock } = delivered();
    const res = await stock.reverse(
      HOUSE,
      "del-1",
      "user-ayse",
      "rejected: WRONG_VENUE",
    );
    expect(res.ok).toBe(true);
    expect(db.tables.stock_outs[0]).toMatchObject({
      ended_at: null,
      ended_by_receipt: null,
    });
    expect(db.tables.system_audit_log).toEqual([
      expect.objectContaining({
        action: "drink_sold_out",
        actor_id: "user-ayse",
        entity_id: ITEM,
        reason: "delivery turned away",
        changes: expect.objectContaining({
          subject: "Tito's",
          stock_out_id: "so-1",
          delivery_id: "del-1",
          reopened_after_receipt: "txn-in",
        }),
      }),
    ]);
  });

  it("leaves it on when a person has 86'd it since, or another delivery came", async () => {
    const newer = delivered((db) =>
      db.tables.stock_outs.push({
        id: "so-2",
        restaurant_id: HOUSE,
        inventory_id: ITEM,
        cause: "other",
        started_at: "2026-10-11T09:30:00Z",
        ended_at: "2026-10-11T09:40:00Z",
      }),
    );
    await newer.stock.reverse(HOUSE, "del-1", "user-ayse", "rejected");
    expect(newer.db.tables.stock_outs[0].ended_at).not.toBeNull();

    const another = delivered((db) =>
      db.tables.inventory_transactions.push({
        id: "txn-other",
        inventory_id: ITEM,
        delivery_id: "del-2",
        transaction_type: "purchase",
        stock_type: "live",
        quantity_change: 12,
        created_at: "2026-10-11T09:30:00Z",
      }),
    );
    await another.stock.reverse(HOUSE, "del-1", "user-ayse", "rejected");
    expect(another.db.tables.stock_outs[0].ended_at).not.toBeNull();
    expect(another.db.tables.system_audit_log).toEqual([]);
  });

  it("leaves it on when a count since the receipt put bottles on the shelf (F-1525)", async () => {
    const counted = delivered((db) => {
      // A count after the receipt found four more than the ledger held.
      db.tables.inventory_transactions.push({
        id: "txn-count",
        inventory_id: ITEM,
        delivery_id: null,
        transaction_type: "adjustment",
        stock_type: "live",
        quantity_change: 4,
        created_at: "2026-10-11T09:30:00Z",
      });
      db.tables.restaurant_inventory[0].stock_live = 10;
    });
    await counted.stock.reverse(HOUSE, "del-1", "user-ayse", "rejected");
    expect(counted.db.tables.restaurant_inventory[0].stock_live).toBe(4);
    expect(counted.db.tables.stock_outs[0].ended_at).not.toBeNull();
    expect(counted.db.tables.system_audit_log).toEqual([]);
  });
});

describe("bottles a count finds on the shelf bring a ran-out drink back (F-1523)", () => {
  function shelved(cause: string) {
    const { db, quiet } = house();
    db.tables.inventory_lots = [
      { id: "lot-s", inventory_id: ITEM, stock_state: "shadow", qty: 6 },
    ];
    db.tables.stock_outs.push({
      id: "so-1",
      restaurant_id: HOUSE,
      inventory_id: ITEM,
      cause,
      started_at: "2026-10-10T18:00:00Z",
      ended_at: null,
    });
    db.rpcHandlers.apply_stock_movement = () => ({
      data: db.id("txn"),
      error: null,
    });
    // F-143 orphan shadow: the bottles post only through a count (ADR 0078).
    db.rpcHandlers.record_stock_count = (args) => ({
      data: {
        count_id: db.id("count"),
        expected_qty: 0,
        counted_qty: args.p_counted_qty,
        variance_qty: args.p_counted_qty,
        transaction_id: null,
        replayed: false,
      },
      error: null,
    });
    const ledger = new InventoryLedgerService(
      { supabase: db, getClient: () => db } as any,
      { createEvent: async () => undefined } as any,
    );
    (ledger as any).logger = quiet;
    return { db, ledger };
  }

  it("ends a ran-out 86, as the person who shelved them", async () => {
    const { db, ledger } = shelved("ran_out");
    await ledger.confirmShadowByCount(HOUSE, "user-ayse", ITEM, 6);
    expect(db.tables.stock_outs[0].ended_at).not.toBeNull();
    expect(db.tables.stock_outs[0].ended_by).toBe("user-ayse");
    expect(db.tables.system_audit_log).toEqual([
      expect.objectContaining({
        action: "drink_back_on",
        actor_id: "user-ayse",
        reason: "bottles found by a count of the shelf",
      }),
    ]);
  });

  it("[REVERT-FAILS] a count that finds no bottle leaves a ran-out 86 on", async () => {
    const { db, ledger } = shelved("ran_out");
    await ledger.confirmShadowByCount(HOUSE, "user-ayse", ITEM, 0);
    expect(db.tables.stock_outs[0].ended_at).toBeNull();
  });

  it("leaves a pulled 86 alone", async () => {
    const { db, ledger } = shelved("pulled");
    await ledger.confirmShadowByCount(HOUSE, "user-ayse", ITEM, 6);
    expect(db.tables.stock_outs[0].ended_at).toBeNull();
    expect(db.tables.system_audit_log).toEqual([]);
  });
});
