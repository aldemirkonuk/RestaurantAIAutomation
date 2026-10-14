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

/**
 * F-323: the heatmap and the 14-day bars file a pour on the house's clock.
 * Thursday 2026-10-08 20:00 in Los Angeles is Friday 03:00 UTC: on the server
 * clock it fell below the 4pm slot and was dropped, and its bar sat on Friday.
 */
describe("item activity on the house's clock", () => {
  let db: MockDb;
  let inventory: InventoryService;
  const pourAt = (iso: string) => ({
    restaurant_id: REST,
    inventory_id: ITEM,
    quantity_change: -1,
    transaction_type: "pour",
    created_at: iso,
  });

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    inventory = new InventoryService(db.client as unknown as DatabaseService);
  });
  afterEach(() => jest.useRealTimers());

  it("an LA dinner pour lands on Thursday 8pm, and on Thursday's bar", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-09T06:30:00Z"));
    db.answers.restaurants = {
      data: { timezone: "America/Los_Angeles", country: "US" },
      error: null,
    };
    db.answers.inventory_transactions = {
      data: [pourAt("2026-10-09T03:00:00Z")],
      error: null,
    };
    const a = await inventory.getItemActivity(REST, ITEM);
    // Thu = 3 (Mon=0), 20:00 = slot 4 (16:00 = 0).
    expect(a.heat[3][4]).toBe(1);
    expect(a.daily[a.daily.length - 1].date).toBe("2026-10-08");
    expect(a.daily[a.daily.length - 1].out).toBe(1);
  });

  it("an Istanbul 17:00 pour lands on the 5pm cell, not dropped", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-08T22:30:00Z"));
    db.answers.restaurants = {
      data: { timezone: "Europe/Istanbul", country: "TR" },
      error: null,
    };
    db.answers.inventory_transactions = {
      data: [pourAt("2026-10-08T14:00:00Z")],
      error: null,
    };
    const a = await inventory.getItemActivity(REST, ITEM);
    expect(a.heat[3][1]).toBe(1);
    // 01:30 Friday in Istanbul: today's bar is Friday.
    expect(a.daily[a.daily.length - 1].date).toBe("2026-10-09");
  });
});

/**
 * F-1165: a count of one shelf no longer marks the whole wine counted, so the
 * door says which shelf was counted when -- each shelf's newest count, from
 * stock_counts.location_id. A read it cannot finish is null, never "no shelf
 * was counted".
 */
describe("item activity says which shelf was counted when", () => {
  let db: MockDb;
  let inventory: InventoryService;

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    inventory = new InventoryService(db.client as unknown as DatabaseService);
    db.answers.inventory_transactions = { data: [], error: null };
  });

  it("gives each shelf its newest count, newest first", async () => {
    db.answers.stock_counts = {
      data: [
        { location_id: "bar", counted_at: "2026-10-10T18:00:00Z" },
        { location_id: "cellar", counted_at: "2026-09-20T18:00:00Z" },
        { location_id: "bar", counted_at: "2026-09-01T18:00:00Z" },
      ],
      error: null,
    };
    const a = await inventory.getItemActivity(REST, ITEM);
    expect(a.shelfCounts).toEqual([
      { locationId: "bar", countedAt: "2026-10-10T18:00:00Z" },
      { locationId: "cellar", countedAt: "2026-09-20T18:00:00Z" },
    ]);
  });

  it("a failed read is null, and the rest of the activity still answers", async () => {
    db.answers.stock_counts = {
      data: null,
      error: { message: "connection reset" },
    };
    const a = await inventory.getItemActivity(REST, ITEM);
    expect(a.shelfCounts).toBeNull();
    expect(a.totalOut28d).toBe(0);
  });

  it("a read as long as the scan cap is null, not a shelf called uncounted", async () => {
    db.answers.stock_counts = {
      data: Array.from({ length: 1000 }, () => ({
        location_id: "bar",
        counted_at: "2026-10-10T18:00:00Z",
      })),
      error: null,
    };
    const a = await inventory.getItemActivity(REST, ITEM);
    expect(a.shelfCounts).toBeNull();
  });
});

/**
 * F-1595 (sim 52, bar-night-service): "Velocity, last 14 days" and "When it
 * sells" are sales, but they counted any negative movement. Carrying 12
 * bottles from the cellar to the bar at 18:00 on Friday (transfer_stock writes
 * a -12 leg and a +12 leg) drew 12 sales on Friday 6pm; a broken bottle, a
 * comp and a count correction drew a sale each.
 */
describe("item activity counts only sales as sales", () => {
  let db: MockDb;
  let inventory: InventoryService;
  // Friday 2026-10-09 in Istanbul; 15:00Z is 18:00 there.
  const at = "2026-10-09T15:00:00Z";
  const row = (
    quantity_change: number,
    transaction_type: string,
    source = "manual",
  ) => ({
    restaurant_id: REST,
    inventory_id: ITEM,
    quantity_change,
    transaction_type,
    source,
    created_at: at,
  });

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    inventory = new InventoryService(db.client as unknown as DatabaseService);
    jest.useFakeTimers().setSystemTime(new Date("2026-10-09T20:00:00Z"));
    db.answers.restaurants = {
      data: { timezone: "Europe/Istanbul", country: "TR" },
      error: null,
    };
  });
  afterEach(() => jest.useRealTimers());

  it("a shelf move, breakage, comp and count correction draw no sale", async () => {
    db.answers.inventory_transactions = {
      data: [
        row(-12, "transfer"),
        row(12, "transfer"),
        row(-1, "waste"),
        row(-1, "comp"),
        row(-2, "correction"),
        row(-1, "adjustment"),
      ],
      error: null,
    };
    const a = await inventory.getItemActivity(REST, ITEM);
    const today = a.daily[a.daily.length - 1];
    expect(today.date).toBe("2026-10-09");
    expect(today.sold).toBe(0);
    expect(a.heat.flat().every((v) => v === 0)).toBe(true);
    // They are still movements off the shelf, and the door says so.
    expect(today.out).toBe(17);
    expect(a.includes.sold).toMatch(/not a sale/);
  });

  it("a sale and a pour are sales, less what the till sent back", async () => {
    db.answers.inventory_transactions = {
      data: [
        row(-3, "sale", "pos"),
        row(-1, "pour"),
        row(1, "return", "pos"),
        row(-12, "transfer"),
      ],
      error: null,
    };
    const a = await inventory.getItemActivity(REST, ITEM);
    expect(a.daily[a.daily.length - 1].sold).toBe(3);
    // Fri = 4 (Mon=0), 18:00 = slot 2 (16:00 = 0).
    expect(a.heat[4][2]).toBe(3);
  });
});

/**
 * F-1597: a glass poured by hand reached the ledger only when it opened a
 * bottle, and nothing a person reads read pour_events, so the morning after
 * nobody could see who recorded the six Barolo pours, or when.
 */
describe("item activity lists the glasses poured by hand", () => {
  let db: MockDb;
  let inventory: InventoryService;

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    inventory = new InventoryService(db.client as unknown as DatabaseService);
    db.answers.inventory_transactions = { data: [], error: null };
  });

  it("names who poured and when, the till's own pours left out", async () => {
    db.answers.pour_events = {
      data: [
        {
          pours: 1,
          pour_ml: 150,
          bottles_opened: 0,
          performed_by: "u-ayse",
          created_at: "2026-10-09T21:40:00Z",
        },
        {
          pours: 2,
          pour_ml: 150,
          bottles_opened: 1,
          performed_by: null,
          created_at: "2026-10-09T21:10:00Z",
        },
      ],
      error: null,
    };
    db.answers.users = {
      data: [
        {
          user_id: "u-ayse",
          name: "Ayşe Demir",
          email: "a@x",
          restaurant_id: REST,
        },
      ],
      error: null,
    };
    db.answers.user_restaurant_access = { data: [], error: null };
    db.answers.house_memberships_ended = { data: [], error: null };

    const activity: any = await inventory.getItemActivity(REST, ITEM);

    expect(activity.handPours).toEqual([
      {
        at: "2026-10-09T21:40:00Z",
        glasses: 1,
        pourMl: 150,
        bottlesOpened: 0,
        byName: "Ayşe Demir",
      },
      {
        at: "2026-10-09T21:10:00Z",
        glasses: 2,
        pourMl: 150,
        bottlesOpened: 1,
        byName: null,
      },
    ]);
    // The till's pours are on its checks, not listed twice here.
    expect(db.verbs).toContain("pour_events.neq");
  });

  it("a failed pour read is null, never an empty list", async () => {
    db.answers.pour_events = { data: null, error: { message: "reset" } };
    const activity: any = await inventory.getItemActivity(REST, ITEM);
    expect(activity.handPours).toBeNull();
    // The rest of the door still answers.
    expect(activity.daily).toHaveLength(14);
  });
});
