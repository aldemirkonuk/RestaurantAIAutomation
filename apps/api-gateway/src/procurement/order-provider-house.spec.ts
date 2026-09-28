import { NotFoundException } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { GATES_AFTER_LEDGER } from "./testing/passing-vendor-gates";

/**
 * `POST /procurement/orders` books only the caller's own vendor (ADR 0147).
 *
 * `createOrder` checked the inventory item's house (ADR 0141) and never the
 * provider's, so house A could send house B's provider id and it was used in
 * the dedup lookup and written onto A's order (v3.0-TECH-DEBT, 2026-09-25,
 * CLAIMS TD-2026-09-25-PROCUREMENT-ORDER-FOREIGN-PROVIDER). Another house's
 * vendor — or a vendor row with no house — is now a 404, the same answer as a
 * vendor that does not exist, and nothing touches `procurement_orders`.
 *
 * The stub answers a provider read by the filters it was given, so a query
 * that dropped its house filter would see the foreign row and the test would
 * fail.
 */

type Row = Record<string, any>;

const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWN_VENDOR = "11111111-1111-4111-8111-111111111111";
const FOREIGN_VENDOR = "22222222-2222-4222-8222-222222222222";
const HOUSELESS_VENDOR = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

const providers: Row[] = [
  { id: OWN_VENDOR, restaurant_id: HOUSE_A, is_active: true },
  { id: FOREIGN_VENDOR, restaurant_id: HOUSE_B, is_active: true },
  { id: HOUSELESS_VENDOR, restaurant_id: null, is_active: true },
];

function makeDb(opts: { providerReadError?: string } = {}) {
  const touched = { procurementOrders: 0 };

  const supabase: any = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let head = false;
      if (table === "procurement_orders") touched.procurementOrders++;

      const settle = () => {
        if (table === "restaurant_inventory") {
          return { data: { id: "inv-1" }, error: null };
        }
        if (table === "providers") {
          if (opts.providerReadError) {
            return {
              data: null,
              count: null,
              error: { message: opts.providerReadError },
            };
          }
          const rows = providers.filter((p) =>
            filters.every(([col, val]) => p[col] === val),
          );
          return { data: head ? null : rows, count: rows.length, error: null };
        }
        // Anything past the fences is out of this spec's scope: refuse loudly
        // so a test that expected a refusal cannot pass by writing.
        return { data: null, error: { message: `unexpected read of ${table}` } };
      };

      const q: any = {
        select: (_cols?: string, o?: { head?: boolean }) => {
          head = Boolean(o?.head);
          return q;
        },
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return q;
        },
        neq: () => q,
        not: () => q,
        in: () => q,
        is: () => q,
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

  const db = {
    supabase,
    getClient: () => supabase,
    client: supabase,
  } as unknown as DatabaseService;
  return { db, touched };
}

const events = {
  createEvent: jest.fn().mockResolvedValue({}),
} as unknown as EventsService;
const ledger = {
  recordTransaction: jest.fn().mockResolvedValue({}),
} as unknown as InventoryLedgerService;

function service(db: DatabaseService) {
  return new ProcurementService(db, events, ledger, ...GATES_AFTER_LEDGER);
}

const order = (providerId: string) =>
  ({
    inventoryId: "inv-1",
    providerId,
    quantity: 6,
    unitType: "bottles",
    finalPrice: 20,
  }) as any;

describe("createOrder — the vendor must be the caller's house's", () => {
  it("refuses another house's vendor with a 404 and never reads or writes an order", async () => {
    const { db, touched } = makeDb();
    await expect(
      service(db).createOrder(HOUSE_A, USER, order(FOREIGN_VENDOR)),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(touched.procurementOrders).toBe(0);
  });

  it("refuses a vendor row with no house, which is no house's vendor", async () => {
    const { db, touched } = makeDb();
    await expect(
      service(db).createOrder(HOUSE_A, USER, order(HOUSELESS_VENDOR)),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(touched.procurementOrders).toBe(0);
  });

  it("refuses a vendor id that does not exist with the same 404", async () => {
    const { db, touched } = makeDb();
    await expect(
      service(db).createOrder(
        HOUSE_A,
        USER,
        order("55555555-5555-4555-8555-555555555555"),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(touched.procurementOrders).toBe(0);
  });

  it("treats a failed vendor read as a refusal, not a yes", async () => {
    const { db, touched } = makeDb({ providerReadError: "connection reset" });
    await expect(
      service(db).createOrder(HOUSE_A, USER, order(OWN_VENDOR)),
    ).rejects.not.toBeInstanceOf(NotFoundException);
    expect(touched.procurementOrders).toBe(0);
  });

  it("lets the caller's own vendor past the fence", async () => {
    const { db, touched } = makeDb();
    // Past the fences the stub refuses every other table, so the call fails
    // somewhere after them; what matters is that it got to procurement_orders.
    await service(db)
      .createOrder(HOUSE_A, USER, order(OWN_VENDOR))
      .catch(() => undefined);
    expect(touched.procurementOrders).toBeGreaterThan(0);
  });
});
