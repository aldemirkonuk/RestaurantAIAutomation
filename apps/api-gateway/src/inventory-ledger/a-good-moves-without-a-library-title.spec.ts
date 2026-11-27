/**
 * A food or a supply is written off through the same ledger door as a wine.
 *
 * POST /inventory-ledger/transactions required a `wineId`, although the
 * movement is keyed on the house item (`apply_stock_movement` reads the wine
 * from the item itself) and the id was only copied into the change event. A
 * house item with no library title (ADR 0115: flour, napkins) could therefore
 * never be written off, so its Waste card could never read anything but 0.
 *
 * Real: the DTO's validation rules and `InventoryLedgerService`. Doubles:
 * `EventsService` (records what it is handed), `FakeDb` for Supabase.
 */
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { InventoryLedgerService } from "./inventory-ledger.service";
import { FakeDb } from "../notifications/producers/testing/fake-db";
import {
  CreateInventoryTransactionDto,
  StockType,
  TransactionSource,
  TransactionType,
} from "./dto/inventory-ledger.dto";

const HOUSE = "house-1";
const ITEM = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function build() {
  const db = new FakeDb();
  db.tables.restaurant_inventory = [
    { id: ITEM, restaurant_id: HOUSE, master_wine_id: null, kind: "food", uom: "g", display_name: "Un" },
  ];
  db.tables.inventory_transactions = [];
  db.tables.house_item_research = [];
  const calls: Array<Record<string, any>> = [];
  db.rpcHandlers.apply_stock_movement = (args) => {
    calls.push(args);
    const id = db.id("txn");
    db.tables.inventory_transactions.push({
      id,
      restaurant_id: args.p_restaurant_id,
      inventory_id: args.p_inventory_id,
      wine_id: null,
      stock_type: args.p_stock_state,
      quantity_change: args.p_delta,
      transaction_type: args.p_transaction_type,
      idempotency_key: args.p_idempotency_key,
    });
    return { data: id, error: null };
  };
  const events: Array<Record<string, any>> = [];
  const eventsService = {
    createEvent: async (_r: string, _u: string, e: Record<string, any>) => {
      events.push(e);
    },
  } as any;
  const service = new InventoryLedgerService({ supabase: db, getClient: () => db } as any, eventsService);
  (service as any).logger.error = jest.fn();
  (service as any).logger.warn = jest.fn();
  (service as any).logger.log = jest.fn();
  return { db, service, calls, events };
}

const writeOff = {
  inventoryId: ITEM,
  transactionType: TransactionType.WASTE,
  source: TransactionSource.MANUAL,
  quantityChange: -2250,
  stockType: StockType.LIVE,
  reason: "Breakage",
  idempotencyKey: "writeoff:food:1",
};

describe("a good with no library title moves through the ledger", () => {
  it("the body passes validation with no wineId", async () => {
    const errors = await validate(plainToInstance(CreateInventoryTransactionDto, writeOff));
    expect(errors.map((e) => e.property)).toEqual([]);
  });

  it("a wineId that is sent must still be a uuid", async () => {
    const errors = await validate(plainToInstance(CreateInventoryTransactionDto, { ...writeOff, wineId: "not-a-uuid" }));
    expect(errors.map((e) => e.property)).toEqual(["wineId"]);
  });

  it("a write-off of 2,250 g of flour reaches apply_stock_movement for that item and house", async () => {
    const t = build();
    const out = await t.service.createTransaction(HOUSE, USER, writeOff as CreateInventoryTransactionDto);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]).toEqual(
      expect.objectContaining({
        p_inventory_id: ITEM,
        p_restaurant_id: HOUSE,
        p_delta: -2250,
        p_transaction_type: TransactionType.WASTE,
      }),
    );
    expect(out.wineId).toBeNull();
    expect(out.inventoryId).toBe(ITEM);
  });

  it("the change event names the item, and says no library title rather than leaving it undefined", async () => {
    const t = build();
    await t.service.createTransaction(HOUSE, USER, writeOff as CreateInventoryTransactionDto);
    expect(t.events).toHaveLength(1);
    expect(t.events[0].payload).toEqual(expect.objectContaining({ wineId: null, inventoryId: ITEM, quantity: -2250 }));
  });
});

describe("a good with no library title is counted (and so zeroed before removal)", () => {
  it("reconcile with no wineId reaches record_stock_count for the item, and returns the count", async () => {
    const t = build();
    const counts: Array<Record<string, any>> = [];
    t.db.rpcHandlers.record_stock_count = (args) => {
      counts.push(args);
      return {
        data: { count_id: "count-1", expected_qty: 2250, counted_qty: args.p_counted_qty, variance_qty: -2250, transaction_id: null },
        error: null,
      };
    };
    const out = await t.service.reconcileInventory(HOUSE, USER, ITEM, undefined, 0, "Removed from inventory — Discontinued");
    expect(counts).toHaveLength(1);
    expect(counts[0]).toEqual(expect.objectContaining({ p_inventory_id: ITEM, p_counted_qty: 0 }));
    expect(out.count).toEqual(expect.objectContaining({ countedQty: 0, expectedQty: 2250 }));
    expect(out.transaction).toBeNull();
  });
});
