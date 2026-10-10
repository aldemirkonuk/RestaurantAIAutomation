/**
 * F-646 (sim wave 21, 2026-10-09) — POST /inventory-ledger/transactions.
 *
 *  (a) apply_stock_movement refuses a take-off larger than the books with
 *      'stock would go negative: <on hand> + <change>'. The controller mapped
 *      only "Insufficient stock" to 400, so this reached the client as a 500,
 *      which a queue reads as "try again".
 *  (b) a write-off's place was sent as `toLocationId || fromLocationId`, so a
 *      breakage FROM the bar was sent as the bar only when no `to` was given.
 *  (c) a unit cost was sent without a provenance, and the primitive refuses a
 *      price that does not say what kind it is (ADR 0078) — every priced
 *      purchase was a 500.
 *
 * Real: controller + `InventoryLedgerService`. Double: `FakeDb`, whose
 * apply_stock_movement handler copies the primitive's two refusals.
 */
import { HttpException, HttpStatus } from "@nestjs/common";
import { InventoryLedgerController } from "./inventory-ledger.controller";
import { InventoryLedgerService } from "./inventory-ledger.service";
import { FakeDb } from "../notifications/producers/testing/fake-db";
import {
  TransactionSource,
  TransactionType,
  StockType,
} from "./dto/inventory-ledger.dto";

const HOUSE = "house-1";
const ITEM = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const BAR = "33333333-3333-4333-8333-333333333333";
const CELLAR = "44444444-4444-4444-8444-444444444444";

function build(onHand: number) {
  const db = new FakeDb();
  db.tables.restaurant_inventory = [
    {
      id: ITEM,
      restaurant_id: HOUSE,
      master_wine_id: "55555555-5555-4555-8555-555555555555",
      wine_name: "Yakut",
    },
  ];
  db.tables.inventory_transactions = [];
  // Both places are this house's (F-435 checks a zone id before the move).
  db.tables.storage_locations = [
    { id: BAR, restaurant_id: HOUSE },
    { id: CELLAR, restaurant_id: HOUSE },
  ];
  const calls: Record<string, any>[] = [];
  db.rpcHandlers.apply_stock_movement = (args) => {
    calls.push(args);
    if (
      args.p_delta > 0 &&
      args.p_unit_cost != null &&
      args.p_cost_provenance == null
    )
      return {
        data: null,
        error: {
          message:
            "apply_stock_movement: p_unit_cost was given without p_cost_provenance.",
        },
      };
    if (onHand + args.p_delta < 0)
      return {
        data: null,
        error: {
          message: `stock would go negative: ${onHand} + ${args.p_delta}`,
        },
      };
    const id = db.id("txn");
    db.tables.inventory_transactions.push({
      id,
      restaurant_id: args.p_restaurant_id,
      inventory_id: args.p_inventory_id,
      quantity_change: args.p_delta,
    });
    return { data: id, error: null };
  };
  const service = new InventoryLedgerService(
    { supabase: db, getClient: () => db } as any,
    { createEvent: async () => undefined } as any,
  );
  for (const l of ["error", "warn", "log"])
    (service as any).logger[l] = jest.fn();
  const controller = new InventoryLedgerController(service);
  (controller as any).logger.error = jest.fn();
  const post = (over: Record<string, unknown>) =>
    controller.createTransaction(
      {
        inventoryId: ITEM,
        wineId: "w-1",
        transactionType: TransactionType.WASTE,
        source: TransactionSource.MANUAL,
        quantityChange: -1,
        stockType: StockType.LIVE,
        ...over,
      } as any,
      { userId: USER, restaurantId: HOUSE },
    );
  return { calls, post };
}

describe("POST /inventory-ledger/transactions — F-646", () => {
  it("(a) a take-off larger than the books is a 400 in plain words, not a 500", async () => {
    const t = build(2);
    const err = await t.post({ quantityChange: -5 }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(err.message).toBe(
      "The books show 2 bottles, so 5 can't come off. Count the shelf first, then try again.",
    );
  });

  it("(a) a refusal the service already worded keeps its 400", async () => {
    const t = build(2);
    const err = await t.post({ quantityChange: 0 }).catch((e) => e);
    expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
  });

  it("(b) a write-off names the place it came FROM", async () => {
    const t = build(5);
    await t.post({
      quantityChange: -1,
      fromLocationId: BAR,
      toLocationId: CELLAR,
    });
    expect(t.calls[0].p_location_id).toBe(BAR);
  });

  it("(b) bottles coming in go TO their place", async () => {
    const t = build(5);
    await t.post({
      transactionType: TransactionType.PURCHASE,
      quantityChange: 2,
      fromLocationId: BAR,
      toLocationId: CELLAR,
    });
    expect(t.calls[0].p_location_id).toBe(CELLAR);
  });

  it("(c) a unit cost is accepted, labelled as a person's entry", async () => {
    const t = build(0);
    await expect(
      t.post({
        transactionType: TransactionType.PURCHASE,
        quantityChange: 6,
        unitCost: 18.5,
      }),
    ).resolves.toBeDefined();
    expect(t.calls[0]).toMatchObject({
      p_unit_cost: 18.5,
      p_cost_provenance: "manual",
    });
  });

  it("(c) no unit cost sends no provenance", async () => {
    const t = build(0);
    await t.post({
      transactionType: TransactionType.PURCHASE,
      quantityChange: 6,
    });
    expect(t.calls[0]).toMatchObject({
      p_unit_cost: null,
      p_cost_provenance: null,
    });
  });
});
