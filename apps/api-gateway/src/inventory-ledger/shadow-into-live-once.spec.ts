/**
 * F-143 orphan shadow (after F-1166 and F-1695) — shadow no order holds is a
 * count to confirm, never booked onto the shelf on its own say-so.
 *
 * F-1166: "Reconcile N into live" sent a count of live + shadow, so on hand
 * grew by N per press. F-1695: it booked bottles an open order still held, and
 * any role could press it. What was left: it still booked the shadow no order
 * holds (an orphan, with no delivery or order behind it) straight into live.
 * Coordinator's call 2026-10-14 (ADR 0078): that shadow posts only when a
 * person counts the shelf, through record_stock_count; the leftover shadow is
 * then taken off the order book. Nothing is deleted.
 *
 * Real: `InventoryLedgerService`. Double: `FakeDb`, whose apply_stock_movement
 * and record_stock_count handlers keep per-state lots and replay a seen
 * idempotency key, as the primitives do.
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
  db.tables.stock_counts = [];
  // The order that reserved the shadow bottles.
  db.tables.inventory_transactions = [
    {
      id: "txn-0",
      restaurant_id: HOUSE,
      inventory_id: ITEM,
      stock_type: "shadow",
      quantity_change: shadow,
      idempotency_key: "order-placed-shadow:o-1",
      created_at: "2026-10-01T00:00:00Z",
    },
  ];
  const lot = (state: string) =>
    db.tables.inventory_lots.find(
      (l) => l.inventory_id === ITEM && l.stock_state === state,
    )!;
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
    const l = lot(args.p_stock_state);
    if (l.qty + args.p_delta < 0)
      return {
        data: null,
        error: {
          message: `stock would go negative: ${l.qty} + ${args.p_delta}`,
        },
      };
    l.qty += args.p_delta;
    const id = db.id("txn");
    db.tables.inventory_transactions.push({
      id,
      restaurant_id: HOUSE,
      inventory_id: ITEM,
      stock_type: args.p_stock_state,
      quantity_change: args.p_delta,
      idempotency_key: args.p_idempotency_key,
      created_at: "2026-10-10T00:00:00Z",
    });
    return { data: id, error: null };
  };
  // The single count writer (ADR 0078): the count is recorded whatever it
  // finds, and live becomes what was counted.
  db.rpcHandlers.record_stock_count = (args) => {
    const seen = db.tables.stock_counts.find(
      (c) => c.idempotency_key === args.p_idempotency_key,
    );
    if (seen) return { data: { ...seen.result, replayed: true }, error: null };
    const l = lot(args.p_stock_state);
    const expected = l.qty;
    const variance = args.p_counted_qty - expected;
    let transactionId: string | null = null;
    if (variance !== 0) {
      l.qty = args.p_counted_qty;
      transactionId = db.id("txn");
      db.tables.inventory_transactions.push({
        id: transactionId,
        restaurant_id: HOUSE,
        inventory_id: ITEM,
        stock_type: args.p_stock_state,
        transaction_type: args.p_transaction_type,
        quantity_change: variance,
        idempotency_key: args.p_idempotency_key,
        created_at: "2026-10-10T00:00:00Z",
      });
    }
    const result = {
      count_id: db.id("count"),
      expected_qty: expected,
      counted_qty: args.p_counted_qty,
      variance_qty: variance,
      transaction_id: transactionId,
      counted_at: "2026-10-10T00:00:00Z",
      replayed: false,
    };
    db.tables.stock_counts.push({
      idempotency_key: args.p_idempotency_key,
      reason: args.p_reason,
      result,
    });
    return { data: result, error: null };
  };
  const service = new InventoryLedgerService(
    { supabase: db, getClient: () => db } as any,
    { createEvent: async () => undefined } as any,
  );
  for (const l of ["error", "warn", "log"])
    (service as any).logger[l] = jest.fn();
  const stock = (state: string) => lot(state).qty;
  const onHand = () => stock("live") + stock("shadow");
  const confirm = (counted: number, house = HOUSE) =>
    service.confirmShadowByCount(house, USER, ITEM, counted);
  return { db, stock, onHand, confirm, failShadowOut };
}

describe("Shadow no order holds is a count to confirm (F-143 orphan shadow)", () => {
  it("[REVERT-FAILS] posts only what the count finds, through the count writer", async () => {
    // 3 on the shelf, 10 shadow no order holds; the person counts 5.
    const { db, stock, onHand, confirm } = build(3, 10);
    await expect(confirm(5)).resolves.toMatchObject({
      cleared: 10,
      count: { countedQty: 5, varianceQty: 2 },
    });
    expect(stock("live")).toBe(5);
    expect(stock("shadow")).toBe(0);
    expect(onHand()).toBe(5);
    // One count on the record, and no 'adjustment' booked the shadow live.
    expect(db.tables.stock_counts).toHaveLength(1);
    expect(
      db.tables.inventory_transactions.filter(
        (t) =>
          t.stock_type === "live" && t.transaction_type !== "reconciliation",
      ),
    ).toEqual([]);
  });

  it("[REVERT-FAILS] a count that finds none of them leaves the shelf as it was", async () => {
    const { stock, onHand, confirm } = build(3, 10);
    await expect(confirm(3)).resolves.toMatchObject({
      cleared: 10,
      count: { varianceQty: 0, transactionId: null },
    });
    expect(stock("live")).toBe(3);
    expect(stock("shadow")).toBe(0);
    expect(onHand()).toBe(3);
  });

  it("[REVERT-FAILS] refuses without a count, and moves nothing", async () => {
    const { db, stock, confirm } = build(3, 10);
    for (const bad of [NaN, -1, 2.5])
      await expect(confirm(bad)).rejects.toThrow(/how many bottles/);
    expect(stock("live")).toBe(3);
    expect(stock("shadow")).toBe(10);
    expect(db.tables.stock_counts).toEqual([]);
  });

  it("a second press with the same number replays, and settles nothing more", async () => {
    const { db, onHand, confirm } = build(3, 10);
    await confirm(5);
    await expect(confirm(5)).rejects.toThrow(/waiting to be confirmed/);
    expect(onHand()).toBe(5);
    expect(db.tables.stock_counts).toHaveLength(1);
  });

  it("a retry after the shadow half failed finishes it without counting twice", async () => {
    const { db, stock, onHand, confirm, failShadowOut } = build(3, 10);
    failShadowOut.times = 1;
    await expect(confirm(5)).rejects.toThrow(/count is saved/);
    // The shelf is right; the bottles still show as to confirm.
    expect(stock("live")).toBe(5);
    expect(stock("shadow")).toBe(10);
    await expect(confirm(5)).resolves.toMatchObject({ cleared: 10 });
    expect(stock("live")).toBe(5);
    expect(stock("shadow")).toBe(0);
    expect(onHand()).toBe(5);
    expect(db.tables.stock_counts).toHaveLength(1);
  });

  it("refuses another house's item before counting anything", async () => {
    const { db, stock, confirm } = build(3, 10);
    await expect(confirm(5, OTHER)).rejects.toThrow(/does not belong/);
    expect(stock("live")).toBe(3);
    expect(stock("shadow")).toBe(10);
    expect(db.tables.stock_counts).toEqual([]);
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

  it("[REVERT-FAILS] refuses, and counts nothing, when an open order holds every bottle", async () => {
    const { db, stock, confirm } = onOrder(10);
    await expect(confirm(13)).rejects.toThrow(
      /still on an order that has not arrived/,
    );
    expect(stock("live")).toBe(3);
    expect(stock("shadow")).toBe(10);
    expect(db.tables.stock_counts).toEqual([]);
  });

  it("[REVERT-FAILS] settles only the bottles no order holds", async () => {
    const { stock, confirm } = onOrder(6);
    await expect(confirm(7)).resolves.toMatchObject({ cleared: 4 });
    expect(stock("live")).toBe(7);
    expect(stock("shadow")).toBe(6);
  });

  it("a released order (0 held) no longer holds anything", async () => {
    const { confirm } = onOrder(0);
    await expect(confirm(3)).resolves.toMatchObject({ cleared: 10 });
  });

  it("[REVERT-FAILS] a staff press is refused before anything is counted", async () => {
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
      controller.confirmShadowByCount(
        ITEM,
        { counted: 13 },
        { userId: USER, restaurantId: HOUSE },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(organizations.assertCanManageRestaurant).toHaveBeenCalledWith(
      USER,
      HOUSE,
      expect.any(String),
    );
    expect(stock("live")).toBe(3);
    expect(stock("shadow")).toBe(10);
    expect(db.tables.stock_counts).toEqual([]);
  });
});
