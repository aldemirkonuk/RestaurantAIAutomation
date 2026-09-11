/**
 * THE ITEM ACTIVITY DOOR IS BLIND TO DELIVERY BOOKINGS (measured 2026-09-06).
 *
 * FAILING-FIRST. Against the tree before this fix, the first test fails on
 * `totalIn28d` being undefined and the second on a failed read resolving to an
 * empty series instead of raising. The third (the out series) is a REGRESSION
 * guard: it passed before and must keep passing.
 *
 * The booking is not hand-written here. `DeliveryStockService.bookAtTheDoor`
 * runs against the shared mock, and the ledger row the reader is then given is
 * DERIVED FROM THE ARGUMENTS THE WRITER ACTUALLY SENT to `apply_stock_movement`
 * (`p_delta`, `p_transaction_type`, `p_reference_type`), mapped by the same
 * column names the SQL function inserts them under
 * (`supabase/migrations/20260906233000_stock_at_the_door_cost_at_verified.sql:251`).
 * A test that typed the row itself would keep passing if the writer changed.
 */

import { DatabaseService } from "../database/database.service";
import { InventoryService } from "./inventory.service";
import { makeMockDb, MockDb } from "../procurement/canonical/delivery-mock";
import { DeliveryStockService } from "../procurement/canonical/delivery-stock.service";

const REST = "11111111-1111-1111-1111-111111111111";
const DEL = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const DOC = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ITEM = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

/** The rows `apply_stock_movement` would have written for the calls the service made. */
function ledgerRowsFrom(db: MockDb) {
  return db.rpcCalls
    .filter((c) => c.fn === "apply_stock_movement")
    .map((c) => ({
      restaurant_id: REST,
      inventory_id: c.args.p_inventory_id,
      quantity_change: c.args.p_delta,
      transaction_type: c.args.p_transaction_type,
      reference_type: c.args.p_reference_type,
      reference_id: c.args.p_reference_id,
      created_at: new Date().toISOString(),
    }));
}

describe("item activity reads what the delivery door booked", () => {
  let db: MockDb;
  let stock: DeliveryStockService;
  let inventory: InventoryService;

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    stock = new DeliveryStockService(db.client as unknown as DatabaseService);
    inventory = new InventoryService(db.client as unknown as DatabaseService);
    db.answers.deliveries = {
      data: { id: DEL, state: "DELIVERED", order_id: null },
      error: null,
    };
    db.answers.procurement_document_lines = {
      data: [
        {
          document_id: DOC,
          line_no: 1,
          inventory_id: ITEM,
          qty_bottles: 10,
          unit_price: null,
          description: "Sentetik Öküzgözü 2021",
          vendor_sku: "SYN-1",
        },
      ],
      error: null,
    };
    db.answers.inventory_transactions = { data: [], error: null };
    db.rpcAnswers.apply_stock_movement = { data: "txn-1", error: null };
  });

  it("counts the 10 bottles the door booked as stock IN, on today", async () => {
    const booked = await stock.bookAtTheDoor(REST, DEL, DOC, null);
    expect(booked.ok).toBe(true);
    db.answers.inventory_transactions = {
      data: ledgerRowsFrom(db),
      error: null,
    };
    expect(db.answers.inventory_transactions.data).toHaveLength(1);

    const activity = await inventory.getItemActivity(REST, ITEM);
    const today = new Date().toISOString().slice(0, 10);
    expect(activity.totalIn28d).toBe(10);
    expect(activity.daily.find((d) => d.date === today)?.in).toBe(10);
    // A booking is not a depletion. The out series must not have moved.
    expect(activity.totalOut28d).toBe(0);
    // The door must NAME what it includes rather than leave the reader to
    // guess whether an empty series means "no movement" or "not counted".
    expect(activity.includes.in).toMatch(/deliver/i);
  });

  it("a failed ledger read RAISES; it never answers with an empty series", async () => {
    db.answers.inventory_transactions = {
      data: null,
      error: { message: "connection reset" },
    };
    await expect(inventory.getItemActivity(REST, ITEM)).rejects.toThrow(
      /could not be read/i,
    );
  });

  it("still counts a depletion as OUT (regression)", async () => {
    db.answers.inventory_transactions = {
      data: [
        {
          restaurant_id: REST,
          inventory_id: ITEM,
          quantity_change: -2,
          transaction_type: "sale",
          created_at: new Date().toISOString(),
        },
      ],
      error: null,
    };
    const activity = await inventory.getItemActivity(REST, ITEM);
    expect(activity.totalOut28d).toBe(2);
    expect(activity.totalIn28d).toBe(0);
  });
});
