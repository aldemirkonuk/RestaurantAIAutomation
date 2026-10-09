/**
 * A retry must not confirm an amount the ledger does not hold (ADR 0315,
 * mount-line fix b). `apply_stock_movement` looks an idempotency key up alone
 * and returns the movement it FIRST recorded. A write-off of 3 that landed
 * behind a 5xx and was retried as 1 under the same key used to answer
 * "recorded: 1" over a ledger holding 3. Now a replay whose body differs is a
 * 409; a replay that matches still answers with the first movement.
 *
 * Real: `InventoryLedgerService`. Double: `FakeDb`, whose
 * `apply_stock_movement` keeps the primitive's key-only lookup.
 */
import { ConflictException } from "@nestjs/common";
import { InventoryLedgerService } from "./inventory-ledger.service";
import { FakeDb } from "../notifications/producers/testing/fake-db";
import {
  TransactionSource,
  TransactionType,
  StockType,
} from "./dto/inventory-ledger.dto";

const HOUSE = "house-1";
const ITEM = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const USER = "22222222-2222-4222-8222-222222222222";

function build() {
  const db = new FakeDb();
  db.tables.restaurant_inventory = [
    { id: ITEM, restaurant_id: HOUSE, master_wine_id: "mw-1", wine_name: "A" },
    { id: OTHER, restaurant_id: HOUSE, master_wine_id: "mw-2", wine_name: "B" },
  ];
  db.tables.inventory_transactions = [];
  db.tables.house_item_research = [];
  db.rpcHandlers.apply_stock_movement = (args) => {
    const seen = db.tables.inventory_transactions.find(
      (r: any) => r.idempotency_key === args.p_idempotency_key,
    );
    if (seen) return { data: seen.id, error: null };
    const id = db.id("txn");
    db.tables.inventory_transactions.push({
      id,
      restaurant_id: args.p_restaurant_id,
      inventory_id: args.p_inventory_id,
      stock_type: args.p_stock_state,
      quantity_change: args.p_delta,
      transaction_type: args.p_transaction_type,
      idempotency_key: args.p_idempotency_key,
    });
    return { data: id, error: null };
  };
  const database = { supabase: db, getClient: () => db } as any;
  const events = { createEvent: async () => undefined } as any;
  const service = new InventoryLedgerService(database, events);
  (service as any).logger.error = jest.fn();
  (service as any).logger.warn = jest.fn();
  (service as any).logger.log = jest.fn();
  return { db, service };
}

const writeOff = (
  t: ReturnType<typeof build>,
  over: Partial<{
    inventoryId: string;
    quantityChange: number;
    transactionType: TransactionType;
    stockType: StockType;
  }> = {},
) =>
  t.service.createTransaction(HOUSE, USER, {
    inventoryId: ITEM,
    wineId: "w-1",
    transactionType: TransactionType.WASTE,
    source: TransactionSource.MANUAL,
    quantityChange: -3,
    stockType: StockType.LIVE,
    idempotencyKey: "key-1",
    ...over,
  } as any);

describe("a replayed ledger key must match the movement it recorded", () => {
  it("answers a matching replay with the first movement and writes once", async () => {
    const t = build();
    const first = await writeOff(t);
    const again = await writeOff(t);
    expect(again.id).toBe(first.id);
    expect(t.db.tables.inventory_transactions).toHaveLength(1);
  });

  it("refuses a replay that asks for a different amount", async () => {
    const t = build();
    await writeOff(t);
    await expect(writeOff(t, { quantityChange: -1 })).rejects.toThrow(
      ConflictException,
    );
    expect(t.db.tables.inventory_transactions).toHaveLength(1);
    expect(t.db.tables.inventory_transactions[0].quantity_change).toBe(-3);
  });

  it("refuses a replay that asks for a different movement type", async () => {
    const t = build();
    await writeOff(t);
    await expect(
      writeOff(t, { transactionType: TransactionType.ADJUSTMENT }),
    ).rejects.toThrow(ConflictException);
  });

  it("refuses a replay aimed at another item", async () => {
    const t = build();
    await writeOff(t);
    await expect(writeOff(t, { inventoryId: OTHER })).rejects.toThrow(
      ConflictException,
    );
  });

  it("refuses a key another house already spent, and writes nothing", async () => {
    const t = build();
    t.db.tables.inventory_transactions.push({
      id: "txn-elsewhere",
      restaurant_id: "house-2",
      inventory_id: "44444444-4444-4444-8444-444444444444",
      stock_type: "live",
      quantity_change: -9,
      transaction_type: "waste",
      idempotency_key: "key-1",
    });
    const call = writeOff(t);
    await expect(call).rejects.toThrow(ConflictException);
    await expect(writeOff(t)).rejects.not.toThrow(/-9|waste|house-2/);
    expect(t.db.tables.inventory_transactions).toHaveLength(1);
  });

  it("answers a key spent in another house exactly as one spent here", async () => {
    const reason = (p: Promise<unknown>) =>
      p.then(
        () => "recorded",
        (e: Error) => e.message,
      );
    const here = build();
    await writeOff(here);
    const spentHere = await reason(writeOff(here, { quantityChange: -1 }));
    const there = build();
    there.db.tables.inventory_transactions.push({
      id: "txn-elsewhere",
      restaurant_id: "house-2",
      inventory_id: "44444444-4444-4444-8444-444444444444",
      stock_type: "live",
      quantity_change: -9,
      transaction_type: "waste",
      idempotency_key: "key-1",
    });
    const spentThere = await reason(writeOff(there));
    expect(spentThere).not.toBe("recorded");
    expect(spentThere).toBe(spentHere);
  });

  it("refuses a replay aimed at another stock state", async () => {
    const t = build();
    await writeOff(t);
    await expect(writeOff(t, { stockType: StockType.SHADOW })).rejects.toThrow(
      ConflictException,
    );
  });
});
