import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { ProcurementOrderStatus } from "./dto/procurement.dto";

/**
 * F-1202: the dashboard day sheet's Deliveries list asked
 * /procurement/orders/history for orders CREATED in the 45 days around the
 * day, newest first, one page of 100. In a house with ~20 orders a day the
 * newest 100 covered about five days, so older days could not be listed.
 * The route now takes a delivered window: what was delivered in the house
 * day's own instants, the statuses the spend counts, newest delivery first,
 * in a stable order the caller can page to the end.
 */

function recordingDb() {
  const calls: unknown[][] = [];
  const from = (table: string) => {
    const q: any = {};
    for (const m of ["select", "eq", "in", "gte", "lte", "lt", "order", "range"])
      q[m] = (...args: unknown[]) => {
        if (table === "procurement_orders") calls.push([m, ...args]);
        return q;
      };
    q.then = (resolve: (v: any) => void) =>
      resolve({ data: [], error: null, count: 0 });
    return q;
  };
  return { db: { supabase: { from } } as unknown as DatabaseService, calls };
}

function service(db: DatabaseService) {
  return new ProcurementService(
    db,
    { emit: jest.fn() } as unknown as EventsService,
    {} as unknown as InventoryLedgerService,
  );
}

describe("F-1202 — the history route reads one day's deliveries whole", () => {
  it("windows on delivered_at, keeps the delivered statuses, and orders by delivery", async () => {
    const { db, calls } = recordingDb();
    await service(db).listOrders("rest-1", {
      deliveredFrom: "2026-10-05T04:00:00.000Z",
      deliveredTo: "2026-10-06T04:00:00.000Z",
      limit: 100,
      page: 2,
    });
    expect(calls).toContainEqual([
      "in",
      "status",
      [ProcurementOrderStatus.DELIVERED, ProcurementOrderStatus.COMPLETED],
    ]);
    expect(calls).toContainEqual(["gte", "delivered_at", "2026-10-05T04:00:00.000Z"]);
    expect(calls).toContainEqual(["lt", "delivered_at", "2026-10-06T04:00:00.000Z"]);
    expect(calls.some((c) => c[1] === "created_at")).toBe(false);
    const orders = calls.filter((c) => c[0] === "order");
    expect(orders[0]).toEqual(["order", "delivered_at", { ascending: false }]);
    expect(orders[1]).toEqual(["order", "id", { ascending: true }]);
    expect(calls).toContainEqual(["range", 100, 199]);
  });

  it("leaves the plain history read on created_at", async () => {
    const { db, calls } = recordingDb();
    await service(db).listOrders("rest-1", { dateFrom: "2026-10-01" });
    expect(calls).toContainEqual(["gte", "created_at", "2026-10-01"]);
    expect(calls.some((c) => c[1] === "delivered_at")).toBe(false);
    expect(calls.filter((c) => c[0] === "order")[0]).toEqual([
      "order",
      "created_at",
      { ascending: false },
    ]);
  });
});
