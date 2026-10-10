import { ServiceUnavailableException } from "@nestjs/common";
import { ProcurementService, OPEN_ORDER_STATUSES } from "./procurement.service";
import { ProcurementController } from "./procurement.controller";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";

/**
 * `GET /procurement/orders/open/by-provider` — the /vendors cards' "Open
 * orders", counted over the house's whole book on the server (sim F-905).
 *
 * The page used to count over `GET /procurement/orders`, whose default page
 * is the newest 50, so any house past fifty orders got short counts. This
 * suite pins: the count is per vendor over the open stages only, scoped to
 * the house; a read past PostgREST's 1,000-row cap pages on instead of
 * stopping; and a failed read is a 503, never an empty map.
 */

type Row = { provider_id: string | null };

function makeDb(pages: Array<{ data: Row[] | null; error?: { message: string } | null }>) {
  const calls: { eqs: [string, unknown][]; ins: [string, unknown][]; ranges: [number, number][] } = {
    eqs: [],
    ins: [],
    ranges: [],
  };
  let served = 0;
  const q: any = {
    select: () => q,
    eq(col: string, val: unknown) {
      calls.eqs.push([col, val]);
      return q;
    },
    in(col: string, val: unknown) {
      calls.ins.push([col, val]);
      return q;
    },
    not: () => q,
    order: () => q,
    range(from: number, to: number) {
      calls.ranges.push([from, to]);
      const page = pages[served++] ?? { data: [] };
      return Promise.resolve({ data: page.data, error: page.error ?? null });
    },
  };
  const db = { supabase: { from: () => q } } as unknown as DatabaseService;
  return { db, calls };
}

function service(db: DatabaseService) {
  return new ProcurementService(
    db,
    { emit: jest.fn() } as unknown as EventsService,
    {} as unknown as InventoryLedgerService,
  );
}

const rows = (provider: string, n: number): Row[] =>
  Array.from({ length: n }, () => ({ provider_id: provider }));

describe("countOpenOrdersByProvider", () => {
  it("counts each vendor's open orders for the house", async () => {
    const { db, calls } = makeDb([
      { data: [...rows("prov-a", 3), ...rows("prov-b", 1), { provider_id: null }] },
    ]);
    await expect(service(db).countOpenOrdersByProvider("rest-1")).resolves.toEqual({
      "prov-a": 3,
      "prov-b": 1,
    });
    expect(calls.eqs).toEqual([["restaurant_id", "rest-1"]]);
    expect(calls.ins).toEqual([["status", OPEN_ORDER_STATUSES]]);
  });

  it("counts only the open stages, never delivered or closed ones", () => {
    expect([...OPEN_ORDER_STATUSES].sort()).toEqual(
      [
        "APPROVAL_NEEDED",
        "APPROVED",
        "CONFIRMED",
        "IN_TRANSIT",
        "NEGOTIATING",
        "PARTIALLY_RECEIVED",
        "PENDING",
      ].sort(),
    );
  });

  it("reads on past the 1,000-row cap instead of counting a part", async () => {
    const { db, calls } = makeDb([
      { data: rows("prov-a", 1000) },
      { data: rows("prov-a", 200) },
    ]);
    await expect(service(db).countOpenOrdersByProvider("rest-1")).resolves.toEqual({
      "prov-a": 1200,
    });
    expect(calls.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("answers {} for a house with nothing open (a real zero, read)", async () => {
    const { db } = makeDb([{ data: [] }]);
    await expect(service(db).countOpenOrdersByProvider("rest-1")).resolves.toEqual({});
  });

  it("refuses a failed read with 503, without the database's own words", async () => {
    const { db } = makeDb([
      { data: null, error: { message: "canceling statement due to statement timeout" } },
    ]);
    const err = await service(db)
      .countOpenOrdersByProvider("rest-1")
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(String((err as Error).message)).not.toMatch(/statement timeout/);
  });
});

describe("GET /procurement/orders/open/by-provider", () => {
  const user = { userId: "u-1", restaurantId: "rest-1" };

  it("answers the house's counts", async () => {
    const svc = {
      countOpenOrdersByProvider: jest.fn().mockResolvedValue({ "prov-a": 2 }),
    } as unknown as ProcurementService;
    const ctrl = new ProcurementController(svc);
    await expect(ctrl.countOpenOrdersByProvider(user)).resolves.toEqual({
      counts: { "prov-a": 2 },
    });
    expect((svc as any).countOpenOrdersByProvider).toHaveBeenCalledWith("rest-1");
  });

  it("keeps the service's 503 rather than re-wrapping it", async () => {
    const svc = {
      countOpenOrdersByProvider: jest
        .fn()
        .mockRejectedValue(new ServiceUnavailableException("Could not read open orders")),
    } as unknown as ProcurementService;
    const ctrl = new ProcurementController(svc);
    await expect(ctrl.countOpenOrdersByProvider(user)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
