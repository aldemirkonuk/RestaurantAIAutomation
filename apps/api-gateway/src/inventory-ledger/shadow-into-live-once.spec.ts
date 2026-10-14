/**
 * F-1166 (re-hit of F-143) — "Reconcile N into live" added N bottles per press.
 *
 * The row sent `reconcileInventory` a count of live + shadow, which set live to
 * that number and left shadow alone, so on hand (live + shadow) grew by N each
 * time. `reconcileShadowIntoLive` moves the shadow it reads itself: live +N,
 * shadow -N, and a second press, a retry or a second tab moves nothing more.
 *
 * Real: `InventoryLedgerService`. Double: `FakeDb`, whose apply_stock_movement
 * handler keeps per-state lots and replays a seen idempotency key, as the
 * primitive does.
 */
import { ForbiddenException } from "@nestjs/common";
import { InventoryLedgerService } from "./inventory-ledger.service";
import { InventoryLedgerController } from "./inventory-ledger.controller";
import { FakeDb } from "../notifications/producers/testing/fake-db";

const HOUSE = "house-1";
const OTHER = "house-2";
const ITEM = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function build(live: number, shadow: number) {
  const db = new FakeDb();
  db.tables.restaurant_inventory = [{ id: ITEM, restaurant_id: HOUSE }];
  db.tables.inventory_lots = [
    { id: "lot-live", inventory_id: ITEM, stock_state: "live", qty: live },
    {
      id: "lot-shadow",
      inventory_id: ITEM,
      stock_state: "shadow",
      qty: shadow,
    },
  ];
  // The order that reserved the shadow bottles.
  db.tables.inventory_transactions = [
    {
      id: "txn-0",
      inventory_id: ITEM,
      stock_type: "shadow",
      quantity_change: shadow,
      idempotency_key: "order-placed-shadow:o-1",
      created_at: "2026-10-01T00:00:00Z",
    },
  ];
  const failShadowOut = { times: 0 };
  db.rpcHandlers.apply_stock_movement = (args) => {
    const seen = db.tables.inventory_transactions.find(
      (t) => t.idempotency_key === args.p_idempotency_key,
    );
    if (seen) return { data: seen.id, error: null };
    if (args.p_stock_state === "shadow" && failShadowOut.times > 0) {
      failShadowOut.times -= 1;
      return { data: null, error: { message: "connection reset" } };
    }
    const lot = db.tables.inventory_lots.find(
      (l) => l.inventory_id === ITEM && l.stock_state === args.p_stock_state,
    )!;
    if (lot.qty + args.p_delta < 0)
      return {
        data: null,
        error: {
          message: `stock would go negative: ${lot.qty} + ${args.p_delta}`,
        },
      };
    lot.qty += args.p_delta;
    const id = db.id("txn");
    db.tables.inventory_transactions.push({
      id,
      inventory_id: ITEM,
      stock_type: args.p_stock_state,
      quantity_change: args.p_delta,
      idempotency_key: args.p_idempotency_key,
      created_at: "2026-10-10T00:00:00Z",
    });
    return { data: id, error: null };
  };
  const service = new InventoryLedgerService(
    { supabase: db, getClient: () => db } as any,
    { createEvent: async () => undefined } as any,
  );
  for (const l of ["error", "warn", "log"])
    (service as any).logger[l] = jest.fn();
  const stock = (state: string) =>
    db.tables.inventory_lots.find((l) => l.stock_state === state)!.qty;
  const onHand = () => stock("live") + stock("shadow");
  const press = (house = HOUSE) =>
    service.reconcileShadowIntoLive(house, USER, ITEM);
  return { db, stock, onHand, press, failShadowOut };
}

describe("Reconcile N into live moves the shadow once (F-1166)", () => {
  it("moves the shadow onto the shelf and keeps on hand the same", async () => {
    const { stock, onHand, press } = build(3, 10);
    await expect(press()).resolves.toEqual({ moved: 10 });
    expect(stock("live")).toBe(13);
    expect(stock("shadow")).toBe(0);
    expect(onHand()).toBe(13);
  });

  it("a second press moves nothing", async () => {
    const { onHand, press } = build(3, 10);
    await press();
    await expect(press()).resolves.toEqual({ moved: 0 });
    expect(onHand()).toBe(13);
  });

  it("a retry after the shadow half failed finishes it without adding again", async () => {
    const { stock, onHand, press, failShadowOut } = build(3, 10);
    failShadowOut.times = 1;
    await expect(press()).rejects.toThrow(/Press it again/);
    // Over-stated, never lost, and the act is still offered.
    expect(stock("live")).toBe(13);
    expect(stock("shadow")).toBe(10);
    await expect(press()).resolves.toEqual({ moved: 10 });
    expect(stock("live")).toBe(13);
    expect(stock("shadow")).toBe(0);
    expect(onHand()).toBe(13);
  });

  it("refuses another house's item before moving anything", async () => {
    const { stock, press } = build(3, 10);
    await expect(press(OTHER)).rejects.toThrow(/does not belong/);
    expect(stock("live")).toBe(3);
    expect(stock("shadow")).toBe(10);
  });
});

/**
 * F-1695 (re-hit of F-143): the bottles an open order still holds had not
 * arrived, and "Reconcile" booked them onto the shelf anyway; the delivery then
 * booked them again and released nothing. And any role could press it.
 */
describe("Bottles still on an open order stay on order (F-1695)", () => {
  function onOrder(held: number) {
    const b = build(3, 10);
    b.db.tables.procurement_orders = [
      {
        id: "o-1",
        restaurant_id: HOUSE,
        inventory_id: ITEM,
        reserved_bottles: held,
      },
      // Another house's order for the same id never counts.
      {
        id: "o-2",
        restaurant_id: OTHER,
        inventory_id: ITEM,
        reserved_bottles: 10,
      },
    ];
    return b;
  }

  it("[REVERT-FAILS] refuses, and moves nothing, when an open order holds every bottle", async () => {
    const { stock, press } = onOrder(10);
    await expect(press()).rejects.toThrow(
      /still on an order that has not arrived/,
    );
    expect(stock("live")).toBe(3);
    expect(stock("shadow")).toBe(10);
  });

  it("[REVERT-FAILS] moves only the bottles no order holds", async () => {
    const { stock, press } = onOrder(6);
    await expect(press()).resolves.toEqual({ moved: 4 });
    expect(stock("live")).toBe(7);
    expect(stock("shadow")).toBe(6);
  });

  it("a released order (0 held) no longer holds anything", async () => {
    const { press } = onOrder(0);
    await expect(press()).resolves.toEqual({ moved: 10 });
  });

  it("[REVERT-FAILS] a staff press is refused before anything moves", async () => {
    const { stock, db } = build(3, 10);
    const service = new InventoryLedgerService(
      { supabase: db, getClient: () => db } as any,
      { createEvent: async () => undefined } as any,
    );
    const organizations = {
      assertCanManageRestaurant: jest.fn(async () => {
        throw new ForbiddenException("owner or manager only");
      }),
    };
    const controller = new InventoryLedgerController(
      service,
      organizations as any,
    );
    await expect(
      controller.reconcileShadowIntoLive(ITEM, {
        userId: USER,
        restaurantId: HOUSE,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(organizations.assertCanManageRestaurant).toHaveBeenCalledWith(
      USER,
      HOUSE,
      expect.any(String),
    );
    expect(stock("live")).toBe(3);
    expect(stock("shadow")).toBe(10);
  });
});
