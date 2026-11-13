import { HttpException, NotFoundException } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { ProcurementController } from "./procurement.controller";
import { ProcurementOrderStatus } from "./dto/procurement.dto";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { GATES_AFTER_LEDGER } from "./testing/passing-vendor-gates";
import { McpToolReadersService } from "../mcp-server/mcp-tool-readers.service";

/**
 * An order id that names no order in this house is a 404 (QA round 3b, B2).
 *
 * The stub answers every `procurement_orders` read or update with the error
 * PostgREST gives for that id: PGRST116 for "no row", 22P02 for an id that is
 * not a uuid, or a connection fault, which must stay a fault and not become a
 * not-found.
 */

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeDb(code: string, message = "stub error") {
  const writes = { update: 0 };
  const supabase: any = {
    from() {
      const q: any = {
        select: () => q,
        eq: () => q,
        update: () => {
          writes.update++;
          return q;
        },
        single: async () => ({ data: null, error: { code, message } }),
        maybeSingle: async () => ({ data: null, error: { code, message } }),
      };
      return q;
    },
  };
  const db = { supabase, getClient: () => supabase } as unknown as DatabaseService;
  return { db, writes };
}

const service = (db: DatabaseService) =>
  new ProcurementService(
    db,
    { createEvent: jest.fn() } as unknown as EventsService,
    { recordTransaction: jest.fn() } as unknown as InventoryLedgerService,
    ...GATES_AFTER_LEDGER,
  );

async function caught(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected a refusal");
}

describe("getOrder — an id that names no order here is a 404", () => {
  it.each([
    ["no row (PGRST116)", "PGRST116"],
    ["an id that is not a uuid (22P02)", "22P02"],
  ])("answers %s with a 404 in words", async (_label, code) => {
    const { db } = makeDb(code);
    const e = await caught(service(db).getOrder(HOUSE, "not-an-order"));
    expect(e).toBeInstanceOf(NotFoundException);
    expect(e.getResponse()).toEqual({
      reason: "order_not_found",
      message: "No order with that id belongs to this restaurant.",
    });
  });

  it("keeps a failed read a failure, never a not-found", async () => {
    const { db } = makeDb("08006", "connection reset");
    const e = await caught(service(db).getOrder(HOUSE, "some-order"));
    expect(e).not.toBeInstanceOf(NotFoundException);
    expect(e.message).toBe("connection reset");
  });
});

describe("updateOrder — editing an order that is not here is a 404", () => {
  it.each(["PGRST116", "22P02"])(
    "answers a note on a missing order (%s) with a 404 that says nothing changed",
    async (code) => {
      const { db } = makeDb(code);
      const e = await caught(
        service(db).updateOrder(HOUSE, "missing", { managerNotes: "call them" }),
      );
      expect(e).toBeInstanceOf(NotFoundException);
      expect(e.getResponse()).toEqual({
        reason: "order_not_found",
        message: "No order with that id belongs to this restaurant, so nothing was changed.",
      });
    },
  );

  it("answers a status change on an id that is not a uuid with the 404, before any write", async () => {
    const { db, writes } = makeDb("22P02");
    const e = await caught(
      service(db).updateOrder(HOUSE, "abc", { status: ProcurementOrderStatus.APPROVED }),
    );
    expect(e).toBeInstanceOf(NotFoundException);
    expect(e.getResponse().message).toBe(
      "No order with that id belongs to this restaurant, so there was nothing to change.",
    );
    expect(writes.update).toBe(0);
  });

  it("keeps a failed update a failure, never a not-found", async () => {
    const { db } = makeDb("08006", "connection reset");
    const e = await caught(service(db).updateOrder(HOUSE, "some-order", { managerNotes: "x" }));
    expect(e).not.toBeInstanceOf(NotFoundException);
  });
});

describe("GET /procurement/orders/:id — the controller keeps the 404", () => {
  const user = { userId: "u", restaurantId: HOUSE };

  it("passes the service's 404 through instead of flattening it to a 500", async () => {
    const controller = new ProcurementController({
      getOrder: jest.fn().mockRejectedValue(new NotFoundException("gone")),
    } as unknown as ProcurementService);
    const e = await caught(controller.getOrder("missing", user));
    expect(e).toBeInstanceOf(HttpException);
    expect(e.getStatus()).toBe(404);
  });

  it("still answers a database fault with a 500", async () => {
    const controller = new ProcurementController({
      getOrder: jest.fn().mockRejectedValue(new Error("connection reset")),
    } as unknown as ProcurementService);
    const e = await caught(controller.getOrder("some-order", user));
    expect(e.getStatus()).toBe(500);
  });
});

describe("MCP orders.get — a missing order is the tool's 'no such order' reply", () => {
  const readers = (getOrder: jest.Mock) =>
    new McpToolReadersService(
      {} as any,
      { getOrder } as unknown as ProcurementService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

  it("returns a null value with the reason when the service answers 404", async () => {
    const out = await readers(jest.fn().mockRejectedValue(new NotFoundException("x"))).ordersGet(
      HOUSE,
      "missing",
    );
    expect(out.value).toBeNull();
    expect(out.reason).toMatch(/^No order missing belongs to this house\./);
  });

  it("lets any other failure through as a failure", async () => {
    await expect(
      readers(jest.fn().mockRejectedValue(new Error("connection reset"))).ordersGet(HOUSE, "o"),
    ).rejects.toThrow("connection reset");
  });
});
