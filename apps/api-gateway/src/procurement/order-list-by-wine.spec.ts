import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { OrderFilterDto } from "./dto/procurement.dto";

/**
 * F-1538 (rehit of F-705): /inventory's row read the house's newest 50
 * orders and kept this wine's, so an older wine's On order, Order history
 * and Suggested order missed every order past the first page. The list now
 * takes the wine, and the row pages that wine's orders to the end.
 */

const WINE = "0b6f1c1e-2f4a-4c3e-9a51-7d2b8e9f0a11";

function recordingDb() {
  const calls: unknown[][] = [];
  const from = (table: string) => {
    const q: any = {};
    for (const m of [
      "select",
      "eq",
      "in",
      "gte",
      "lte",
      "lt",
      "order",
      "range",
    ])
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

describe("F-1538 — the order list reads one wine's orders", () => {
  it("filters on inventory_id inside the house when a wine is named", async () => {
    const { db, calls } = recordingDb();
    await service(db).listOrders("rest-1", { inventoryId: WINE, limit: 100 });
    expect(calls).toContainEqual(["eq", "restaurant_id", "rest-1"]);
    expect(calls).toContainEqual(["eq", "inventory_id", WINE]);
  });

  it("reads the whole house when no wine is named", async () => {
    const { db, calls } = recordingDb();
    await service(db).listOrders("rest-1", {});
    expect(calls.some((c) => c[1] === "inventory_id")).toBe(false);
  });

  it("accepts a wine id and refuses anything else", async () => {
    const ok = await validate(
      plainToInstance(OrderFilterDto, { inventoryId: WINE }),
    );
    expect(ok).toHaveLength(0);
    const bad = await validate(
      plainToInstance(OrderFilterDto, {
        inventoryId: "x,inventory_id.neq.null",
      }),
    );
    expect(bad.map((e) => e.property)).toContain("inventoryId");
  });
});
