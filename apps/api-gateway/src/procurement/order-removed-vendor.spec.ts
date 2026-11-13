import {
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { GATES_AFTER_LEDGER } from "./testing/passing-vendor-gates";

/**
 * A vendor the house removed takes no new order (QA round 3b, H3).
 *
 * The stub answers a `providers` read by EVERY filter it was given — `eq`,
 * `is(col, null)` and `not(col, "is", false)` — so a fence that dropped its
 * removed-vendor filters would count the removed row as live and the
 * refusal tests would fail.
 */

type Row = Record<string, any>;

const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LIVE = "11111111-1111-4111-8111-111111111111";
const REMOVED = "22222222-2222-4222-8222-222222222222";
const INACTIVE_ONLY = "33333333-3333-4333-8333-333333333333";
const DELETED_ONLY = "44444444-4444-4444-8444-444444444444";
const FLAG_NEVER_WRITTEN = "55555555-5555-4555-8555-555555555555";
const FOREIGN_REMOVED = "66666666-6666-4666-8666-666666666666";
const USER = "77777777-7777-4777-8777-777777777777";
const WHEN = "2026-11-01T10:00:00.000Z";

const providers: Row[] = [
  { id: LIVE, restaurant_id: HOUSE_A, is_active: true, deleted_at: null },
  { id: REMOVED, restaurant_id: HOUSE_A, is_active: false, deleted_at: WHEN },
  { id: INACTIVE_ONLY, restaurant_id: HOUSE_A, is_active: false, deleted_at: null },
  { id: DELETED_ONLY, restaurant_id: HOUSE_A, is_active: true, deleted_at: WHEN },
  { id: FLAG_NEVER_WRITTEN, restaurant_id: HOUSE_A, is_active: null, deleted_at: null },
  { id: FOREIGN_REMOVED, restaurant_id: HOUSE_B, is_active: false, deleted_at: WHEN },
];

type Filter = (row: Row) => boolean;

function makeDb(opts: { liveReadError?: string } = {}) {
  const touched = { procurementOrders: 0 };

  const supabase: any = {
    from(table: string) {
      const filters: Filter[] = [];
      let head = false;
      let liveRead = false;
      if (table === "procurement_orders") touched.procurementOrders++;

      const settle = () => {
        if (table === "restaurant_inventory") {
          return { data: { id: "inv-1" }, error: null };
        }
        if (table === "providers") {
          if (opts.liveReadError && liveRead) {
            return { data: null, count: null, error: { message: opts.liveReadError } };
          }
          const rows = providers.filter((p) => filters.every((f) => f(p)));
          return { data: head ? null : rows, count: rows.length, error: null };
        }
        // Past the fences: refuse loudly, so a refusal test cannot pass by writing.
        return { data: null, error: { message: `unexpected read of ${table}` } };
      };

      const q: any = {
        select: (_cols?: string, o?: { head?: boolean }) => {
          head = Boolean(o?.head);
          return q;
        },
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return q;
        },
        is: (col: string, val: unknown) => {
          liveRead = true;
          filters.push((r) => (val === null ? r[col] == null : r[col] === val));
          return q;
        },
        not: (col: string, op: string, val: unknown) => {
          liveRead = true;
          if (op !== "is") throw new Error(`stub: not.${op} is not modelled`);
          filters.push((r) => !(val === null ? r[col] == null : r[col] === val));
          return q;
        },
        neq: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        insert: () => q,
        update: () => q,
        single: async () => settle(),
        maybeSingle: async () => settle(),
        then: (res: any, rej: any) => Promise.resolve(settle()).then(res, rej),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };

  const db = { supabase, getClient: () => supabase, client: supabase } as unknown as DatabaseService;
  return { db, touched };
}

const events = { createEvent: jest.fn().mockResolvedValue({}) } as unknown as EventsService;
const ledger = { recordTransaction: jest.fn().mockResolvedValue({}) } as unknown as InventoryLedgerService;
const service = (db: DatabaseService) =>
  new ProcurementService(db, events, ledger, ...GATES_AFTER_LEDGER);

const order = (providerId: string) =>
  ({ inventoryId: "inv-1", providerId, quantity: 6, unitType: "bottle", finalPrice: 20 }) as any;

async function refusal(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected a refusal, and the order went through");
}

describe("createOrder — a removed vendor takes no new order", () => {
  it.each([
    ["removed on /vendors (inactive and deleted)", REMOVED],
    ["marked inactive", INACTIVE_ONLY],
    ["given a deleted_at", DELETED_ONLY],
  ])("refuses a vendor %s with a 422 in words and writes nothing", async (_label, id) => {
    const { db, touched } = makeDb();
    const e = await refusal(service(db).createOrder(HOUSE_A, USER, order(id)));
    expect(e).toBeInstanceOf(UnprocessableEntityException);
    expect(e.getResponse()).toEqual({
      reason: "vendor_removed",
      message:
        "This vendor was removed from your vendors, so no order was placed. Choose another vendor.",
    });
    expect(touched.procurementOrders).toBe(0);
  });

  it("answers another house's removed vendor with the 404, never the 422 that would confirm it exists", async () => {
    const { db, touched } = makeDb();
    const e = await refusal(service(db).createOrder(HOUSE_A, USER, order(FOREIGN_REMOVED)));
    expect(e).toBeInstanceOf(NotFoundException);
    expect(touched.procurementOrders).toBe(0);
  });

  it("refuses with a 503 when whether the vendor is still live could not be read", async () => {
    const { db, touched } = makeDb({ liveReadError: "connection reset" });
    const e = await refusal(service(db).createOrder(HOUSE_A, USER, order(LIVE)));
    expect(e).toBeInstanceOf(ServiceUnavailableException);
    expect(e.message).toBe(
      "Could not confirm this vendor is still one of your vendors, so no order was placed. Please try again.",
    );
    expect(touched.procurementOrders).toBe(0);
  });

  it.each([
    ["a live vendor", LIVE],
    ["a vendor whose active flag was never written (NULL is live)", FLAG_NEVER_WRITTEN],
  ])("lets %s past the fence", async (_label, id) => {
    const { db, touched } = makeDb();
    await service(db)
      .createOrder(HOUSE_A, USER, order(id))
      .catch(() => undefined);
    expect(touched.procurementOrders).toBeGreaterThan(0);
  });

  it("still records a retroactive order from a removed vendor: the invoice says the purchase already happened", async () => {
    const { db, touched } = makeDb();
    await service(db)
      .createOrder(HOUSE_A, USER, order(REMOVED), {
        source: "retroactive",
        alreadyFulfilled: { deliveredAt: WHEN, invoiceTotal: 120 },
      })
      .catch(() => undefined);
    expect(touched.procurementOrders).toBeGreaterThan(0);
  });

  it("does not let a retroactive order book another house's vendor", async () => {
    const { db, touched } = makeDb();
    const e = await refusal(
      service(db).createOrder(HOUSE_A, USER, order(FOREIGN_REMOVED), {
        source: "retroactive",
        alreadyFulfilled: { deliveredAt: WHEN, invoiceTotal: 120 },
      }),
    );
    expect(e).toBeInstanceOf(NotFoundException);
    expect(touched.procurementOrders).toBe(0);
  });
});
