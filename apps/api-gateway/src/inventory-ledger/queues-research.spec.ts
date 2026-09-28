/**
 * POST /inventory-ledger/transactions queues research once, by id, like
 * every other booking path — the founder's answer of 2026-09-22 (round 6z),
 * verbatim pick (8): "Queue it; Mudavym + hold (Recommended)". ADR 0192
 * named this the one API-only path left unwired: the endpoint books
 * whatever type its caller names, and none of it queued research for a wine
 * the library lacks.
 *
 * Real: `InventoryLedgerService`, `queueResearchIfLibraryLacks` (not
 * mocked — the point is that this endpoint now calls the same function
 * every other booking path calls). Double: `EventsService` (irrelevant
 * here), `FakeDb` for Supabase.
 */
import { InventoryLedgerService } from "./inventory-ledger.service";
import { FakeDb } from "../notifications/producers/testing/fake-db";
import { TransactionSource, TransactionType, StockType } from "./dto/inventory-ledger.dto";

const HOUSE = "house-1";
const ITEM = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function build(opts: { item?: Record<string, any> } = {}) {
  const db = new FakeDb();
  db.tables.restaurant_inventory = [
    { id: ITEM, restaurant_id: HOUSE, master_wine_id: null, wine_name: "Kavaklıdere Yakut 2019", ...(opts.item ?? {}) },
  ];
  db.tables.inventory_transactions = [];
  db.tables.house_item_research = [];
  db.rpcHandlers.apply_stock_movement = (args) => {
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

const create = (t: ReturnType<typeof build>, over: Partial<{ quantityChange: number; orderId: string }> = {}) =>
  t.service.createTransaction(HOUSE, USER, {
    inventoryId: ITEM,
    wineId: "w-1",
    transactionType: TransactionType.PURCHASE,
    source: TransactionSource.MANUAL,
    quantityChange: 6,
    stockType: StockType.LIVE,
    ...over,
  } as any);

describe("createTransaction queues research for a wine the library lacks", () => {
  it("a positive delta queues research, once, by the item's id, as receiving", async () => {
    const t = build();
    await create(t);
    expect(t.db.tables.house_item_research).toEqual([
      expect.objectContaining({ inventory_id: ITEM, restaurant_id: HOUSE, status: "queued", queued_from: "receiving" }),
    ]);
  });

  it("a library-linked item is not queued", async () => {
    const t = build({ item: { master_wine_id: "55555555-5555-4555-8555-555555555555" } });
    await create(t);
    expect(t.db.tables.house_item_research).toHaveLength(0);
  });

  it("a negative delta (a sale, a correction out) is not a booking IN, and is not queued", async () => {
    const t = build();
    await create(t, { quantityChange: -2, orderId: undefined });
    expect(t.db.tables.house_item_research).toHaveLength(0);
  });

  it("a second transaction on the same item queues nothing twice — the unique index on the item id is the once", async () => {
    const t = build();
    await create(t, { orderId: undefined });
    await create(t, { orderId: undefined });
    expect(t.db.tables.house_item_research).toHaveLength(1);
  });

  it("a failed queue write is logged, and never fails the transaction itself", async () => {
    const t = build();
    t.db.failures.house_item_research = "connection reset";
    const out = await create(t);
    expect(out.id).toBeDefined();
    expect((t.service as any).logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Inventory transaction booked, but the item was not queued for research" }),
    );
  });

  it("createBulkTransactions queues research too — it calls the single path per line", async () => {
    const t = build();
    await t.service.createBulkTransactions(HOUSE, USER, {
      transactions: [
        {
          inventoryId: ITEM,
          wineId: "w-1",
          transactionType: TransactionType.PURCHASE,
          source: TransactionSource.MANUAL,
          quantityChange: 6,
          stockType: StockType.LIVE,
        },
      ],
    } as any);
    expect(t.db.tables.house_item_research).toEqual([
      expect.objectContaining({ inventory_id: ITEM, status: "queued", queued_from: "receiving" }),
    ]);
  });
});
