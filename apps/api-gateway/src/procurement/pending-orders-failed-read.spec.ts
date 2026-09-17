import { HttpException, ServiceUnavailableException } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { ProcurementController } from "./procurement.controller";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";

/**
 * The pending queue, and its count, refuse a read they could not make.
 *
 * WHAT WAS WRONG
 * --------------
 * supabase-js RESOLVES with `{ data, error }`; it does not throw. The pending
 * queue logged the error and returned `[]`, and
 * `GET /procurement/orders/pending/count` returned `{ count: 0 }` over that
 * empty list. So "we could not read the approvals queue" and "nothing is
 * waiting on you" were the same answer, and the one a manager believes is the
 * reassuring one. The controller's own catch was dead code: nothing reached it.
 *
 * WHAT THIS SUITE PINS
 * --------------------
 *  * A failed read rejects with 503 on the count route, never `{ count: 0 }`.
 *  * The refusal does not hand the database's own error text to the client.
 *  * A queue that WAS read and is empty still answers `[]` / `{ count: 0 }`;
 *    the fix must not turn a real zero into an error.
 *  * A non-HTTP throw on the count route keeps its old 500.
 */

const DB_MESSAGE = "canceling statement due to statement timeout";

function makeDb(result: { data: unknown; error?: { message: string; code?: string } | null }) {
  const eqs: [string, unknown][] = [];
  const q: any = {
    select: () => q,
    eq(col: string, val: unknown) {
      eqs.push([col, val]);
      return q;
    },
    in: () => q,
    order: () => q,
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: result.data, error: result.error ?? null }),
  };
  const db = { supabase: { from: () => q } } as unknown as DatabaseService;
  return { db, eqs };
}

function service(db: DatabaseService) {
  return new ProcurementService(
    db,
    { emit: jest.fn() } as unknown as EventsService,
    {} as unknown as InventoryLedgerService,
  );
}

const FAILED = { data: null, error: { message: DB_MESSAGE, code: "57014" } };

function pendingRow(id: string) {
  return {
    id,
    order_number: `ORD-${id}`,
    restaurant_id: "rest-1",
    inventory_id: "inv-1",
    provider_id: "prov-1",
    quantity: 1,
    unit_type: "bottle",
    bottles_total: 1,
    status: "APPROVAL_NEEDED",
    requested_at: "2026-09-01T00:00:00.000Z",
    inventory: { wine_name: "Barolo" },
    provider: { name: "Vinifera Imports" },
  };
}

const USER = { userId: "u-1", restaurantId: "rest-1" };

describe("listPendingOrders refuses a failed read", () => {
  it("rejects with 503 instead of resolving an empty queue", async () => {
    const { db } = makeDb(FAILED);
    await expect(service(db).listPendingOrders("rest-1")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("does not put the database's own error text in the refusal", async () => {
    const { db } = makeDb(FAILED);
    const err = await service(db)
      .listPendingOrders("rest-1")
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(JSON.stringify((err as HttpException).getResponse())).not.toContain(DB_MESSAGE);
  });

  it("still answers [] for a queue that was read and is empty", async () => {
    const { db, eqs } = makeDb({ data: [] });
    await expect(service(db).listPendingOrders("rest-1")).resolves.toEqual([]);
    expect(eqs).toContainEqual(["restaurant_id", "rest-1"]);
  });
});

describe("GET /procurement/orders/pending/count", () => {
  it("answers 503 on a failed read, never { count: 0 }", async () => {
    const { db } = makeDb(FAILED);
    const controller = new ProcurementController(service(db));

    const outcome = await controller.getPendingOrderCount(USER).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );

    expect(outcome).not.toHaveProperty("value");
    const error = (outcome as { error: unknown }).error;
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
    expect(JSON.stringify((error as HttpException).getResponse())).not.toContain(DB_MESSAGE);
  });

  it("counts the rows it read", async () => {
    const { db } = makeDb({ data: [pendingRow("a"), pendingRow("b")] });
    const controller = new ProcurementController(service(db));
    await expect(controller.getPendingOrderCount(USER)).resolves.toEqual({ count: 2 });
  });

  it("answers { count: 0 } for a queue that was read and is empty", async () => {
    const { db } = makeDb({ data: [] });
    const controller = new ProcurementController(service(db));
    await expect(controller.getPendingOrderCount(USER)).resolves.toEqual({ count: 0 });
  });

  it("keeps a 500 for an unexpected non-HTTP throw", async () => {
    const svc = {
      listPendingOrders: jest.fn().mockRejectedValue(new Error("mapper exploded")),
    } as unknown as ProcurementService;
    const controller = new ProcurementController(svc);

    const error = await controller.getPendingOrderCount(USER).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(500);
  });
});
